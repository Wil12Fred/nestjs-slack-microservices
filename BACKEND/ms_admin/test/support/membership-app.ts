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
 * interceptors, middleware, services) served over HTTP, with only the edges
 * replaced: TypeORM repositories by in-memory tables, ms_auth by a token map,
 * and the Bull queue by a spy. No MySQL, Redis or ms_auth needed.
 *
 * Seed: workspace 10 has channel 100 and one member, MEMBER. OUTSIDER is a
 * valid user of the same account who belongs to no workspace.
 */
export const MEMBER = { userId: 1, accountId: 1, username: 'ana' };
export const OUTSIDER = { userId: 2, accountId: 1, username: 'eve' };
export const INVITEE = { userId: 3, accountId: 1, username: 'bob' };
export const AS_MEMBER = 'Bearer member-token';
export const AS_OUTSIDER = 'Bearer outsider-token';

type Row = Record<string, any>;

/** A minimal TypeORM Repository over an array: just what the services call. */
export class FakeRepository<T extends Row> {
  constructor(
    public rows: T[],
    private readonly key: string,
  ) {}

  private matches(row: T, where: Row = {}): boolean {
    return Object.entries(where).every(([k, v]) => row[k] === v);
  }

  count = jest.fn(
    async ({ where }: { where?: Row } = {}) =>
      this.rows.filter((r) => this.matches(r, where)).length,
  );

  find = jest.fn(async ({ where }: { where?: Row } = {}) =>
    this.rows.filter((r) => this.matches(r, where)),
  );

  findOne = jest.fn(
    async ({ where }: { where?: Row } = {}) =>
      this.rows.find((r) => this.matches(r, where)) ?? null,
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
}

export async function createMembershipApp(): Promise<MembershipApp> {
  const channels = new FakeRepository<Row>(
    [{ channelId: 100, workspaceId: 10, name: 'general', channelMessages: [] }],
    'channelId',
  );
  const workspaces = new FakeRepository<Row>(
    [
      {
        workspaceId: 10,
        accountId: 1,
        name: 'acme',
        channels: channels.rows,
      },
    ],
    'workspaceId',
  );
  const userWorkspaces = new FakeRepository<Row>(
    [{ userWorkspaceId: 1, userId: MEMBER.userId, workspaceId: 10 }],
    'userWorkspaceId',
  );
  const messages = new FakeRepository<Row>([], 'messageId');
  const channelMessages = new FakeRepository<Row>([], 'channelMessageId');
  const queue = { add: jest.fn(), process: jest.fn(), on: jest.fn() };

  const users: Record<string, Row> = {
    [AS_MEMBER]: MEMBER,
    [AS_OUTSIDER]: OUTSIDER,
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
    .useValue({
      validateToken: async (authorization: string) => {
        if (!users[authorization]) throw new Error('401 from ms_auth');
        return users[authorization];
      },
    })
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
  };
}
