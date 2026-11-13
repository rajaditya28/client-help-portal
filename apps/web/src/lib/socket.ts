import { io, Socket } from 'socket.io-client';
import { onUnmounted } from 'vue';
import { loadSession } from './api';

let socket: Socket | null = null;

/** One authenticated socket per tab. Reconnects automatically (e.g. API restart, network blip). */
export function getSocket(): Socket {
  if (socket) return socket;
  socket = io({
    path: '/socket.io',
    transports: ['websocket'],
    auth: (cb) => cb({ token: loadSession()?.token }),
  });
  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}

/** Subscribe for the lifetime of the calling component. */
export function useSocketEvent<T>(event: string, handler: (payload: T) => void) {
  const s = getSocket();
  s.on(event, handler);
  onUnmounted(() => s.off(event, handler));
}
