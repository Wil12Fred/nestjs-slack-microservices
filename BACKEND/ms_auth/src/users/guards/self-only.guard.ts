import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

/**
 * Lets a request through only when the token's userId is the `:userId` in
 * the route. Runs after JwtAuthGuardLogin (which sets request.user) and
 * before validation, so another user's id is refused with 403 whatever the
 * body says.
 */
@Injectable()
export class SelfOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const tokenUserId = Number(request.user?.userId);
    const routeUserId = Number(request.params?.userId);
    if (!Number.isInteger(tokenUserId) || tokenUserId !== routeUserId) {
      throw new ForbiddenException('You can only change your own user');
    }
    return true;
  }
}
