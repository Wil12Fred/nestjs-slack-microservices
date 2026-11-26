import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { EventsGateway } from 'src/events/events.gateway';

@Processor('messages')
export class MessageProcessor {
  private readonly logger = new Logger(MessageProcessor.name);

  constructor(private readonly eventsGateway: EventsGateway) {}

  @Process('transcode')
  handleTranscode(job: Job) {
    this.logger.debug(
      `Start transcoding room ${job.data.message.channelId}...`,
    );
    this.logger.debug(job.data);
    // rooms are joined by string name; a numeric channelId would match none
    this.eventsGateway.server
      .to(String(job.data.message.channelId))
      .emit('message', job.data.message);
    this.logger.debug('Transcoding completed');
  }
}
