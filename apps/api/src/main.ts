import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { APP_CONFIG, AppConfig } from './config/app-config';

export async function configureApp(app: NestExpressApplication) {
  const cfg = app.get<AppConfig>(APP_CONFIG);
  app.setGlobalPrefix('api', { exclude: [] });
  app.enableCors({ origin: cfg.CORS_ORIGINS, credentials: true });
  // Recording chunks arrive as raw binary; everything else is JSON.
  app.useBodyParser('raw', { type: 'application/octet-stream', limit: '25mb' });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableShutdownHooks();
  return cfg;
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const cfg = await configureApp(app);
  await app.listen(cfg.PORT);
  Logger.log(`API listening on http://localhost:${cfg.PORT}`, 'Bootstrap');
}

if (require.main === module) {
  void bootstrap();
}
