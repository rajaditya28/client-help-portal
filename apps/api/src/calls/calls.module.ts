import { Module } from '@nestjs/common';
import { JobWorker } from '../jobs/job-worker';
import { JobsService } from '../jobs/jobs.service';
import { MediaService } from '../media/media.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { RequestsModule } from '../requests/requests.module';
import { CallsController } from './calls.controller';
import { CallsService } from './calls.service';
import { IceServersService } from './ice-servers.service';
import { PipelineService } from './pipeline.service';

@Module({
  imports: [RequestsModule],
  controllers: [CallsController],
  providers: [CallsService, IceServersService, PipelineService, JobsService, JobWorker, MediaService, RealtimeGateway],
  exports: [CallsService],
})
export class CallsModule {}
