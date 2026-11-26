import { Module } from '@nestjs/common';
import { ChannelService } from './channel.service';
import { ChannelController } from './channel.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Channel } from './models/channel.model';
import { AuthModule } from 'src/auth/auth.module';
import { MessageModule } from 'src/message/message.module';
import { ChannelMessage } from './models/channelMessage.model';
import { BullModule } from '@nestjs/bull';
import { WorkspaceModule } from 'src/workspace/workspace.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Channel, ChannelMessage]),
    AuthModule,
    MessageModule,
    WorkspaceModule,
    BullModule.registerQueue({
      name: 'messages',
    }),
  ],
  providers: [ChannelService],
  controllers: [ChannelController],
  exports: [ChannelService],
})
export class ChannelModule {}
