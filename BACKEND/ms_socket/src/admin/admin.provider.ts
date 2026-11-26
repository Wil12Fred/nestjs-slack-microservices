import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { AllConfigType } from 'src/config/config.type';

/**
 * Asks ms_admin whether a user may see a channel. ms_admin owns workspace
 * membership, so ms_socket never decides it: it forwards the client's own
 * token and trusts the status code.
 */
@Injectable()
export class AdminProvider {
  private readonly logger = new Logger(AdminProvider.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService<AllConfigType>,
  ) {}

  /**
   * True only when ms_admin answers 200 to GET /api/channel/:channelId with
   * this token. Any other status (401, 403, 404, 5xx) or a network error is
   * false: when in doubt, the client does not join.
   */
  async canAccessChannel(
    authorization: string,
    channelId: string,
  ): Promise<boolean> {
    const host = this.configService.getOrThrow('app.adminHost', {
      infer: true,
    });
    try {
      const { status } = await firstValueFrom(
        this.httpService.get(
          `${host}/api/channel/${encodeURIComponent(channelId)}`,
          {
            headers: { Authorization: authorization },
            validateStatus: () => true,
          },
        ),
      );
      return status === 200;
    } catch (error) {
      this.logger.warn(
        `channel ${channelId}: ms_admin unreachable (${(error as Error).message})`,
      );
      return false;
    }
  }
}
