import { Test, TestingModule } from '@nestjs/testing';
import { AccountsService } from './accounts.service';
import { getModelToken } from '@nestjs/sequelize';
import { Accounts } from './models/accounts.model';

describe('AccountsService', () => {
  let service: AccountsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccountsService,
        { provide: getModelToken(Accounts), useValue: {} },
      ],
    }).compile();

    service = module.get<AccountsService>(AccountsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
