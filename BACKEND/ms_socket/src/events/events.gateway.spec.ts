import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { AxiosError, AxiosHeaders, AxiosResponse } from 'axios';
import { from, of, throwError } from 'rxjs';
import { AuthProvider } from 'src/auth/auth.provider';
import { ClientSocket, EventsGateway } from './events.gateway';

const AUTH_HOST = 'http://auth.test';
const TOKEN = 'Bearer valid.jwt.token';
const USER = { userId: 1, accountId: 3, username: 'ana' };

function response<T>(data: T, status = 200): AxiosResponse<T> {
  return {
    data,
    status,
    statusText: String(status),
    headers: {},
    config: { headers: new AxiosHeaders() },
  };
}

function httpError(status: number): AxiosError {
  return new AxiosError(
    `Request failed with status code ${status}`,
    'ERR_BAD_REQUEST',
    undefined,
    undefined,
    response({ message: 'Unauthorized' }, status),
  );
}

function fakeClient(authorization?: string) {
  const roomEmit = jest.fn();
  const client = {
    id: 'socket-1',
    handshake: { headers: authorization ? { authorization } : {} },
    data: {},
    disconnect: jest.fn(),
    join: jest.fn(),
    to: jest.fn(() => ({ emit: roomEmit })),
  };
  return { client: client as unknown as ClientSocket, raw: client, roomEmit };
}

/**
 * Rule: a socket stays connected only if ms_auth accepts its bearer token.
 * ms_socket holds no JWT secret; it asks ms_auth, like ms_admin's ApiGuard.
 */
describe('EventsGateway', () => {
  let gateway: EventsGateway;
  let http: { get: jest.Mock };

  beforeEach(async () => {
    http = { get: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        EventsGateway,
        AuthProvider,
        { provide: HttpService, useValue: http },
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: (key: string) => {
              if (key === 'app.authHost') return AUTH_HOST;
              throw new Error(`unexpected config key ${key}`);
            },
          },
        },
      ],
    }).compile();
    gateway = moduleRef.get(EventsGateway);
    gateway.server = { emit: jest.fn(), to: jest.fn() } as never;
  });

  describe('handleConnection', () => {
    it('keeps a client whose token ms_auth accepts, and stores the user', async () => {
      http.get.mockReturnValue(of(response(USER)));
      const { client, raw } = fakeClient(TOKEN);

      await gateway.handleConnection(client);

      expect(http.get).toHaveBeenCalledWith(`${AUTH_HOST}/api/auth/login`, {
        headers: { Authorization: TOKEN },
      });
      expect(raw.disconnect).not.toHaveBeenCalled();
      expect(client.data.user).toEqual(USER);
      expect(client.data.authorization).toBe(TOKEN);
    });

    it('disconnects when ms_auth answers 401 (invalid or expired token)', async () => {
      http.get.mockReturnValue(throwError(() => httpError(401)));
      const { client, raw } = fakeClient('Bearer forged.jwt');

      await gateway.handleConnection(client);

      expect(raw.disconnect).toHaveBeenCalledWith(true);
      expect(client.data.user).toBeUndefined();
    });

    it('disconnects when ms_auth cannot be reached (network error)', async () => {
      http.get.mockReturnValue(
        throwError(() => new Error('connect ECONNREFUSED 127.0.0.1:3001')),
      );
      const { client, raw } = fakeClient(TOKEN);

      await gateway.handleConnection(client);

      expect(raw.disconnect).toHaveBeenCalledWith(true);
      expect(client.data.user).toBeUndefined();
    });

    it('disconnects when ms_auth answers 200 without a user', async () => {
      http.get.mockReturnValue(of(response('')));
      const { client, raw } = fakeClient(TOKEN);

      await gateway.handleConnection(client);

      expect(raw.disconnect).toHaveBeenCalledWith(true);
    });

    it('disconnects without calling ms_auth when there is no bearer token', async () => {
      for (const header of [undefined, 'Bearer ', 'Basic dXNlcjpwYXNz']) {
        const { client, raw } = fakeClient(header);
        await gateway.handleConnection(client);
        expect(raw.disconnect).toHaveBeenCalledWith(true);
      }
      expect(http.get).not.toHaveBeenCalled();
    });
  });

  describe('register', () => {
    it('refuses a client whose token was rejected, and joins nothing', async () => {
      http.get.mockReturnValue(throwError(() => httpError(401)));
      const { client, raw } = fakeClient('Bearer forged.jwt');
      await gateway.handleConnection(client);

      await expect(gateway.registerRoom(5, client)).resolves.toEqual({
        OK: false,
      });
      expect(raw.join).not.toHaveBeenCalled();
    });

    it('waits for ms_auth when register arrives before it has answered', async () => {
      let answer: (value: AxiosResponse) => void = () => undefined;
      http.get.mockReturnValue(
        from(new Promise<AxiosResponse>((resolve) => (answer = resolve))),
      );
      const { client, raw } = fakeClient('Bearer slow.jwt');
      const connecting = gateway.handleConnection(client);
      const registering = gateway.registerRoom(5, client);
      expect(raw.join).not.toHaveBeenCalled();

      answer(response(USER));
      await connecting;
      await expect(registering).resolves.toEqual({ OK: true });
      expect(raw.join).toHaveBeenCalledWith('5');
    });
  });
});
