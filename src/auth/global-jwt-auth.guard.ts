import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from './public.decorator';

/**
 * Global JWT guard applied via `APP_GUARD` (architecture §4 / §7).
 *
 * Auth posture:
 * - Routes marked `@Public()` are always accessible without a JWT.
 * - When `AUTH_REQUIRED=false` (dev smoke toggle), every route is public.
 * - Otherwise, routes require a valid `Authorization: Bearer <jwt>` header;
 *   the passport-jwt strategy validates the token and attaches
 *   `{ userId, email }` to `req.user`.
 */
@Injectable()
export class GlobalJwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    if (process.env.AUTH_REQUIRED === 'false') {
      return true;
    }

    return super.canActivate(context);
  }
}
