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
  Headers,
  UseInterceptors,
} from '@nestjs/common';
import { WorkspaceService } from './workspace.service';
import { CreateWorkspaceDTO } from './dto/createWorkspace.dto';
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
  WorkspaceParamInterceptor,
  UserAuthInterceptor,
} from 'src/common/interceptor/context.interceptor';
import { AuthUser } from 'src/utils/decorators/auth-user-decorators';
import { rethrowAsHttp } from 'src/utils/http-errors';
import { CreateUserWorkspaceDTO } from './dto/createUserWorkspace.dto';

@ApiBearerAuth()
@ApiTags('workspace')
@Controller('workspace')
@UseGuards(ApiGuard)
@ApiBearerAuth('access-token')
@UseInterceptors(new WorkspaceParamInterceptor())
export class WorkspaceController {
  constructor(private workspaceService: WorkspaceService) {}

  @Get('')
  @ApiOperation({ summary: 'Get workspaces' })
  @ApiCreatedResponse({ description: 'Workspaces got' })
  @ApiResponse({ status: 404, description: 'Forbidden.' })
  @HttpCode(200)
  @UseInterceptors(new UserAuthInterceptor())
  async getAll(@AuthUser() user: any) {
    try {
      return await this.workspaceService.getAll(user);
    } catch (error) {
      rethrowAsHttp(error, 'La espacio de trabajo es inválido');
    }
  }

  @Get(':workspaceId')
  @ApiOperation({ summary: 'Get workspace' })
  @ApiCreatedResponse({ description: 'Workspace got' })
  @ApiResponse({ status: 404, description: 'Forbidden.' })
  @HttpCode(200)
  @UseInterceptors(new UserAuthInterceptor())
  async getById(
    @Param('workspaceId', ParseIntPipe) workspaceId: number,
    @AuthUser() user: any,
  ) {
    try {
      return await this.workspaceService.getForMember(user, workspaceId);
    } catch (error) {
      rethrowAsHttp(error, 'El espacio de trabajo es inválido');
    }
  }

  @Post()
  @ApiOperation({ summary: 'Create workspace' })
  @ApiBody({ type: CreateWorkspaceDTO })
  @ApiCreatedResponse({ description: 'Workspace created' })
  @ApiResponse({ status: 404, description: 'Forbidden.' })
  @UseInterceptors(new UserAuthInterceptor())
  async create(
    @Res() res: Response,
    @Body() body: CreateWorkspaceDTO,
    @AuthUser() user: any,
  ) {
    try {
      const workspaceCreated = await this.workspaceService.createOne(
        body,
        user,
      );
      return res.status(HttpStatus.OK).json({
        status: 201,
        message: 'Se creó correctamente el espacio de trabajo',
        workspaceCreated,
      });
    } catch (error) {
      rethrowAsHttp(error, 'El espacio de trabajo es inválido');
    }
  }

  @Post(':workspaceId/user')
  @ApiOperation({ summary: 'Create user workspace' })
  @ApiBody({ type: CreateUserWorkspaceDTO })
  @ApiCreatedResponse({ description: 'User Workspace created' })
  @ApiResponse({ status: 404, description: 'Forbidden.' })
  @UseInterceptors(new UserAuthInterceptor())
  async addUserWorkspace(
    @Res() res: Response,
    @Param('workspaceId', ParseIntPipe) workspaceId: number,
    @Body() body: CreateUserWorkspaceDTO,
    @AuthUser() user: any,
    @Headers('authorization') authorization: string,
  ) {
    try {
      // the route's workspaceId, never one supplied in the body
      const userWorkspaceCreated =
        await this.workspaceService.addUserToWorkspace(
          { ...body, workspaceId },
          user,
          authorization,
        );
      return res.status(HttpStatus.OK).json({
        status: 201,
        message:
          'Se creó agrego correctamente el usuario al espacio de trabajo',
        userWorkspaceCreated,
      });
    } catch (error) {
      rethrowAsHttp(error, 'El espacio de trabajo es inválido');
    }
  }
}
