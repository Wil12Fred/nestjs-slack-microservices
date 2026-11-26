import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';

/**
 * Injects request data into the context, so that the ValidationPipe can use it.
 */
@Injectable()
export class UserAuthInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    if (request.user) {
      request.body.userId = request.user.userId;
      request.body.username = request.user.username;
      // the account is the token's, never the client-supplied `account`
      // header: it scopes which workspaces the caller may see
      request.body.accountId = request.user.accountId;
    }
    return next.handle();
  }
}

/**
 * Injects request data into the context, so that the ValidationPipe can use it.
 */
@Injectable()
export class ChannelParamInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    if (request.params.channelId) {
      request.body.channelId = request.params.channelId;
    }
    return next.handle();
  }
}

/**
 * Injects request data into the context, so that the ValidationPipe can use it.
 */
@Injectable()
export class WorkspaceParamInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    if (request.params.workspaceId) {
      request.body.workspaceId = request.params.workspaceId;
    }
    return next.handle();
  }
}
