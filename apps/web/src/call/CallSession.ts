import { SocketEvents } from '@help/shared';
import type { JoinCallAck, Role, SignalMessage, SignalPayload } from '@help/shared';
import type { Socket } from 'socket.io-client';
import { getSocket } from '@/lib/socket';

export type PeerState = 'waiting' | 'connecting' | 'connected' | 'reconnecting';

export interface CallSessionEvents {
  /** Fired whenever the remote side's tracks change. `generation` increments per peer connection. */
  onRemoteStream(stream: MediaStream, generation: number): void;
  onPeerState(state: PeerState): void;
  /** Consultant only: whether the client is currently sharing their screen. */
  onRemoteScreen(sharing: boolean): void;
  onError(message: string): void;
}

interface QueuedCandidate {
  nid: number;
  candidate: RTCIceCandidateInit;
}

/**
 * One participant's side of a 1:1 WebRTC call, signalled over the app's socket.
 *
 * Negotiation design (keeps the state machine small):
 *  - The consultant is always the offerer; the client only ever answers. No glare handling needed.
 *  - The consultant's offer contains two m-lines: audio (sendrecv) and video (recvonly).
 *    The client attaches its screen to that pre-negotiated video slot with replaceTrack(),
 *    so starting/stopping screen share never renegotiates, and the consultant's received
 *    video track stays the same object (the recorder never has to restart because of it).
 *  - Rejoin after refresh: whoever reloads joins the call room again; the server tells the
 *    other side, and the consultant builds a fresh RTCPeerConnection with a new offer.
 *  - Every offer has a negotiation id (nid). Answers and ICE candidates echo it, and anything
 *    tagged with a superseded nid is dropped, so overlapping renegotiations can't cross wires.
 */
export class CallSession {
  private readonly socket: Socket;
  private pc: RTCPeerConnection | null = null;
  /** Current negotiation id (offerer: the one it sent; answerer: the one it is answering). */
  private nid = 0;
  private generation = 0;
  private pendingCandidates: QueuedCandidate[] = [];
  private remoteStream = new MediaStream();
  private videoSender: RTCRtpSender | null = null;
  private left = false;

  micStream: MediaStream | null = null;
  screenStream: MediaStream | null = null;

  constructor(
    private readonly callId: string,
    private readonly role: Role,
    private readonly iceServers: RTCIceServer[],
    private readonly events: CallSessionEvents,
  ) {
    this.socket = getSocket();
  }

  /** Must be called from a user gesture (click): mic permission + audio autoplay need one. */
  async start(): Promise<void> {
    this.micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
    this.socket.on(SocketEvents.PeerJoined, this.onPeerJoined);
    this.socket.on(SocketEvents.PeerLeft, this.onPeerLeft);
    this.socket.on(SocketEvents.Signal, this.onSignal);
    // Only *re*connects: the first connect is covered by the join below.
    this.socket.io.on('reconnect', this.onSocketReconnect);
    await this.joinRoom();
  }

  async leave(): Promise<void> {
    this.left = true;
    this.socket.emit(SocketEvents.LeaveCall, { callId: this.callId });
    this.socket.off(SocketEvents.PeerJoined, this.onPeerJoined);
    this.socket.off(SocketEvents.PeerLeft, this.onPeerLeft);
    this.socket.off(SocketEvents.Signal, this.onSignal);
    this.socket.io.off('reconnect', this.onSocketReconnect);
    this.closePc();
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.screenStream?.getTracks().forEach((t) => t.stop());
    this.micStream = null;
    this.screenStream = null;
  }

  setMuted(muted: boolean) {
    this.micStream?.getAudioTracks().forEach((t) => (t.enabled = !muted));
  }

