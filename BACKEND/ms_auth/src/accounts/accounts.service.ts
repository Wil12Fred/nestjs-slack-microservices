import { Injectable } from '@nestjs/common';
import { Accounts } from './models/accounts.model';
import { InjectModel } from '@nestjs/sequelize';

@Injectable()
export class AccountsService {
  constructor(
    @InjectModel(Accounts)
    private accounts: typeof Accounts,
  ) {}

  async createOneAccount(
    name: string,
    description: string,
    type: string,
    status: string,
  ): Promise<Accounts> {
    // a failed insert must fail the request; it used to be returned as the
    // "created" account with a 200
    return this.accounts.create({
      name,
      description,
      type,
      status,
    });
  }

  async getById(accountId: number): Promise<Accounts> {
    return await this.accounts.findByPk(accountId);
  }
}
