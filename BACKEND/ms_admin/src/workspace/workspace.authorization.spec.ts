import * as request from 'supertest';
import {
  AS_MEMBER,
  AS_OUTSIDER,
  FOREIGNER,
  INVITEE,
  MEMBER,
  MembershipApp,
  OUTSIDER,
  createMembershipApp,
} from '../../test/support/membership-app';

/**
 * Rule: only a member of a workspace (a user_workspaces row for userId +
 * workspaceId) may see it or add people to it. Measured over HTTP through the
 * real guard, interceptors, pipes and services; only storage is faked.
 */
describe('workspace authorization (HTTP)', () => {
  let ctx: MembershipApp;

  beforeEach(async () => {
    ctx = await createMembershipApp();
  });

  afterEach(async () => {
    await ctx.app.close();
  });

  const server = () => ctx.app.getHttpServer();

  describe('GET /api/workspace/:workspaceId', () => {
    it('returns the workspace and its channels to a member', async () => {
      const res = await request(server())
        .get('/api/workspace/10')
        .set('Authorization', AS_MEMBER)
        .expect(200);

      expect(res.body.workspaceId).toBe(10);
      expect(res.body.channels.map((c) => c.channelId)).toEqual([100]);
    });

    it('answers 403 to a valid user who is not a member', async () => {
      const res = await request(server())
        .get('/api/workspace/10')
        .set('Authorization', AS_OUTSIDER)
        .expect(403);

      expect(JSON.stringify(res.body)).not.toContain('general');
    });

    it('answers 403 for a workspace id nobody is a member of', async () => {
      await request(server())
        .get('/api/workspace/999')
        .set('Authorization', AS_MEMBER)
        .expect(403);
    });

    it('answers 403 without a token ms_auth accepts', async () => {
      await request(server())
        .get('/api/workspace/10')
        .set('Authorization', 'Bearer forged')
        .expect(403);
    });
  });

  describe('GET /api/workspace', () => {
    it("lists only the caller's workspaces", async () => {
      const mine = await request(server())
        .get('/api/workspace')
        .set('Authorization', AS_MEMBER)
        .expect(200);
      const theirs = await request(server())
        .get('/api/workspace')
        .set('Authorization', AS_OUTSIDER)
        .expect(200);

      expect(ctx.userWorkspaces.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: MEMBER.userId } }),
      );
      // MEMBER's row in workspace 20 is ignored: it is in another account
      expect(mine.body.map((w) => w.workspaceId)).toEqual([10]);
      expect(theirs.body).toEqual([]);
    });
  });

  describe('POST /api/workspace/:workspaceId/user', () => {
    const invite = (token: string, workspaceId: number, body: object) =>
      request(server())
        .post(`/api/workspace/${workspaceId}/user`)
        .set('Authorization', token)
        .set('account', '1')
        .send(body);

    it('lets a member add a user', async () => {
      const res = await invite(AS_MEMBER, 10, {
        invitedUserId: INVITEE.userId,
      }).expect(200);

      expect(res.body.userWorkspaceCreated).toMatchObject({
        userId: INVITEE.userId,
        workspaceId: 10,
      });
      expect(
        ctx.userWorkspaces.rows.filter((r) => r.userId === INVITEE.userId),
      ).toHaveLength(1);
    });

    it('answers 403 when a non-member tries to add anyone (themselves included)', async () => {
      await invite(AS_OUTSIDER, 10, {
        invitedUserId: OUTSIDER.userId,
      }).expect(403);

      expect(ctx.userWorkspaces.save).not.toHaveBeenCalled();
      expect(ctx.userWorkspaces.rows).toHaveLength(2);
    });

    it('uses the route workspaceId, not one smuggled in the body', async () => {
      // OUTSIDER is not a member of 10; naming a workspace in the body must
      // not change which workspace is checked or written
      await invite(AS_OUTSIDER, 10, {
        invitedUserId: OUTSIDER.userId,
        workspaceId: 999,
      }).expect(403);
      await invite(AS_MEMBER, 10, {
        invitedUserId: INVITEE.userId,
        workspaceId: 999,
      }).expect(200);

      expect(ctx.userWorkspaces.save).toHaveBeenCalledTimes(1);
      expect(ctx.userWorkspaces.save).toHaveBeenCalledWith({
        userId: INVITEE.userId,
        workspaceId: 10,
      });
    });

    it('does not duplicate a user who is already a member', async () => {
      await invite(AS_MEMBER, 10, { invitedUserId: INVITEE.userId }).expect(
        200,
      );
      const again = await invite(AS_MEMBER, 10, {
        invitedUserId: INVITEE.userId,
      }).expect(200);
      await invite(AS_MEMBER, 10, { invitedUserId: MEMBER.userId }).expect(200);

      expect(again.body.userWorkspaceCreated.userId).toBe(INVITEE.userId);
      expect(ctx.userWorkspaces.save).toHaveBeenCalledTimes(1);
      expect(ctx.userWorkspaces.rows).toHaveLength(3);
    });

    it("asks ms_auth for the invitee with the caller's own token", async () => {
      await invite(AS_MEMBER, 10, { invitedUserId: INVITEE.userId }).expect(
        200,
      );

      expect(ctx.auth.getUser).toHaveBeenCalledWith(AS_MEMBER, INVITEE.userId);
    });

    it('answers 404 for an invitee ms_auth does not know, adding nothing', async () => {
      const res = await invite(AS_MEMBER, 10, {
        invitedUserId: 99999,
      }).expect(404);

      expect(res.body.userWorkspaceCreated).toBeUndefined();
      expect(ctx.userWorkspaces.save).not.toHaveBeenCalled();
    });

    it('answers 404 for a user of another account (ms_auth hides them)', async () => {
      await invite(AS_MEMBER, 10, {
        invitedUserId: FOREIGNER.userId,
      }).expect(404);

      expect(ctx.userWorkspaces.save).not.toHaveBeenCalled();
    });

    it('checks membership first: a non-member learns nothing about the invitee', async () => {
      await invite(AS_OUTSIDER, 10, { invitedUserId: 99999 }).expect(403);

      expect(ctx.auth.getUser).not.toHaveBeenCalled();
    });

    it('answers 500, not 403, when ms_auth cannot be asked', async () => {
      ctx.auth.getUser.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      await invite(AS_MEMBER, 10, { invitedUserId: INVITEE.userId }).expect(
        500,
      );
      expect(ctx.userWorkspaces.save).not.toHaveBeenCalled();
    });

    it('answers 500, not 403, when the membership write fails', async () => {
      ctx.userWorkspaces.save.mockRejectedValueOnce(new Error('db down'));

      const res = await invite(AS_MEMBER, 10, {
        invitedUserId: INVITEE.userId,
      });

      expect(res.status).toBe(500);
      expect(res.body.userWorkspaceCreated).toBeUndefined();
    });
  });

  describe("the token's account, not the account header", () => {
    it('stamps a new workspace with the account of the token', async () => {
      await request(server())
        .post('/api/workspace')
        .set('Authorization', AS_MEMBER)
        .set('account', '2')
        .send({ name: 'mine', accountId: 2 })
        .expect(200);
      await request(server())
        .post('/api/workspace')
        .set('Authorization', AS_MEMBER)
        .send({ name: 'no header' })
        .expect(200);

      expect(ctx.workspaces.save).toHaveBeenCalledTimes(2);
      for (const [saved] of ctx.workspaces.save.mock.calls) {
        expect(saved).toEqual({ name: expect.any(String), accountId: 1 });
      }
    });

    it('hides a workspace of another account even from one of its members', async () => {
      await request(server())
        .get('/api/workspace/20')
        .set('Authorization', AS_MEMBER)
        .set('account', '2')
        .expect(403);
      await request(server())
        .post('/api/workspace/20/user')
        .set('Authorization', AS_MEMBER)
        .set('account', '2')
        .send({ invitedUserId: INVITEE.userId })
        .expect(403);

      expect(ctx.userWorkspaces.save).not.toHaveBeenCalled();
    });
  });

  describe('errors that are not 403/404', () => {
    it('POST /api/workspace answers 500 when the insert fails', async () => {
      ctx.workspaces.save.mockRejectedValueOnce(new Error('db down'));

      const res = await request(server())
        .post('/api/workspace')
        .set('Authorization', AS_MEMBER)
        .send({ name: 'x' });

      expect(res.status).toBe(500);
      expect(res.body.workspaceCreated).toBeUndefined();
    });

    it('GET /api/workspace answers 500 when the query fails', async () => {
      ctx.userWorkspaces.find.mockRejectedValueOnce(new Error('db down'));

      await request(server())
        .get('/api/workspace')
        .set('Authorization', AS_MEMBER)
        .expect(500);
    });
  });
});
