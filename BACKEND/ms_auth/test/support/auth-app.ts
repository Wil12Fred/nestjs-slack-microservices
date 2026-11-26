import { INestApplication, Module, ValidationPipe } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { Test } from '@nestjs/testing';
import { useContainer } from 'class-validator';
import * as request from 'supertest';
import { AccountModule } from 'src/accounts/accounts.module';
import { Accounts } from 'src/accounts/models/accounts.model';
import { AuthModule } from 'src/auth/auth.module';
import { UsersModule } from 'src/users/users.module';
import {
  AlreadyExistEmailConstraint,
  AlreadyExistUsernameConstraint,
  NonExistAccountConstraint,
  NonExistUserConstraint,
} from 'src/utils/custom-validations.service';

/**
 * ms_auth's real modules (controllers, guards, Passport strategies, pipes,
 * custom validators, Sequelize models) served over HTTP. The one edge that is
 * replaced is MySQL: Sequelize runs on an in-memory SQLite database, so the
 * models — including how they serialise — are the real ones.
 *
 * Seed, all through the public HTTP API: account 1 has ANA and BOB, account 2
 * has EVE. Each is logged in, so `tokens` holds a real JWT per user.
 */
export const PASSWORD = 's3cret-pass';

export const ANA = { username: 'ana', email: 'ana@example.test', account: 1 };
export const BOB = { username: 'bob', email: 'bob@example.test', account: 1 };
export const EVE = { username: 'eve', email: 'eve@example.test', account: 2 };

export interface SeededUser {
  userId: number;
  accountId: number;
  token: string;
}

export interface AuthApp {
  app: INestApplication;
  ana: SeededUser;
  bob: SeededUser;
  eve: SeededUser;
}

process.env.JWT_SECRET_KEY = process.env.JWT_SECRET_KEY || 'test-secret';
process.env.JWT_EXPIRATION_TIME = process.env.JWT_EXPIRATION_TIME || '1h';

@Module({
  imports: [
    SequelizeModule.forRoot({
      dialect: 'sqlite',
      storage: ':memory:',
      logging: false,
      models: [Accounts],
      autoLoadModels: true,
      synchronize: true,
    }),
    AccountModule,
    UsersModule,
    AuthModule,
  ],
  // as in AppModule: the custom validators resolve services from the container
  providers: [
    NonExistUserConstraint,
    NonExistAccountConstraint,
    AlreadyExistEmailConstraint,
    AlreadyExistUsernameConstraint,
  ],
})
class TestAuthModule {}

async function signUpAndLogIn(
  app: INestApplication,
  who: { username: string; email: string; account: number },
): Promise<SeededUser> {
  const server = app.getHttpServer();
  const created = await request(server)
    .post('/api/users')
    .set('account', String(who.account))
    .send({
      name: who.username,
      lastname: 'test',
      email: who.email,
      username: who.username,
      password: PASSWORD,
    });
  if (created.status !== 200) {
    throw new Error(`sign-up ${who.username}: ${JSON.stringify(created.body)}`);
  }
  const login = await request(server)
    .post('/api/auth/login')
    .set('account', String(who.account))
    .send({
      grant_type: 'password',
      username: who.username,
      password: PASSWORD,
    });
  if (login.status !== 201) {
    throw new Error(`login ${who.username}: ${JSON.stringify(login.body)}`);
  }
  return {
    userId: created.body.userCreated.userId,
    accountId: who.account,
    token: `Bearer ${login.body.token.accessToken}`,
  };
}

export async function createAuthApp(): Promise<AuthApp> {
  const moduleRef = await Test.createTestingModule({
    imports: [TestAuthModule],
  }).compile();

  // as in main.ts
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe());
  app.setGlobalPrefix('api');
  useContainer(app.select(TestAuthModule), { fallbackOnErrors: true });
  await app.init();

  const server = app.getHttpServer();
  for (const name of ['first', 'second']) {
    await request(server)
      .post('/api/accounts')
      .send({ name, description: name, type: 'PRODUCT', status: 'ACTIVE' })
      .expect(200);
  }

  return {
    app,
    ana: await signUpAndLogIn(app, ANA),
    bob: await signUpAndLogIn(app, BOB),
    eve: await signUpAndLogIn(app, EVE),
  };
}
