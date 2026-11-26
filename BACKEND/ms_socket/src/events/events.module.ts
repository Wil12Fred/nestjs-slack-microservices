import { Module } from '@nestjs/common';
import { EventsGateway } from './events.gateway';
import { RedisModule } from 'src/redis/redis.module';

/**
 * Owns the one EventsGateway instance. Anything that needs to emit to the
 * Socket.IO server (the queue processor) imports this module instead of
 * listing the gateway in its own providers, which would create a second
 * gateway bound to the same server and run every connection handler twice.
 */
@Module({
  imports: [RedisModule],
  providers: [EventsGateway],
  exports: [EventsGateway],
})
export class EventsModule {}
