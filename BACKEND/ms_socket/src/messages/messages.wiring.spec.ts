import { INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bull';
import { AddressInfo } from 'net';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import { AppModule } from 'src/app.module';
import { RedisModule } from 'src/redis/redis.module';
import { EventsGateway } from 'src/events/events.gateway';
import { MessageProcessor } from './messages.processor';

/** Stands in for RedisModule so the test needs no Redis server. */
@Module({})
class NoRedisModule {}

/**
 * Rule: there is exactly ONE EventsGateway. The queue processor must emit
 * through the same instance whose server the clients are connected to, and a
 * connection must be handled once — two gateway instances bound to one
 * Socket.IO server each run handleConnection (and every auth call in it).
 *
 * Boots the real AppModule wiring; only Redis and the Bull queue are stubbed.
 */
describe('EventsGateway wiring (AppModule)', () => {
  let app: INestApplication;
  let url: string;
  let handleConnection: jest.SpyInstance;

  beforeAll(async () => {
    process.env.AUTH_HOST = 'http://auth.test';
    handleConnection = jest
      .spyOn(EventsGateway.prototype, 'handleConnection')
      .mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideModule(RedisModule)
      .useModule(NoRedisModule)
      .overrideProvider(getQueueToken('messages'))
      .useValue({ process: jest.fn(), on: jest.fn(), close: jest.fn() })
      .compile();

    app = moduleRef.createNestApplication();
    await app.listen(0);
    const { port } = app.getHttpServer().address() as AddressInfo;
    url = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    handleConnection.mockRestore();
    await app?.close();
  });

  it('gives the processor the same gateway instance the app resolves', () => {
    const processor = app.get(MessageProcessor);
    const gateway = app.get(EventsGateway);
    expect(processor['eventsGateway']).toBe(gateway);
    expect(gateway.server).toBeDefined();
  });

  it('handles one client connection exactly once', async () => {
    handleConnection.mockClear();
    const client: ClientSocket = ioClient(url, {
      transports: ['websocket'],
      forceNew: true,
    });
    await new Promise<void>((resolve, reject) => {
      client.on('connect', () => resolve());
      client.on('connect_error', reject);
    });
    // let every connection listener run
    await new Promise((resolve) => setTimeout(resolve, 50));
    client.close();
    expect(handleConnection).toHaveBeenCalledTimes(1);
  });

  it('emits a queued message through that gateway to the channel room', () => {
    const processor = app.get(MessageProcessor);
    const gateway = app.get(EventsGateway);
    const emit = jest.fn();
    const to = jest.spyOn(gateway.server, 'to').mockReturnValue({
      emit,
    } as never);

    const message = { channelId: 7, text: 'hi' };
    processor.handleTranscode({ data: { message } } as never);

    expect(to).toHaveBeenCalledWith('7');
    expect(emit).toHaveBeenCalledWith('message', message);
    to.mockRestore();
  });
});
