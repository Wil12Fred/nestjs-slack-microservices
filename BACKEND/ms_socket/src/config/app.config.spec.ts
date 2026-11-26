import appConfig from './app.config';
import { AppConfig } from './config.type';

/**
 * Rule: ms_socket cannot authenticate anyone without ms_auth, nor check
 * channel membership without ms_admin, so a missing or malformed AUTH_HOST or
 * ADMIN_HOST must stop it at startup.
 */
describe('app config', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  beforeEach(() => {
    process.env.AUTH_HOST = 'http://localhost:3001';
    process.env.ADMIN_HOST = 'http://localhost:3002';
  });

  it('refuses to start without AUTH_HOST', () => {
    delete process.env.AUTH_HOST;
    expect(() => appConfig()).toThrow(/AUTH_HOST/);
  });

  it('refuses an AUTH_HOST without a protocol', () => {
    process.env.AUTH_HOST = 'localhost:3001';
    expect(() => appConfig()).toThrow(/AUTH_HOST/);
  });

  it('refuses to start without ADMIN_HOST', () => {
    delete process.env.ADMIN_HOST;
    expect(() => appConfig()).toThrow(/ADMIN_HOST/);
  });

  it('reads both hosts without their trailing slash', () => {
    process.env.AUTH_HOST = 'http://localhost:3001/';
    process.env.ADMIN_HOST = 'http://localhost:3002/';
    const config = appConfig() as AppConfig;
    expect(config.authHost).toBe('http://localhost:3001');
    expect(config.adminHost).toBe('http://localhost:3002');
  });
});
