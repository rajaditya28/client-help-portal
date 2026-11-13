import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { LoginResponse, UserDto } from '@help/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser, JwtPayload } from './auth.types';
import { verifyPassword } from './password';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login(email: string, password: string): Promise<LoginResponse> {
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
    // Same error for unknown email and wrong password: don't reveal which accounts exist.
    if (!user || !verifyPassword(password, user.passwordHash)) {
      throw new UnauthorizedException('Invalid email or password');
    }
    const dto: UserDto = { id: user.id, name: user.name, email: user.email, role: user.role };
    const payload: JwtPayload = { sub: user.id, role: user.role, name: user.name, email: user.email };
    return { accessToken: await this.jwt.signAsync(payload), user: dto };
  }

  /** Used by both the HTTP guard and the websocket handshake. */
  async verify(token: string): Promise<AuthUser> {
    try {
      const p = await this.jwt.verifyAsync<JwtPayload>(token);
      return { id: p.sub, role: p.role, name: p.name, email: p.email };
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  /** Short-lived, single-purpose token for media URLs (a <video> tag cannot send headers). */
  signMediaToken(callId: string, userId: string): Promise<string> {
    return this.jwt.signAsync({ sub: userId, callId, purpose: 'media' }, { expiresIn: '15m' });
  }

  async verifyMediaToken(token: string, callId: string): Promise<boolean> {
    try {
      const p = await this.jwt.verifyAsync<{ callId: string; purpose: string }>(token);
      return p.purpose === 'media' && p.callId === callId;
    } catch {
      return false;
    }
  }
}
