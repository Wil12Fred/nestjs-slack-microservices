import { Injectable, NotFoundException } from '@nestjs/common';
import { Channel } from './models/channel.model';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { ChannelMessage } from './models/channelMessage.model';
import { CreateChannelMessageDTO } from './dto/createChannelMessage.dto';
import { CreateChannelDTO } from './dto/createChannel.dto';
import { Message } from 'src/message/models/message.model';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { Caller, WorkspaceService } from 'src/workspace/workspace.service';

/**
 * A channel belongs to exactly one workspace (Channel.workspaceId), so access
 * to a channel is membership of that workspace, checked by WorkspaceService.
 */
@Injectable()
export class ChannelService {
  constructor(
    @InjectRepository(Channel)
    private repository: Repository<Channel>,
    @InjectRepository(Message)
    private messageRepository: Repository<Message>,
    @InjectRepository(ChannelMessage)
    private channelMessageRepository: Repository<ChannelMessage>,
    @InjectQueue('messages') private readonly messagesQueue: Queue,
    private readonly workspaceService: WorkspaceService,
  ) {}

  /** Creates a channel in a workspace the caller is a member of (else 403). */
  async createOne(channel: CreateChannelDTO, user: Caller): Promise<Channel> {
    await this.workspaceService.assertMember(user, channel.workspaceId);
    return await this.repository.save({
      workspaceId: Number(channel.workspaceId),
      name: channel.name,
    });
  }

  async getOne(channelId: number) {
    return await this.repository.findOne({ where: { channelId } });
  }

  /**
   * Loads a channel and checks the caller belongs to its workspace:
   * 404 if there is no such channel, 403 if they are not a member.
   */
  private async getAccessible(channelId: number, user: Caller) {
    const channel = await this.getOne(Number(channelId));
    if (!channel) {
      throw new NotFoundException('Channel not found');
    }
    await this.workspaceService.assertMember(user, channel.workspaceId);
    return channel;
  }

  /** Stores a message in a channel the caller can access, then queues it. */
  async createMessage(
    message: CreateChannelMessageDTO,
    user: Caller,
  ): Promise<Message> {
    const channel = await this.getAccessible(message.channelId, user);
    const newMessage = await this.messageRepository.save({
      userId: user.userId,
      text: message.text,
      username: message.username,
    });
    await this.channelMessageRepository.save({
      messageId: newMessage.messageId,
      channelId: channel.channelId,
    });
    message.messageId = newMessage.messageId;
    await this.messagesQueue.add('transcode', {
      message,
    });
    return newMessage;
  }

  /** The channel with its messages, for a member of its workspace only. */
  async getForMember(channelId: number, user: Caller) {
    await this.getAccessible(channelId, user);
    return await this.repository.findOne({
      where: { channelId: Number(channelId) },
      relations: ['channelMessages', 'channelMessages.message'],
    });
  }
}
