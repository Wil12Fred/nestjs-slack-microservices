import {
  Controller,
  HttpStatus,
  Post,
  Res,
  Body,
  UseGuards,
  Get,
  Param,
  ParseIntPipe,
  HttpCode,
  UseInterceptors,
} from '@nestjs/common';
import { ChannelService } from './channel.service';
import { Response } from 'express';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiBody,
  ApiResponse,
  ApiTags,
  ApiCreatedResponse,
} from '@nestjs/swagger';
import { ApiGuard } from 'src/utils/guards/api.guard';
import {
  UserAuthInterceptor,
  ChannelParamInterceptor,
} from 'src/common/interceptor/context.interceptor';
import { AuthUser } from 'src/utils/decorators/auth-user-decorators';
import { rethrowAsHttp } from 'src/utils/http-errors';
import { CreateChannelDTO } from './dto/createChannel.dto';
import { CreateChannelMessageDTO } from './dto/createChannelMessage.dto';

@ApiBearerAuth()
@ApiTags('channel')
@Controller('channel')
@UseGuards(ApiGuard)
@ApiBearerAuth('access-token')
@UseInterceptors(new ChannelParamInterceptor())
@UseInterceptors(new UserAuthInterceptor())
export class ChannelController {
  constructor(private channelService: ChannelService) {}

  @Get(':channelId')
  @ApiOperation({ summary: 'Get channel' })
  @ApiCreatedResponse({ description: 'Channel got' })
  @ApiResponse({ status: 404, description: 'Forbidden.' })
  @HttpCode(200)
  async getById(
    @Param('channelId', ParseIntPipe) channelId: number,
    @AuthUser() user: any,
  ) {
    try {
      return await this.channelService.getForMember(channelId, user);
    } catch (error) {
      rethrowAsHttp(error, 'El espacio de trabajo es inválido');
    }
  }

  @Post(':channelId/message')
  @ApiOperation({ summary: 'Create message' })
  @ApiBody({ type: CreateChannelMessageDTO })
  @ApiCreatedResponse({ description: 'Message created' })
  @ApiResponse({ status: 404, description: 'Forbidden.' })
  async createMessage(
    @Res() res: Response,
    @Param('channelId', ParseIntPipe) channelId: number,
    @Body() body: CreateChannelMessageDTO,
    @AuthUser() user: any,
  ) {
    try {
      // the route's channelId, never one supplied in the body
      const messageCreated = await this.channelService.createMessage(
        { ...body, channelId },
        user,
      );
      return res.status(HttpStatus.OK).json({
        status: 201,
        message: 'Se creó correctamente el mensaje',
        messageCreated,
      });
    } catch (error) {
      rethrowAsHttp(error, 'El mensaje es inválido');
    }
  }

  @Post()
  @ApiOperation({ summary: 'Create channel' })
  @ApiBody({ type: CreateChannelDTO })
  @ApiCreatedResponse({ description: 'Channel created' })
  @ApiResponse({ status: 404, description: 'Forbidden.' })
  async create(
    @Res() res: Response,
    @Body() body: CreateChannelDTO,
    @AuthUser() user: any,
  ) {
    try {
      const channelCreated = await this.channelService.createOne(body, user);
      return res.status(HttpStatus.OK).json({
        status: 201,
        message: 'Se creó correctamente la cuenta',
        channelCreated,
      });
    } catch (error) {
      rethrowAsHttp(error, 'El canal es inválido');
    }
  }
}
