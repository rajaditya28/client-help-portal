import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { AiModule } from './ai/ai.module';
import { AuthModule } from './auth/auth.module';
import { CallsModule } from './calls/calls.module';
import { AppConfigModule } from './config/config.module';
import { HealthController } from './health.controller';
import { MetricsModule } from './metrics/metrics.module';
import { PrismaModule } from './prisma/prisma.service';
import { RealtimeModule } from './realtime/realtime.module';
import { RequestsModule } from './requests/requests.module';
import { StorageModule } from './storage/storage.module';

/** In production the API also serves the built Vue app, so the whole product is one origin. */
const WEB_DIST = join(__dirname, '..', '..', 'web', 'dist');

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    AuthModule,
    RealtimeModule,
    StorageModule,
    AiModule,
    RequestsModule,
    CallsModule,
    MetricsModule,
    ...(existsSync(WEB_DIST)
      ? [ServeStaticModule.forRoot({ rootPath: WEB_DIST, exclude: ['/api/{*path}', '/socket.io/{*path}'] })]
      : []),
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
