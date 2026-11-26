import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { isAxiosError } from 'axios';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class AuthProvider {
  private host = process.env.AUTH_HOST;

  constructor(private readonly httpService: HttpService) {}

  async validateToken(authorization: string): Promise<any> {
    return (
      await firstValueFrom(
        this.httpService.get<any>(`${this.host}/api/auth/login`, {
          headers: { Authorization: authorization },
        }),
      )
    ).data;
  }

  /**
   * Asks ms_auth for a user with the caller's own token. ms_auth answers 404
   * both for a user that does not exist and for one outside the caller's
   * account, and that is returned as null. Anything else (ms_auth down, a
   * 5xx) rejects, so it is reported as a failure and never as "no such user".
   */
  async getUser(authorization: string, userId: number): Promise<any | null> {
    try {
      return (
        await firstValueFrom(
          this.httpService.get<any>(
            `${this.host}/api/users/${encodeURIComponent(String(userId))}`,
            { headers: { Authorization: authorization } },
          ),
        )
      ).data;
    } catch (error) {
      if (isAxiosError(error) && error.response?.status === 404) {
        return null;
      }
      throw error;
    }
  }
}
