import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { AllConfigType } from 'src/config/config.type';

/** The part of ms_auth's decoded JWT payload this service relies on. */
export interface AuthUser {
  userId: number;
  accountId?: number;
  username?: string;
  email?: string;
}

/**
 * Validates a bearer token by asking ms_auth, exactly as ms_admin's ApiGuard
 * does, so the JWT secret never leaves ms_auth.
 */
@Injectable()
export class AuthProvider {
  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService<AllConfigType>,
  ) {}

  /**
   * Resolves to the decoded user for a valid token. Rejects for anything
   * else: a non-2xx answer from ms_auth (axios throws on it), a network
   * error, or a payload without a userId.
   */
  async validateToken(authorization: string): Promise<AuthUser> {
    const host = this.configService.getOrThrow('app.authHost', {
      infer: true,
    });
    const { data } = await firstValueFrom(
      this.httpService.get<AuthUser>(`${host}/api/auth/login`, {
        headers: { Authorization: authorization },
      }),
    );
    if (!data || typeof data.userId !== 'number') {
      throw new Error('ms_auth returned no user');
    }
    return data;
  }
}
