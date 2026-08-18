import { useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import { apiUrl } from '../../apiConfig';

type SocketHandler = (data: any) => void;

const socketCache = new Map<string, Socket>();
const eventCallbacks = new Map<string, Set<SocketHandler>>();

function cacheKey(browserId: string, event: string) {
  return `${browserId}::${event}`;
}

function getOrCreateSocket(browserId: string): Socket {
  const existing = socketCache.get(browserId);
  if (existing) return existing;

  const socket = io(`${apiUrl}/${browserId}`, {
    transports: ['websocket', 'polling'],
    rejectUnauthorized: false,
  });

  socket.onAny((event: string, ...args: unknown[]) => {
    const handlers = eventCallbacks.get(cacheKey(browserId, event));
    if (!handlers) return;
    const payload = args[0];
    handlers.forEach((cb) => cb(payload));
  });

  socketCache.set(browserId, socket);
  return socket;
}

function cleanupSocketIfUnused(browserId: string) {
  const prefix = `${browserId}::`;
  let remaining = 0;
  eventCallbacks.forEach((handlers, key) => {
    if (key.startsWith(prefix)) remaining += handlers.size;
  });
  if (remaining > 0) return;
  const socket = socketCache.get(browserId);
  if (socket) {
    socket.disconnect();
    socketCache.delete(browserId);
  }
}

export function subscribeRunBrowserSocket(
  browserId: string,
  event: string,
  handler: SocketHandler,
): () => void {
  if (!browserId.trim()) return () => undefined;
  getOrCreateSocket(browserId);
  const key = cacheKey(browserId, event);
  let handlers = eventCallbacks.get(key);
  if (!handlers) {
    handlers = new Set<SocketHandler>();
    eventCallbacks.set(key, handlers);
  }
  handlers.add(handler);
  return () => {
    const current = eventCallbacks.get(key);
    if (current) {
      current.delete(handler);
      if (current.size === 0) eventCallbacks.delete(key);
    }
    cleanupSocketIfUnused(browserId);
  };
}

export function useRunBrowserSocket(
  browserId: string | null | undefined,
  event: string,
  handler: SocketHandler,
  enabled = true,
) {
  useEffect(() => {
    if (!enabled || !browserId?.trim()) return;
    return subscribeRunBrowserSocket(browserId, event, handler);
  }, [browserId, event, handler, enabled]);
}
