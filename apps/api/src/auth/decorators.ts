import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Role } from '@help/shared';
import type { AuthUser } from './auth.types';

export const IS_PUBLIC = 'isPublic';
/** Opt a route out of the global JWT guard. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const ROLES = 'roles';
/** Restrict a route to the given roles (checked by RolesGuard). */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

/** Injects the authenticated user. Never trust a user id from the request body or params. */
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});
