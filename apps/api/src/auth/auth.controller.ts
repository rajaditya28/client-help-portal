import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsEmail, IsString, MinLength } from 'class-validator';
import type { LoginResponse, UserDto } from '@help/shared';
import { AuthService } from './auth.service';
import type { AuthUser } from './auth.types';
import { CurrentUser, Public } from './decorators';

class LoginBody {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(1)
  password: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  login(@Body() body: LoginBody): Promise<LoginResponse> {
    return this.auth.login(body.email, body.password);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser): UserDto {
    return { id: user.id, name: user.name, email: user.email, role: user.role };
  }
}
