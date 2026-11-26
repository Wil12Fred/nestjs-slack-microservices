import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bull';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuthProvider } from 'src/auth/auth.provider';
import { ChannelModule } from 'src/channel/channel.module';
import { Channel } from 'src/channel/models/channel.model';
import { ChannelMessage } from 'src/channel/models/channelMessage.model';
import { Message } from 'src/message/models/message.model';
import { UserWorkspace } from 'src/workspace/models/userWorkspace.model';
import { Workspace } from 'src/workspace/models/workspace.model';
import { WorkspaceModule } from 'src/workspace/workspace.module';

/**
 * The real WorkspaceModule and ChannelModule (controllers, guard,
 * interceptors, services) served over HTTP, with only the edges replaced:
 * TypeORM repositories by in-memory tables, ms_auth by a token map and a user
 * directory, and the Bull queue by a spy. No MySQL, Redis or ms_auth needed.
 *
 * Seed: workspace 10 (account 1) has channel 100 and one member, MEMBER.
 * OUTSIDER is a valid user of the same account who belongs to no workspace.
 * FOREIGNER is a user of account 2. Workspace 20 belongs to account 2 and has
 * channel 200; MEMBER has a (legacy) membership row in it, so it shows what
 * the token's account adds to the membership rule.
 */
export const MEMBER = { userId: 1, accountId: 1, username: 'ana' };
export const OUTSIDER = { userId: 2, accountId: 1, username: 'eve' };
export const INVITEE = { userId: 3, accountId: 1, username: 'bob' };
export const FOREIGNER = { userId: 4, accountId: 2, username: 'zoe' };
export const AS_MEMBER = 'Bearer member-token';
export const AS_OUTSIDER = 'Bearer outsider-token';

type Row = Record<string, any>;

/** A minimal TypeORM Repository over an array: just what the services call. */
export class FakeRepository<T extends Row> {
  /** Resolvers for `relations: [...]`, keyed by relation name. */
  joins: Record<string, (row: T) => unknown> = {};

  constructor(
    public rows: T[],
    private readonly key: string,
  ) {}

  private matches(row: T, where: Row = {}): boolean {
    return Object.entries(where).every(([k, v]) => row[k] === v);
  }

  private withRelations(row: T, relations: string[] = []): T {
    const joined: Row = { ...row };
    for (const relation of relations) {
      if (this.joins[relation]) joined[relation] = this.joins[relation](row);
    }
    return joined as T;
  }

  count = jest.fn(
    async ({ where }: { where?: Row } = {}) =>
      this.rows.filter((r) => this.matches(r, where)).length,
  );

  find = jest.fn(
    async ({ where, relations }: { where?: Row; relations?: string[] } = {}) =>
      this.rows
        .filter((r) => this.matches(r, where))
        .map((r) => this.withRelations(r, relations)),
  );

  findOne = jest.fn(
    async ({
      where,
      relations,
    }: { where?: Row; relations?: string[] } = {}) => {
      const row = this.rows.find((r) => this.matches(r, where));
      return row ? this.withRelations(row, relations) : null;
    },
  );

  save = jest.fn(async (entity: Row) => {
    const row = {
      ...entity,
      [this.key]: entity[this.key] ?? this.rows.length + 1000,
    } as unknown as T;
    this.rows.push(row);
    return row;
  });
}

export interface MembershipApp {
  app: INestApplication;
  userWorkspaces: FakeRepository<Row>;
  workspaces: FakeRepository<Row>;
  channels: FakeRepository<Row>;
  messages: FakeRepository<Row>;
  channelMessages: FakeRepository<Row>;
  queue: { add: jest.Mock };
  auth: { validateToken: jest.Mock; getUser: jest.Mock };
}

export async function createMembershipApp(): Promise<MembershipApp> {
  const channels = new FakeRepository<Row>(
    [
      { channelId: 100, workspaceId: 10, name: 'general', channelMessages: [] },
      { channelId: 200, workspaceId: 20, name: 'other', channelMessages: [] },
    ],
    'channelId',
  );
  const workspaces = new FakeRepository<Row>(
    [
      {
        workspaceId: 10,
        accountId: 1,
        name: 'acme',
        channels: channels.rows.filter((c) => c.workspaceId === 10),
      },
      {
        workspaceId: 20,
        accountId: 2,
        name: 'elsewhere',
        channels: channels.rows.filter((c) => c.workspaceId === 20),
      },
    ],
    'workspaceId',
  );
  const userWorkspaces = new FakeRepository<Row>(
    [
      { userWorkspaceId: 1, userId: MEMBER.userId, workspaceId: 10 },
      { userWorkspaceId: 2, userId: MEMBER.userId, workspaceId: 20 },
    ],
    'userWorkspaceId',
  );
  userWorkspaces.joins.workspace = (row) =>
    workspaces.rows.find((w) => w.workspaceId === row.workspaceId);
  const messages = new FakeRepository<Row>([], 'messageId');
  const channelMessages = new FakeRepository<Row>([], 'channelMessageId');
  const queue = { add: jest.fn(), process: jest.fn(), on: jest.fn() };

  const users: Record<string, Row> = {
    [AS_MEMBER]: MEMBER,
    [AS_OUTSIDER]: OUTSIDER,
  };
  const directory = [MEMBER, OUTSIDER, INVITEE, FOREIGNER];

  // ms_auth: a token map, and GET /api/users/:id as ms_auth answers it — the
  // user if they share the caller's account, otherwise "not found" (null)
  const auth = {
    validateToken: jest.fn(async (authorization: string) => {
      if (!users[authorization]) throw new Error('401 from ms_auth');
      return users[authorization];
    }),
    getUser: jest.fn(async (authorization: string, userId: number) => {
      const caller = users[authorization];
      const user = directory.find((u) => u.userId === userId);
      return user && caller && user.accountId === caller.accountId
        ? user
        : null;
    }),
  };

  const moduleRef = await Test.createTestingModule({
    imports: [WorkspaceModule, ChannelModule],
  })
    .overrideProvider(getRepositoryToken(Workspace))
    .useValue(workspaces)
    .overrideProvider(getRepositoryToken(UserWorkspace))
    .useValue(userWorkspaces)
    .overrideProvider(getRepositoryToken(Channel))
    .useValue(channels)
    .overrideProvider(getRepositoryToken(Message))
    .useValue(messages)
    .overrideProvider(getRepositoryToken(ChannelMessage))
    .useValue(channelMessages)
    .overrideProvider(getQueueToken('messages'))
    .useValue(queue)
    .overrideProvider(AuthProvider)
    .useValue(auth)
    .compile();

  // as in main.ts
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe());
  app.setGlobalPrefix('api');
  await app.init();

  return {
    app,
    userWorkspaces,
    workspaces,
    channels,
    messages,
    channelMessages,
    queue,
    auth,
  };
}
