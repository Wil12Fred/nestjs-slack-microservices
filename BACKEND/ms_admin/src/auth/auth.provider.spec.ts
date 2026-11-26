import { HttpService } from '@nestjs/axios';
import { AxiosError, AxiosHeaders, AxiosResponse } from 'axios';
import { of, throwError } from 'rxjs';
import { AuthProvider } from './auth.provider';

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
    response({}, status),
  );
}

/**
 * Rule: ms_auth's 404 for GET /api/users/:id means "no such user in your
 * account" and becomes null (the invite then answers 404); every other
 * failure is an error, so an outage is never mistaken for a missing user.
 */
describe('AuthProvider.getUser', () => {
  const TOKEN = 'Bearer caller.jwt';
  let http: { get: jest.Mock };
  let provider: AuthProvider;

  beforeEach(() => {
    process.env.AUTH_HOST = 'http://auth.test';
    http = { get: jest.fn() };
    provider = new AuthProvider(http as unknown as HttpService);
  });

  it("asks ms_auth for the user with the caller's token", async () => {
    http.get.mockReturnValue(of(response({ userId: 3, username: 'bob' })));

    await expect(provider.getUser(TOKEN, 3)).resolves.toEqual({
      userId: 3,
      username: 'bob',
    });
    expect(http.get).toHaveBeenCalledWith('http://auth.test/api/users/3', {
      headers: { Authorization: TOKEN },
    });
  });

  it('returns null when ms_auth answers 404', async () => {
    http.get.mockReturnValue(throwError(() => httpError(404)));

    await expect(provider.getUser(TOKEN, 3)).resolves.toBeNull();
  });

  it.each([401, 403, 500])(
    'rejects when ms_auth answers %i',
    async (status) => {
      http.get.mockReturnValue(throwError(() => httpError(status)));

      await expect(provider.getUser(TOKEN, 3)).rejects.toThrow(String(status));
    },
  );

  it('rejects when ms_auth cannot be reached', async () => {
    http.get.mockReturnValue(throwError(() => new Error('ECONNREFUSED')));

    await expect(provider.getUser(TOKEN, 3)).rejects.toThrow('ECONNREFUSED');
  });
});
