import { Global, Module } from '@nestjs/common';
import { RealtimeService } from './realtime.service';

/** Global so any domain module can push events; the gateway itself lives in CallsModule. */
@Global()
@Module({
  providers: [RealtimeService],
  exports: [RealtimeService],
})
export class RealtimeModule {}
