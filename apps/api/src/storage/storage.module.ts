import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { LocalStorageService, S3StorageService, StorageService } from './storage.service';

@Global()
@Module({
  providers: [
    {
      provide: StorageService,
      inject: [APP_CONFIG],
      useFactory: (cfg: AppConfig) =>
        cfg.STORAGE_DRIVER === 's3' ? new S3StorageService(cfg) : new LocalStorageService(cfg),
    },
  ],
  exports: [StorageService],
})
export class StorageModule {}
