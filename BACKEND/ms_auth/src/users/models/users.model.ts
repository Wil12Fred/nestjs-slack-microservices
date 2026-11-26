import {
  Column,
  Model,
  PrimaryKey,
  Table,
  AutoIncrement,
  Unique,
  CreatedAt,
  UpdatedAt,
  DeletedAt,
  HasMany,
  BelongsToMany,
} from 'sequelize-typescript';

import { userStatus } from '../enums/user-status.enum';
import { UserByAccount } from './userByAccount.model';
import { Accounts } from 'src/accounts/models/accounts.model';

@Table({
  timestamps: true,
  tableName: 'users',
  paranoid: true,
})
export class Users extends Model {
  @PrimaryKey
  @AutoIncrement
  @Unique
  @Column
  userId: number;

  @Column
  name: string;

  @Column
  lastname: string;

  @Column
  email: string;

  @Column
  username: string;

  @Column
  password: string;

  @Column
  status: userStatus;

  @CreatedAt
  @Column
  createdAt: Date;

  @UpdatedAt
  @Column
  updatedAt: Date;

  @DeletedAt
  @Column
  deleteAt: Date;

  @HasMany(() => UserByAccount)
  userAccounts: UserByAccount[];

  @BelongsToMany(() => Accounts, () => UserByAccount, 'userId')
  account: Accounts[];

  /**
   * Every response that serialises a user goes through here, so the password
   * hash can never leave the service, whichever endpoint returns the user.
   */
  toJSON(): any {
    const values = { ...(super.toJSON() as Record<string, unknown>) };
    delete values.password;
    return values;
  }

  /** What one user may see of another user of the same account. */
  toPublicProfile(): PublicProfile {
    return {
      userId: this.userId,
      name: this.name,
      lastname: this.lastname,
      username: this.username,
    };
  }
}

export interface PublicProfile {
  userId: number;
  name: string;
  lastname: string;
  username: string;
}
