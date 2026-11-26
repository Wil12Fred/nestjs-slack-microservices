import * as request from 'supertest';
import {
  AS_MEMBER,
  AS_OUTSIDER,
  MEMBER,
  MembershipApp,
  createMembershipApp,
} from '../../test/support/membership-app';

/**
 * Rule: a channel belongs to one workspace (Channel.workspaceId), and only a
 * member of that workspace may read it, post to it, or create a channel in
 * it. A non-member gets 403 — not a 500, and not a 200 with empty data — and
 * a channel that does not exist gets 404. Measured over HTTP through the real
 * guard, interceptors, pipes and services; only storage is faked.
 */
describe('channel authorization (HTTP)', () => {
  let ctx: MembershipApp;

  beforeEach(async () => {
    ctx = await createMembershipApp();
  });

  afterEach(async () => {
    await ctx.app.close();
  });

  const server = () => ctx.app.getHttpServer();

  describe('GET /api/channel/:channelId', () => {
    it('returns the channel to a member of its workspace', async () => {
      const res = await request(server())
        .get('/api/channel/100')
        .set('Authorization', AS_MEMBER)
        .expect(200);

      expect(res.body).toMatchObject({ channelId: 100, workspaceId: 10 });
    });

    it('answers 403 to a valid user who is not a member', async () => {
      const res = await request(server())
        .get('/api/channel/100')
        .set('Authorization', AS_OUTSIDER)
        .expect(403);

      expect(JSON.stringify(res.body)).not.toContain('general');
    });

    it('answers 404 for a channel that does not exist', async () => {
      await request(server())
        .get('/api/channel/555')
        .set('Authorization', AS_MEMBER)
        .expect(404);
    });
  });

  describe('POST /api/channel/:channelId/message', () => {
    const post = (token: string, channelId: number, body: object = {}) =>
      request(server())
        .post(`/api/channel/${channelId}/message`)
        .set('Authorization', token)
        .send({ text: 'hello', ...body });

    it('stores and queues a message from a member', async () => {
      const res = await post(AS_MEMBER, 100).expect(200);

      expect(res.body.messageCreated).toMatchObject({
        userId: MEMBER.userId,
        text: 'hello',
      });
      expect(ctx.channelMessages.save).toHaveBeenCalledWith({
        messageId: res.body.messageCreated.messageId,
        channelId: 100,
      });
      expect(ctx.queue.add).toHaveBeenCalledWith('transcode', {
        message: expect.objectContaining({ channelId: 100, text: 'hello' }),
      });
    });

    it('answers 403 to a non-member and stores and queues nothing', async () => {
      await post(AS_OUTSIDER, 100).expect(403);

      expect(ctx.messages.save).not.toHaveBeenCalled();
      expect(ctx.channelMessages.save).not.toHaveBeenCalled();
      expect(ctx.queue.add).not.toHaveBeenCalled();
    });

    it('answers 404 for a channel that does not exist, storing nothing', async () => {
      await post(AS_MEMBER, 555).expect(404);

      expect(ctx.messages.save).not.toHaveBeenCalled();
      expect(ctx.queue.add).not.toHaveBeenCalled();
    });

    it('answers 500, not 403, when storing the message fails', async () => {
      ctx.messages.save.mockRejectedValueOnce(new Error('db down'));

      const res = await post(AS_MEMBER, 100);

      expect(res.status).toBe(500);
      expect(res.body.messageCreated).toBeUndefined();
      expect(ctx.queue.add).not.toHaveBeenCalled();
    });
  });

  describe("a channel of another account's workspace", () => {
    it('is refused even to a member of that workspace', async () => {
      await request(server())
        .get('/api/channel/200')
        .set('Authorization', AS_MEMBER)
        .set('account', '2')
        .expect(403);
      await request(server())
        .post('/api/channel/200/message')
        .set('Authorization', AS_MEMBER)
        .set('account', '2')
        .send({ text: 'hello' })
        .expect(403);
      await request(server())
        .post('/api/channel')
        .set('Authorization', AS_MEMBER)
        .set('account', '2')
        .send({ workspaceId: 20, name: 'sneaky' })
        .expect(403);

      expect(ctx.messages.save).not.toHaveBeenCalled();
      expect(ctx.channels.save).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/channel', () => {
    const create = (token: string, body: object) =>
      request(server())
        .post('/api/channel')
        .set('Authorization', token)
        .send(body);

    it('lets a member create a channel in their workspace', async () => {
      const res = await create(AS_MEMBER, {
        workspaceId: 10,
        name: 'random',
      }).expect(200);

      expect(res.body.channelCreated).toMatchObject({
        workspaceId: 10,
        name: 'random',
      });
    });

    it('answers 403 to a non-member and creates nothing', async () => {
      await create(AS_OUTSIDER, { workspaceId: 10, name: 'mine' }).expect(403);
      await create(AS_MEMBER, { workspaceId: 999, name: 'elsewhere' }).expect(
        403,
      );

      expect(ctx.channels.save).not.toHaveBeenCalled();
    });

    it('answers 500, not 403, when storing the channel fails', async () => {
      ctx.channels.save.mockRejectedValueOnce(new Error('db down'));

      const res = await create(AS_MEMBER, { workspaceId: 10, name: 'x' });

      expect(res.status).toBe(500);
      expect(res.body.channelCreated).toBeUndefined();
    });
  });
});
