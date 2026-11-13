import { Controller, Get, Module } from '@nestjs/common';
import type { MetricsDto } from '@help/shared';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import { MetricsService } from './metrics.service';

@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  /** Consultant-only ops view of their own calls' pipeline: latency, failures, cost. */
  @Roles('CONSULTANT')
  @Get()
  get(@CurrentUser() user: AuthUser): Promise<MetricsDto> {
    return this.metrics.forConsultant(user);
  }
}

@Module({ controllers: [MetricsController], providers: [MetricsService] })
export class MetricsModule {}
