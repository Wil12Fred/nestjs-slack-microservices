import {
  HttpException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';

const logger = new Logger('HttpErrors');

/**
 * Re-throws an HttpException (a deliberate 400/401/403/404) untouched, and
 * turns anything else — a failed database write, a bug — into a 500. Before
 * this, every failure came back as 403 with a `status: 404` body, which made
 * an outage look like a permission problem.
 */
export function rethrowAsHttp(error: unknown, message: string): never {
  if (error instanceof HttpException) {
    throw error;
  }
  logger.error(`${message}: ${(error as Error)?.message ?? error}`);
  throw new InternalServerErrorException({ status: 500, error: message });
}