  /** Client only. Prompts the browser's screen picker. */
  async startScreenShare(): Promise<MediaStream> {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15, max: 30 } }, audio: false });
    const track = stream.getVideoTracks()[0];
    track.contentHint = 'detail'; // favour sharpness over motion for UI/text
    // The browser's own "Stop sharing" button ends the track.
    track.addEventListener('ended', () => void this.stopScreenShare());
    this.screenStream?.getTracks().forEach((t) => t.stop());
    this.screenStream = stream;
    await this.videoSender?.replaceTrack(track);
    this.send({ kind: 'screen', sharing: true });
    return stream;
  }

  async stopScreenShare(): Promise<void> {
    await this.videoSender?.replaceTrack(null);
    this.screenStream?.getTracks().forEach((t) => t.stop());
    this.screenStream = null;
    this.send({ kind: 'screen', sharing: false });
  }

  /* -------------------------------------------------------------- signalling */

  private async joinRoom() {
    let ack: JoinCallAck;
    try {
      // Timeout so a lost ack (server error, dropped connection) surfaces instead of hanging the UI.
      ack = await this.socket.timeout(10_000).emitWithAck(SocketEvents.JoinCall, { callId: this.callId });
    } catch {
      throw new Error('The call server did not respond. Check your connection and try again.');
    }
    if (!ack.ok) throw new Error(ack.error ?? 'Could not join the call');

    const other: Role = this.role === 'CONSULTANT' ? 'CLIENT' : 'CONSULTANT';
    if (ack.peers.includes(other)) {
      if (this.role === 'CONSULTANT') await this.negotiate();
      else this.events.onPeerState('connecting'); // the consultant will send an offer
    } else {
      this.events.onPeerState('waiting');
    }
  }

  /** Socket.IO reconnected (server restart / network blip): server-side room membership is gone, rejoin. */
  private onSocketReconnect = () => {
    if (this.left) return;
    this.joinRoom().catch((e: Error) => this.events.onError(e.message));
  };

  private onPeerJoined = (msg: { callId: string; role: Role }) => {
    if (msg.callId !== this.callId || msg.role === this.role) return;
    if (this.role === 'CONSULTANT') void this.negotiate();
    else this.events.onPeerState('connecting');
  };

  private onPeerLeft = (msg: { callId: string; role: Role }) => {
    if (msg.callId !== this.callId || msg.role === this.role) return;
    this.closePc();
    this.events.onRemoteScreen(false);
    this.events.onPeerState('reconnecting');
  };

  private onSignal = async (msg: SignalMessage) => {
    if (msg.callId !== this.callId || msg.from === this.role) return;
    const p = msg.payload;
    if (p.kind === 'screen') {
      if (this.role === 'CONSULTANT') this.events.onRemoteScreen(p.sharing);
      return;
    }
    try {
      if (p.kind === 'offer' && this.role === 'CLIENT') {
        await this.answer(p.sdp, p.nid);
      } else if (p.kind === 'answer' && this.role === 'CONSULTANT') {
        if (p.nid !== this.nid || !this.pc) return; // answer to a superseded offer
        await this.pc.setRemoteDescription({ type: 'answer', sdp: p.sdp });
        await this.flushCandidates();
      } else if (p.kind === 'candidate') {
        if (p.nid !== this.nid) return; // belongs to a superseded negotiation
        if (this.pc?.remoteDescription) await this.pc.addIceCandidate(p.candidate);
        else this.pendingCandidates.push({ nid: p.nid, candidate: p.candidate });
      }
    } catch (e) {
      console.error('signal handling failed', e);
    }
  };

  private send(payload: SignalPayload) {
    this.socket.emit(SocketEvents.Signal, { callId: this.callId, payload } satisfies SignalMessage);
  }

  /** Consultant: build a fresh connection and offer. */
  private async negotiate() {
    // Timestamp-based so it keeps increasing even across a consultant page refresh.
    this.nid = Math.max(this.nid + 1, Date.now());
    const nid = this.nid;
    const pc = this.createPc(nid);
    const mic = this.micStream!.getAudioTracks()[0];
    pc.addTransceiver(mic, { direction: 'sendrecv', streams: [this.micStream!] });
    pc.addTransceiver('video', { direction: 'recvonly' });
    const offer = await pc.createOffer();
    if (this.pc !== pc) return; // superseded while awaiting
    await pc.setLocalDescription(offer);
    this.send({ kind: 'offer', nid, sdp: offer.sdp! });
  }

  /** Client: answer an offer, wiring mic + (optional) screen into the offered transceivers. */
  private async answer(sdp: string, nid: number) {
    this.nid = nid;
    const pc = this.createPc(nid);
    await pc.setRemoteDescription({ type: 'offer', sdp });
    for (const t of pc.getTransceivers()) {
      if (t.receiver.track.kind === 'audio') {
        t.direction = 'sendrecv';
        await t.sender.replaceTrack(this.micStream!.getAudioTracks()[0]);
        t.sender.setStreams?.(this.micStream!);
      } else if (t.receiver.track.kind === 'video') {
        t.direction = 'sendonly';
        this.videoSender = t.sender;
        // Rejoining mid-share: keep sending the screen we already have.
        await t.sender.replaceTrack(this.screenStream?.getVideoTracks()[0] ?? null);
      }
    }
    const answer = await pc.createAnswer();
    if (this.pc !== pc) return; // a newer offer arrived while we were answering
    await pc.setLocalDescription(answer);
    this.send({ kind: 'answer', nid, sdp: answer.sdp! });
    // Tell a (re)joining consultant whether we're mid-share.
    this.send({ kind: 'screen', sharing: !!this.screenStream });
    await this.flushCandidates();
  }

  private createPc(nid: number): RTCPeerConnection {
    this.closePc();
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const generation = ++this.generation;
    this.pc = pc;
    this.remoteStream = new MediaStream();
    this.events.onPeerState('connecting');

    pc.onicecandidate = (e) => {
      if (e.candidate && this.pc === pc) this.send({ kind: 'candidate', nid, candidate: e.candidate.toJSON() });
    };
    pc.ontrack = (e) => {
      if (this.pc !== pc) return;
      this.remoteStream.addTrack(e.track);
      this.events.onRemoteStream(this.remoteStream, generation);
    };
    pc.onconnectionstatechange = () => {
      if (this.pc !== pc) return;
      const s = pc.connectionState;
      if (s === 'connected') this.events.onPeerState('connected');
      else if (s === 'disconnected') this.events.onPeerState('reconnecting');
      else if (s === 'failed') {
        this.events.onPeerState('reconnecting');
        // Offerer rebuilds the connection; the client will answer the new offer.
        if (this.role === 'CONSULTANT' && !this.left) void this.negotiate();
      }
    };
    return pc;
  }

  private async flushCandidates() {
    const queued = this.pendingCandidates.filter((q) => q.nid === this.nid);
    this.pendingCandidates = [];
    for (const q of queued) await this.pc?.addIceCandidate(q.candidate).catch(() => undefined);
  }

  private closePc() {
    if (!this.pc) return;
    this.pc.onicecandidate = null;
    this.pc.ontrack = null;
    this.pc.onconnectionstatechange = null;
    this.pc.close();
    this.pc = null;
    this.videoSender = null;
  }
}
