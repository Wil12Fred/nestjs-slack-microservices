import { BullModule } from '@nestjs/bull';
import { Module } from '@nestjs/common';
import { MessageProcessor } from './messages.processor';
import { EventsModule } from 'src/events/events.module';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'messages',
    }),
    EventsModule,
  ],
  providers: [MessageProcessor],
  exports: [BullModule],
})
export class MessagesModule {}
