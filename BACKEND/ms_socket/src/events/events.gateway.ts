import { Logger } from '@nestjs/common';
import {
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { AuthProvider, AuthUser } from 'src/auth/auth.provider';

/** What a connection carries once handleConnection has started. */
export interface ClientData {
  /** The raw `Bearer <jwt>` header, forwarded to the services we call. */
  authorization?: string;
  /**
   * Resolves to the user ms_auth vouched for, or to null once the client has
   * been disconnected. Set synchronously on connection, so a message that
   * arrives before ms_auth answers waits for it instead of racing it.
   */
  auth?: Promise<AuthUser | null>;
  /** The validated user; present only after ms_auth accepted the token. */
  user?: AuthUser;
}

export type ClientSocket = Socket<any, any, any, ClientData>;

const BEARER = /^Bearer\s+\S+$/;

@WebSocketGateway({ cors: true })
export class EventsGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger(EventsGateway.name);

  constructor(private readonly authProvider: AuthProvider) {}

  @WebSocketServer()
  server: Server;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async afterInit(_server: Server) {}

  /**
   * Every connection must carry a bearer token that ms_auth accepts. Any
   * failure — no header, a rejected token, ms_auth unreachable — disconnects.
   */
  async handleConnection(client: ClientSocket) {
    client.data.auth = this.authenticate(client);
    await client.data.auth;
  }

  private async authenticate(client: ClientSocket): Promise<AuthUser | null> {
    const authorization = client.handshake.headers.authorization;
    if (!authorization || !BEARER.test(authorization)) {
      this.logger.warn(`socket ${client.id}: no bearer token, disconnecting`);
      client.disconnect(true);
      return null;
    }
    try {
      const user = await this.authProvider.validateToken(authorization);
      client.data.authorization = authorization;
      client.data.user = user;
      return user;
    } catch (error) {
      this.logger.warn(
        `socket ${client.id}: token rejected (${(error as Error).message}), disconnecting`,
      );
      client.disconnect(true);
      return null;
    }
  }

  @SubscribeMessage('register')
  async registerRoom(
    @MessageBody() room: number,
    @ConnectedSocket() client: ClientSocket,
  ) {
    const user = await client.data.auth;
    if (!user) {
      return { OK: false };
    }
    this.server.emit('notification', `new client joined the room ${room}`);
    await client.join(`${room}`);
    return {
      OK: true,
    };
  }
}
