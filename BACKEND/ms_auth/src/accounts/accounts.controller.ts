import { Body, Controller, HttpStatus, Post, Res } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Response } from 'express';
import { AccountsService } from './accounts.service';
import { CreateAccountsDTO } from './dto/createAccounts.dto';
import { rethrowAsHttp } from 'src/utils/http-errors';

@ApiBearerAuth()
@ApiTags('accounts')
@Controller('accounts')
export class AccountsController {
  constructor(private accountsService: AccountsService) {}

  @Post()
  @ApiOperation({ summary: 'Create accounts' })
  @ApiBody({ type: CreateAccountsDTO })
  @ApiCreatedResponse({ description: 'Account created' })
  @ApiResponse({ status: 404, description: 'Forbidden.' })
  async createAccount(
    @Res() res: Response,
    @Body() createAccountsDTO: CreateAccountsDTO,
  ) {
    try {
      const { name, description, type, status } = createAccountsDTO;
      const accountCreated = await this.accountsService.createOneAccount(
        name,
        description,
        type,
        status,
      );
      return res.status(HttpStatus.OK).json({
        status: 201,
        message: 'Se creó correctamente la cuenta',
        accountCreated,
      });
    } catch (error) {
      rethrowAsHttp(error, 'La cuenta es inválida');
    }
  }
}
