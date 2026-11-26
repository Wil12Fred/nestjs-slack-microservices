import {
  ParseIntPipe,
  Controller,
  HttpStatus,
  NotFoundException,
  Post,
  Res,
  Body,
  Put,
  Delete,
  Get,
  Param,
  UseInterceptors,
  UseGuards,
  Query,
} from '@nestjs/common';
import { Response } from 'express';
import { CreateUserDTO } from './dto/createUsers.dto';
import { UsersService } from './users.service';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiBody,
  ApiResponse,
  ApiTags,
  ApiCreatedResponse,
} from '@nestjs/swagger';
import { UpdateUserDto } from './dto/updateUsers.dto';
import { AccountHeader } from 'src/utils/headers-decorators';
import { UserParamInterceptor } from 'src/common/interceptor/context.interceptor';
import { JwtAuthGuardLogin } from 'src/auth/guards/jwt-auth.guard';
import { AuthUser } from 'src/utils/auth-user-decorators';
import { IJwtPayloadLogin } from 'src/auth/interfaces/jwt-payload-login.interface';
import { TokenAccountInterceptor } from 'src/common/interceptor/context.interceptor';
import { rethrowAsHttp } from 'src/utils/http-errors';
import { SelfOnlyGuard } from './guards/self-only.guard';

@ApiBearerAuth('access-token')
@ApiTags('users')
@Controller('users')
@AccountHeader()
@UseInterceptors(new UserParamInterceptor())
export class UsersController {
  constructor(private userService: UsersService) {}

  @Post()
  @ApiOperation({ summary: 'Create user' })
  @ApiBody({ type: CreateUserDTO })
  @ApiCreatedResponse({ description: 'User created' })
  @ApiResponse({ status: 404, description: 'Forbidden.' })
  async createUser(
    @Res() res: Response,
    @Body() createUsersDTO: CreateUserDTO,
  ) {
    const userCreated = await this.userService.createUser(
      createUsersDTO.accountId,
      createUsersDTO,
    );
    return res.status(HttpStatus.OK).json({
      status: 201,
      message: 'Se creó correctamente el usuario',
      userCreated,
    });
  }

  @Put(':userId')
  @ApiOperation({ summary: 'Update your own user (name, lastname)' })
  @ApiBody({ type: UpdateUserDto })
  @ApiCreatedResponse({ description: 'User updated' })
  @ApiResponse({ status: 403, description: 'Not your user.' })
  @UseGuards(JwtAuthGuardLogin, SelfOnlyGuard)
  @UseInterceptors(new TokenAccountInterceptor())
  async updateUser(
    @Param('userId', ParseIntPipe) userId: number,
    @Res() res: Response,
    @Body() updateUserDTO: UpdateUserDto,
  ) {
    try {
      const userUpdated = await this.userService.updateUser(
        userId,
        updateUserDTO,
      );
      return res.status(HttpStatus.OK).json({
        status: 201,
        message: 'Se actualizó correctamente el usuario',
        userUpdated,
      });
    } catch (error) {
      rethrowAsHttp(error, 'Un error ocurrió cuando se actualizaba el usuario');
    }
  }

  /**
   * Users of the caller's account (the token's, never the header's). The
   * caller sees themself in full; everyone else as a public profile.
   */
  @ApiOperation({ summary: 'Get users of your account' })
  @ApiCreatedResponse({ description: 'Users got' })
  @UseGuards(JwtAuthGuardLogin)
  @Get('')
  async getUsers(
    @Query('username') username: string,
    @AuthUser() user: IJwtPayloadLogin,
  ) {
    try {
      const users = await this.userService.getAll(Number(user.accountId), {
        username,
      });
      return users.map((found) =>
        found.userId === Number(user.userId) ? found : found.toPublicProfile(),
      );
    } catch (error) {
      rethrowAsHttp(error, 'Un error ocurrió obteniendo el usuario');
    }
  }

  /**
   * Yourself in full (never the password); another user of your account as
   * a public profile; anyone else 404, exactly like a user that does not
   * exist, so other accounts cannot be probed.
   */
  @Get(':userId')
  @ApiOperation({ summary: 'Get user' })
  @ApiCreatedResponse({ description: 'User got' })
  @ApiResponse({ status: 404, description: 'No such user in your account.' })
  @UseGuards(JwtAuthGuardLogin)
  async getUserById(
    @Param('userId', ParseIntPipe) userId: number,
    @AuthUser() caller: IJwtPayloadLogin,
  ) {
    try {
      const user = await this.userService.filter(Number(caller.accountId), {
        userId,
      });
      if (!user) {
        throw new NotFoundException('User not found');
      }
      return user.userId === Number(caller.userId)
        ? user
        : user.toPublicProfile();
    } catch (error) {
      rethrowAsHttp(error, 'Un error ocurrió obteniendo el usuario');
    }
  }

  @Delete(':userId')
  @ApiOperation({ summary: 'Delete your own user' })
  @ApiCreatedResponse({ description: 'User deleted' })
  @ApiResponse({ status: 403, description: 'Not your user.' })
  @UseGuards(JwtAuthGuardLogin, SelfOnlyGuard)
  async deleteUser(
    @Param('userId', ParseIntPipe) userId: number,
    @Res() res: Response,
  ) {
    try {
      const deleteUser = await this.userService.deleteUserById(userId);
      return res.status(HttpStatus.OK).json({
        status: 201,
        message: 'Se elimino correctamente el usuario',
        deleteUser,
      });
    } catch (error) {
      rethrowAsHttp(error, 'Un error ocurrio mientras se eliminaba el usuario');
    }
  }
}
