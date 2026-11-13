import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { IsString, MaxLength, MinLength } from 'class-validator';
import type { HelpRequestDto } from '@help/shared';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import { RequestsService } from './requests.service';

class CreateRequestBody {
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  title: string;

  @IsString()
  @MaxLength(2000)
  description: string;
}

@Controller('requests')
export class RequestsController {
  constructor(private readonly requests: RequestsService) {}

  @Roles('CLIENT')
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: CreateRequestBody): Promise<HelpRequestDto> {
    return this.requests.create(user, body);
  }

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<HelpRequestDto[]> {
    return this.requests.list(user);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<HelpRequestDto> {
    return this.requests.get(user, id);
  }

  @Roles('CONSULTANT')
  @Post(':id/resolve')
  resolve(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<HelpRequestDto> {
    return this.requests.resolve(user, id);
  }
}
