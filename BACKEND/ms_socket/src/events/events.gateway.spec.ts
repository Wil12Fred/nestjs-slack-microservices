import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { AxiosError, AxiosHeaders, AxiosResponse } from 'axios';
import { from, of, throwError } from 'rxjs';
import { AuthProvider } from 'src/auth/auth.provider';
import { AdminProvider } from 'src/admin/admin.provider';
import { ClientSocket, EventsGateway } from './events.gateway';

const AUTH_HOST = 'http://auth.test';
const ADMIN_HOST = 'http://admin.test';
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
        AdminProvider,
        { provide: HttpService, useValue: http },
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: (key: string) => {
              if (key === 'app.authHost') return AUTH_HOST;
              if (key === 'app.adminHost') return ADMIN_HOST;
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

  describe('token expiry', () => {
    const NOW = new Date('2030-01-01T00:00:00Z').getTime();
    const inSeconds = (s: number) => Math.floor(NOW / 1000) + s;

    beforeEach(() => {
      jest.useFakeTimers({
        now: NOW,
        doNotFake: ['nextTick', 'queueMicrotask'],
      });
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    async function connect(exp?: number) {
      http.get.mockReturnValue(of(response({ ...USER, exp })));
      const fake = fakeClient(TOKEN);
      await gateway.handleConnection(fake.client);
      return fake;
    }

    it('disconnects the socket (leaving its rooms) when the token expires', async () => {
      const { raw } = await connect(inSeconds(60));
      expect(raw.disconnect).not.toHaveBeenCalled();

      jest.advanceTimersByTime(59_000);
      expect(raw.disconnect).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1_000);
      expect(raw.disconnect).toHaveBeenCalledWith(true);
    });

    it('handles an expiry further away than setTimeout can wait', async () => {
      const days = 40;
      const { raw } = await connect(inSeconds(days * 24 * 3600));

      jest.advanceTimersByTime((days * 24 * 3600 - 1) * 1000);
      expect(raw.disconnect).not.toHaveBeenCalled();
      jest.advanceTimersByTime(1_000);
      expect(raw.disconnect).toHaveBeenCalledTimes(1);
    });

    it('stops the timer when the socket disconnects first', async () => {
      const { client, raw } = await connect(inSeconds(60));

      gateway.handleDisconnect(client);
      jest.advanceTimersByTime(120_000);

      expect(raw.disconnect).not.toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(0);
    });

    it('disconnects at once a token whose exp has already passed', async () => {
      const { client, raw } = await connect(inSeconds(-1));

      expect(raw.disconnect).toHaveBeenCalledWith(true);
      expect(client.data.user).toBeUndefined();
    });

    it('refuses register once the token has expired, without asking ms_admin', async () => {
      const { client, raw } = await connect(inSeconds(60));
      http.get.mockReset();
      // the clock passes exp before the timer has had a chance to run
      jest.setSystemTime(NOW + 61_000);

      await expect(gateway.registerRoom(5, client)).resolves.toEqual({
        OK: false,
      });
      expect(http.get).not.toHaveBeenCalled();
      expect(raw.join).not.toHaveBeenCalled();
      expect(raw.disconnect).toHaveBeenCalledWith(true);
    });

    it('sets no timer for a token without exp', async () => {
      await connect(undefined);

      expect(jest.getTimerCount()).toBe(0);
    });
  });

  describe('register', () => {
    /** Connects a client ms_auth accepts, then routes ms_admin calls to `admin`. */
    async function connectedMember(admin: () => unknown) {
      http.get.mockReturnValue(of(response(USER)));
      const fake = fakeClient(TOKEN);
      await gateway.handleConnection(fake.client);
      http.get.mockReset();
      http.get.mockImplementation(admin);
      return fake;
    }

    it('joins the channel room when ms_admin answers 200 for this user', async () => {
      const { client, raw, roomEmit } = await connectedMember(() =>
        of(response({ channelId: 5, workspaceId: 2 })),
      );

      await expect(gateway.registerRoom('5', client)).resolves.toEqual({
        OK: true,
      });
      expect(http.get).toHaveBeenCalledWith(
        `${ADMIN_HOST}/api/channel/5`,
        expect.objectContaining({ headers: { Authorization: TOKEN } }),
      );
      expect(raw.join).toHaveBeenCalledWith('5');
      // the join notice goes to that room only, never to every socket
      expect(raw.to).toHaveBeenCalledWith('5');
      expect(roomEmit).toHaveBeenCalledWith(
        'notification',
        expect.stringContaining('5'),
      );
      expect(gateway.server.emit).not.toHaveBeenCalled();
    });

    it.each([
      [403, 'not a member of the workspace'],
      [404, 'no such channel'],
      [401, 'token no longer valid'],
      [500, 'ms_admin failed'],
    ])(
      'refuses the room when ms_admin answers %i (%s)',
      async (status: number) => {
        const { client, raw } = await connectedMember(() =>
          of(response({ message: 'no' }, status)),
        );

        await expect(gateway.registerRoom(5, client)).resolves.toEqual({
          OK: false,
        });
        expect(raw.join).not.toHaveBeenCalled();
      },
    );

    it('refuses the room when ms_admin cannot be reached', async () => {
      const { client, raw } = await connectedMember(() =>
        throwError(() => new Error('connect ECONNREFUSED 127.0.0.1:3002')),
      );

      await expect(gateway.registerRoom(5, client)).resolves.toEqual({
        OK: false,
      });
      expect(raw.join).not.toHaveBeenCalled();
    });

    it('refuses a room name that is not a channel id, without asking ms_admin', async () => {
      const { client, raw } = await connectedMember(() =>
        of(response({}, 200)),
      );

      for (const room of ['../workspace/1', '5?x=1', '', null]) {
        await expect(
          gateway.registerRoom(room as never, client),
        ).resolves.toEqual({ OK: false });
      }
      expect(http.get).not.toHaveBeenCalled();
      expect(raw.join).not.toHaveBeenCalled();
    });

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

      http.get.mockReturnValue(of(response({ channelId: 5 })));
      answer(response(USER));
      await connecting;
      await expect(registering).resolves.toEqual({ OK: true });
      expect(raw.join).toHaveBeenCalledWith('5');
    });
  });
});
