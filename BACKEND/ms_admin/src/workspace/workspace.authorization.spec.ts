import * as request from 'supertest';
import {
  AS_MEMBER,
  AS_OUTSIDER,
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
      expect(mine.body).toHaveLength(1);
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
      expect(ctx.userWorkspaces.rows).toHaveLength(1);
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
      expect(ctx.userWorkspaces.rows).toHaveLength(2);
    });
  });
});
