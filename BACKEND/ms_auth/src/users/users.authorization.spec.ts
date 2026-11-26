import * as request from 'supertest';
import {
  ANA,
  AuthApp,
  PASSWORD,
  createAuthApp,
} from '../../test/support/auth-app';
import { UsersService } from './users.service';

/** True if a response body carries a password or a bcrypt hash anywhere. */
function leaksPassword(body: unknown): boolean {
  const text = JSON.stringify(body);
  return /"password"/.test(text) || /\$2[aby]\$/.test(text);
}

/**
 * Rules, measured over HTTP through ms_auth's real guards, strategies,
 * validators and Sequelize models (on SQLite):
 *  - only a user themself may change or delete their user (403 otherwise);
 *  - another user can be read only inside the caller's account, and only as
 *    a public profile; outside it the user does not exist (404);
 *  - the account comes from the token, never from the `account` header;
 *  - no endpoint ever returns a password or its hash.
 */
describe('users authorization (HTTP)', () => {
  let ctx: AuthApp;

  beforeAll(async () => {
    ctx = await createAuthApp();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  const server = () => ctx.app.getHttpServer();

  describe('no password or hash in any response', () => {
    it('POST /api/users (sign-up)', async () => {
      const res = await request(server())
        .post('/api/users')
        .set('account', '1')
        .send({
          name: 'carl',
          lastname: 'test',
          email: 'carl@example.test',
          username: 'carl',
          password: PASSWORD,
        })
        .expect(200);

      expect(res.body.userCreated.username).toBe('carl');
      expect(leaksPassword(res.body)).toBe(false);
    });

    it('POST /api/auth/login', async () => {
      const res = await request(server())
        .post('/api/auth/login')
        .set('account', '1')
        .send({
          grant_type: 'password',
          username: ANA.username,
          password: PASSWORD,
        })
        .expect(201);

      expect(res.body.user.userId).toBe(ctx.ana.userId);
      expect(res.body.token.accessToken).toBeTruthy();
      expect(leaksPassword(res.body)).toBe(false);
    });

    it('GET /api/users, GET /api/users/:id (self) and PUT /api/users/:id', async () => {
      const list = await request(server())
        .get('/api/users')
        .set('Authorization', ctx.ana.token)
        .expect(200);
      const self = await request(server())
        .get(`/api/users/${ctx.ana.userId}`)
        .set('Authorization', ctx.ana.token)
        .expect(200);
      const updated = await request(server())
        .put(`/api/users/${ctx.ana.userId}`)
        .set('Authorization', ctx.ana.token)
        .send({ name: 'Ana' })
        .expect(200);

      expect(list.body.length).toBeGreaterThan(0);
      expect(self.body.email).toBe(ANA.email);
      expect(updated.body.userUpdated.name).toBe('Ana');
      for (const body of [list.body, self.body, updated.body]) {
        expect(leaksPassword(body)).toBe(false);
      }
    });

    it('GET /api/auth/login (token check)', async () => {
      const res = await request(server())
        .get('/api/auth/login')
        .set('Authorization', ctx.ana.token)
        .expect(200);

      expect(res.body).toMatchObject({
        userId: ctx.ana.userId,
        accountId: 1,
      });
      expect(leaksPassword(res.body)).toBe(false);
    });
  });

  describe('GET /api/users/:userId', () => {
    it('shows another user of the same account as a public profile only', async () => {
      const res = await request(server())
        .get(`/api/users/${ctx.ana.userId}`)
        .set('Authorization', ctx.bob.token)
        .expect(200);

      expect(res.body).toEqual({
        userId: ctx.ana.userId,
        name: expect.any(String),
        lastname: 'test',
        username: ANA.username,
      });
    });

    it('answers 404 for a user of another account, as for a missing one', async () => {
      const foreign = await request(server())
        .get(`/api/users/${ctx.ana.userId}`)
        .set('Authorization', ctx.eve.token)
        .expect(404);
      const missing = await request(server())
        .get('/api/users/99999')
        .set('Authorization', ctx.ana.token)
        .expect(404);

      expect(JSON.stringify(foreign.body)).not.toContain(ANA.username);
      expect(foreign.body.message).toEqual(missing.body.message);
    });

    it('ignores an `account` header naming another account', async () => {
      await request(server())
        .get(`/api/users/${ctx.ana.userId}`)
        .set('Authorization', ctx.eve.token)
        .set('account', '1')
        .expect(404);
    });

    it('answers 401 without a valid token', async () => {
      await request(server())
        .get(`/api/users/${ctx.ana.userId}`)
        .set('Authorization', 'Bearer forged')
        .expect(401);
    });
  });

  describe('GET /api/users', () => {
    it("lists only the token's account, whatever the header says", async () => {
      const res = await request(server())
        .get('/api/users')
        .set('Authorization', ctx.eve.token)
        .set('account', '1')
        .expect(200);

      expect(res.body.map((u) => u.username)).toEqual(['eve']);
    });

    it('lists other users as public profiles (no email)', async () => {
      const res = await request(server())
        .get(`/api/users?username=${ANA.username}`)
        .set('Authorization', ctx.bob.token)
        .expect(200);

      expect(res.body).toEqual([
        {
          userId: ctx.ana.userId,
          name: expect.any(String),
          lastname: 'test',
          username: ANA.username,
        },
      ]);
    });
  });

  describe('PUT /api/users/:userId', () => {
    it('answers 403 to anyone but that user, and changes nothing', async () => {
      await request(server())
        .put(`/api/users/${ctx.ana.userId}`)
        .set('Authorization', ctx.bob.token)
        .send({ name: 'hacked' })
        .expect(403);
      await request(server())
        .put(`/api/users/${ctx.ana.userId}`)
        .set('Authorization', ctx.eve.token)
        .set('account', '1')
        .send({ name: 'hacked' })
        .expect(403);

      const ana = await request(server())
        .get(`/api/users/${ctx.ana.userId}`)
        .set('Authorization', ctx.ana.token)
        .expect(200);
      expect(ana.body.name).not.toBe('hacked');
    });

    it('changes only name and lastname, never the password or username', async () => {
      await request(server())
        .put(`/api/users/${ctx.ana.userId}`)
        .set('Authorization', ctx.ana.token)
        .send({ name: 'Ana', password: 'plain', username: 'root' })
        .expect(200);

      // the old password still works, under the old username
      await request(server())
        .post('/api/auth/login')
        .set('account', '1')
        .send({
          grant_type: 'password',
          username: ANA.username,
          password: PASSWORD,
        })
        .expect(201);
    });

    it('answers 500, not 403, when the write itself fails', async () => {
      const users = ctx.app.get(UsersService);
      const spy = jest
        .spyOn(users, 'updateUser')
        .mockRejectedValueOnce(new Error('db down'));

      const res = await request(server())
        .put(`/api/users/${ctx.ana.userId}`)
        .set('Authorization', ctx.ana.token)
        .set('account', '1')
        .send({ name: 'Ana' });

      spy.mockRestore();
      expect(res.status).toBe(500);
      expect(res.body.userUpdated).toBeUndefined();
    });
  });

  describe('DELETE /api/users/:userId', () => {
    it('answers 403 to anyone but that user, and deletes nothing', async () => {
      await request(server())
        .delete(`/api/users/${ctx.ana.userId}`)
        .set('Authorization', ctx.bob.token)
        .expect(403);
      await request(server())
        .delete(`/api/users/${ctx.ana.userId}`)
        .set('Authorization', ctx.eve.token)
        .expect(403);

      await request(server())
        .get(`/api/users/${ctx.ana.userId}`)
        .set('Authorization', ctx.ana.token)
        .expect(200);
    });

    it('lets a user delete themself; afterwards they are gone', async () => {
      await request(server())
        .delete(`/api/users/${ctx.bob.userId}`)
        .set('Authorization', ctx.bob.token)
        .expect(200);

      await request(server())
        .get(`/api/users/${ctx.bob.userId}`)
        .set('Authorization', ctx.ana.token)
        .expect(404);
    });
  });
});
