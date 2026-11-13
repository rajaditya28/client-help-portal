import { Injectable, Logger } from '@nestjs/common';
import type { Server } from 'socket.io';

export const userRoom = (userId: string) => `user:${userId}`;
export const callRoom = (callId: string) => `call:${callId}`;

/**
 * Thin facade so domain services can push events without depending on the gateway.
 * Every event goes to explicit per-user rooms; there is no broadcast to "all consultants".
 */
@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);
  private server: Server | null = null;

  attach(server: Server) {
    this.server = server;
  }

  toUsers(userIds: string[], event: string, data: unknown) {
    if (!this.server) {
      this.logger.warn(`Dropping "${event}": socket server not ready`);
      return;
    }
    this.server.to(userIds.map(userRoom)).emit(event, data);
  }
}
