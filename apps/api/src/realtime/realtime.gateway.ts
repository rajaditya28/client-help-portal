import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { JoinCallAck, Role, SignalMessage, SocketEvents } from '@help/shared';
import { AuthService } from '../auth/auth.service';
import type { AuthUser } from '../auth/auth.types';
import { CallsService } from '../calls/calls.service';
import { callRoom, RealtimeService, userRoom } from './realtime.service';

interface SocketData {
  user: AuthUser;
  callId?: string;
}
type AppSocket = Socket<any, any, any, SocketData>;

/**
 * Socket.IO gateway.
 *  - Authenticates the JWT in the handshake; unauthenticated sockets are dropped.
 *  - Each socket joins its own user room (targeted pushes like "new request").
 *  - Call rooms carry WebRTC signalling; joining one is authorised against the DB.
 */
@WebSocketGateway({ cors: { origin: true, credentials: true } })
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly auth: AuthService,
    private readonly realtime: RealtimeService,
    private readonly calls: CallsService,
  ) {}

  afterInit(server: Server) {
    this.realtime.attach(server);
  }

  async handleConnection(socket: AppSocket) {
    try {
      const token = socket.handshake.auth?.token;
      if (typeof token !== 'string') throw new Error('missing token');
      socket.data.user = await this.auth.verify(token);
      await socket.join(userRoom(socket.data.user.id));
    } catch {
      socket.emit('auth:error', 'unauthorized');
      socket.disconnect(true);
    }
  }

  async handleDisconnect(socket: AppSocket) {
    const { user, callId } = socket.data ?? {};
    if (user && callId) this.announceLeft(socket, callId, user.role);
  }

  @SubscribeMessage(SocketEvents.JoinCall)
  async onJoinCall(@ConnectedSocket() socket: AppSocket, @MessageBody() body: { callId?: string }): Promise<JoinCallAck> {
    const user = socket.data.user;
    const callId = body?.callId;
    if (!user || typeof callId !== 'string') return { ok: false, error: 'bad request', peers: [] };

    try {
      // Authorisation: the user must be a participant of a call that has not ended.
      const call = await this.calls.markJoined(user, callId);
      if (!call) return { ok: false, error: 'call not found or already ended', peers: [] };

      if (socket.data.callId && socket.data.callId !== callId) {
        await socket.leave(callRoom(socket.data.callId));
      }
      const alreadyInRoom = socket.rooms.has(callRoom(callId));
      socket.data.callId = callId;
      await socket.join(callRoom(callId));

      const peers = await this.peersInRoom(callId, socket.id);
      // A duplicate join from the same socket must not trigger another renegotiation.
      if (!alreadyInRoom) socket.to(callRoom(callId)).emit(SocketEvents.PeerJoined, { callId, role: user.role });
      return { ok: true, peers };
    } catch (e) {
      // Always ack: an unacknowledged join would leave the client waiting forever.
      this.logger.error(`join failed for call ${callId}: ${(e as Error).message}`);
      return { ok: false, error: 'internal error', peers: [] };
    }
  }

  @SubscribeMessage(SocketEvents.LeaveCall)
  async onLeaveCall(@ConnectedSocket() socket: AppSocket, @MessageBody() body: { callId?: string }) {
    const callId = body?.callId;
    if (!callId || socket.data.callId !== callId) return;
    await socket.leave(callRoom(callId));
    socket.data.callId = undefined;
    this.announceLeft(socket, callId, socket.data.user.role);
  }

  /** Relays SDP / ICE to the other participant. Only sockets already in the call room may signal. */
  @SubscribeMessage(SocketEvents.Signal)
  onSignal(@ConnectedSocket() socket: AppSocket, @MessageBody() msg: SignalMessage) {
    if (!msg?.callId || !socket.rooms.has(callRoom(msg.callId))) return;
    const out: SignalMessage = { callId: msg.callId, from: socket.data.user.role, payload: msg.payload };
    socket.to(callRoom(msg.callId)).emit(SocketEvents.Signal, out);
  }

  private announceLeft(socket: AppSocket, callId: string, role: Role) {
    socket.to(callRoom(callId)).emit(SocketEvents.PeerLeft, { callId, role });
  }

  private async peersInRoom(callId: string, excludeSocketId: string): Promise<Role[]> {
    const sockets = await this.server.in(callRoom(callId)).fetchSockets();
    const roles = new Set<Role>();
    for (const s of sockets) {
      const data = s.data as SocketData;
      if (s.id !== excludeSocketId && data.user) roles.add(data.user.role);
    }
    return [...roles];
  }
}
