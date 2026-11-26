import appConfig from './app.config';
import { AppConfig } from './config.type';

/**
 * Rule: ms_socket cannot authenticate anyone without knowing where ms_auth
 * is, so a missing or malformed AUTH_HOST must stop it at startup.
 */
describe('app config', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('refuses to start without AUTH_HOST', () => {
    delete process.env.AUTH_HOST;
    expect(() => appConfig()).toThrow(/AUTH_HOST/);
  });

  it('refuses an AUTH_HOST without a protocol', () => {
    process.env.AUTH_HOST = 'localhost:3001';
    expect(() => appConfig()).toThrow(/AUTH_HOST/);
  });

  it('reads AUTH_HOST without its trailing slash', () => {
    process.env.AUTH_HOST = 'http://localhost:3001/';
    expect((appConfig() as AppConfig).authHost).toBe('http://localhost:3001');
  });
});
