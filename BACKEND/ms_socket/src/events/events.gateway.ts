import { Logger } from '@nestjs/common';
import {
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { AuthProvider, AuthUser } from 'src/auth/auth.provider';
import { AdminProvider } from 'src/admin/admin.provider';

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
  /** Disconnects the socket when its token expires; cleared on disconnect. */
  expiryTimer?: ReturnType<typeof setTimeout>;
}

export type ClientSocket = Socket<any, any, any, ClientData>;

const BEARER = /^Bearer\s+\S+$/;
/** Room names are channel ids; anything else never reaches ms_admin. */
const CHANNEL_ID = /^\d+$/;
/** setTimeout's largest delay; a longer one fires immediately. */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

/** True when the token's `exp` (seconds) is not in the future. */
function isExpired(user: AuthUser): boolean {
  return typeof user.exp === 'number' && user.exp * 1000 <= Date.now();
}

@WebSocketGateway({ cors: true })
export class EventsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(EventsGateway.name);

  constructor(
    private readonly authProvider: AuthProvider,
    private readonly adminProvider: AdminProvider,
  ) {}

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
      if (isExpired(user)) {
        throw new Error('token already expired');
      }
      client.data.authorization = authorization;
      client.data.user = user;
      this.disconnectAtExpiry(client, user);
      return user;
    } catch (error) {
      this.logger.warn(
        `socket ${client.id}: token rejected (${(error as Error).message}), disconnecting`,
      );
      client.disconnect(true);
      return null;
    }
  }

  /**
   * A socket's rooms last only as long as its token: when `exp` passes, the
   * socket is disconnected, and Socket.IO drops it from every room. Without
   * this, a joined socket kept receiving a channel's messages after its token
   * expired, for as long as the connection stayed open.
   */
  private disconnectAtExpiry(client: ClientSocket, user: AuthUser) {
    if (typeof user.exp !== 'number') {
      return;
    }
    const delay = user.exp * 1000 - Date.now();
    client.data.expiryTimer = setTimeout(
      () => {
        if (isExpired(user)) {
          this.logger.warn(`socket ${client.id}: token expired, disconnecting`);
          client.disconnect(true);
        } else {
          this.disconnectAtExpiry(client, user);
        }
      },
      Math.min(Math.max(delay, 0), MAX_TIMEOUT_MS),
    );
  }

  handleDisconnect(client: ClientSocket) {
    clearTimeout(client.data?.expiryTimer);
    client.data.expiryTimer = undefined;
  }

  /**
   * Joins the room named after a channel id, but only if ms_admin confirms
   * the user may see that channel (i.e. is a member of its workspace).
   */
  @SubscribeMessage('register')
  async registerRoom(
    @MessageBody() room: number | string,
    @ConnectedSocket() client: ClientSocket,
  ) {
    const user = await client.data.auth;
    if (!user || !client.data.authorization) {
      return { OK: false };
    }
    if (isExpired(user)) {
      client.disconnect(true);
      return { OK: false };
    }
    const channelId = String(room ?? '');
    if (!CHANNEL_ID.test(channelId)) {
      return { OK: false };
    }
    const allowed = await this.adminProvider.canAccessChannel(
      client.data.authorization,
      channelId,
    );
    if (!allowed) {
      this.logger.warn(
        `socket ${client.id}: user ${user.userId} refused room ${channelId}`,
      );
      return { OK: false };
    }
    await client.join(channelId);
    // only the room hears who joined it, not every connected client
    client
      .to(channelId)
      .emit('notification', `new client joined the room ${channelId}`);
    return { OK: true };
  }
}
