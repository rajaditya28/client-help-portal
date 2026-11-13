import type { Role } from '@help/shared';

/** The identity attached to every authenticated request and socket. */
export interface AuthUser {
  id: string;
  role: Role;
  name: string;
  email: string;
}

export interface JwtPayload {
  sub: string;
  role: Role;
  name: string;
  email: string;
}
