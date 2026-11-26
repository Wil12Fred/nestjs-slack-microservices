import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';

@Injectable()
export class UserParamInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    if (request.params.userId) {
      request.body.userId = request.params.userId;
    }
    return next.handle();
  }
}

/**
 * Replaces any client-supplied accountId (the `account` header, a query
 * parameter or the body) with the account the validated token was issued
 * for. Use after a JWT guard, so request.user is set.
 */
@Injectable()
export class TokenAccountInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    request.body = request.body ?? {};
    request.body.accountId = request.user?.accountId;
    return next.handle();
  }
}
