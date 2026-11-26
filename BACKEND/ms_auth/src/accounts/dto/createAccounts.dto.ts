import { accountStatus } from '../enums/account-status.enum';
import { accountType } from '../enums/account-type.enum';
import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

// no accountId: the database assigns it, and requiring one made every
// POST /api/accounts fail validation
export class CreateAccountsDTO {
  @IsString()
  @ApiProperty({
    type: String,
    description: 'name',
  })
  name: string;

  @IsString()
  @ApiProperty({
    type: String,
    description: 'description',
  })
  description: string;

  @ApiProperty({
    description: 'type',
  })
  type: accountType;

  @ApiProperty({
    description: 'status',
  })
  status: accountStatus;
}
