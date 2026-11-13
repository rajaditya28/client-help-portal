import type { AuthUser } from '../auth/auth.types';

/**
 * The single source of truth for "users only see their own data".
 *
 * Every query for a HelpRequest or Call goes through this predicate, so the
 * row-level rule lives in one place instead of being re-implemented per endpoint.
 * A client owns rows where they are the client; a consultant owns rows assigned to them.
 *
 * Lookups that fail this predicate return 404 (not 403) so callers cannot
 * probe for the existence of other users' records.
 */
export function ownedBy(user: AuthUser): { clientId: string } | { consultantId: string } {
  return user.role === 'CLIENT' ? { clientId: user.id } : { consultantId: user.id };
}
