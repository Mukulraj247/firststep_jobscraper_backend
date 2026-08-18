import type { IncomingMessage } from 'http';
import type { ExtendedError, Server, Socket } from 'socket.io';
import type { Response } from 'express';
import { requireSignInOrApiKey } from './auth';

type SocketNext = (error?: ExtendedError) => void;
type SocketLogger = {
  log: (level: string, message: string) => unknown;
};
type SocketEvents = Record<string, (...args: any[]) => void>;
type QueuedRunSocket = Socket<
  SocketEvents,
  SocketEvents,
  SocketEvents,
  { userId?: string }
>;
type AuthIdentity = {
  userId: string;
  expiresAtMs?: number;
};

const MAX_TIMER_DELAY_MS = 2_147_483_647;

const parseCookies = (header?: string): Record<string, string> => {
  if (!header) return {};

  return header.split(';').reduce<Record<string, string>>((cookies, part) => {
    const separator = part.indexOf('=');
    if (separator < 0) return cookies;

    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (!name) return cookies;

    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      cookies[name] = value;
    }
    return cookies;
  }, {});
};

const firstString = (value: unknown): string | undefined => {
  const candidate = Array.isArray(value) ? value[0] : value;
  return typeof candidate === 'string' && candidate.trim()
    ? candidate.trim()
    : undefined;
};

const resolveHttpCredentials = (
  cookieHeader?: string,
  apiKey?: string,
): Promise<AuthIdentity | undefined> =>
  new Promise((resolve) => {
    const request = {
      cookies: parseCookies(cookieHeader),
      headers: apiKey ? { 'x-api-key': apiKey } : {},
    } as Parameters<typeof requireSignInOrApiKey>[0];
    const response = {
      sendStatus: () => {
        resolve(undefined);
        return response;
      },
      status: () => response,
      json: () => {
        resolve(undefined);
        return response;
      },
    } as unknown as Response;

    void Promise.resolve(requireSignInOrApiKey(request, response, () => {
      const user = request.user;
      const id = user && typeof user === 'object' && 'id' in user
        ? (user as { id?: unknown }).id
        : undefined;
      if (id === undefined || id === null) {
        resolve(undefined);
        return;
      }

      const exp = user && typeof user === 'object' && 'exp' in user
        ? (user as { exp?: unknown }).exp
        : undefined;
      resolve({
        userId: String(id),
        expiresAtMs: typeof exp === 'number' ? exp * 1000 : undefined,
      });
    })).catch(() => resolve(undefined));
  });

const scheduleSocketExpiration = (
  socket: QueuedRunSocket,
  expiresAtMs?: number,
): void => {
  if (expiresAtMs === undefined) return;

  let timer: NodeJS.Timeout | undefined;
  const schedule = () => {
    const remainingMs = expiresAtMs - Date.now();
    if (remainingMs <= 0) {
      socket.disconnect(true);
      return;
    }

    timer = setTimeout(schedule, Math.min(remainingMs, MAX_TIMER_DELAY_MS));
    timer.unref?.();
  };

  schedule();
  socket.once('disconnect', () => {
    if (timer) clearTimeout(timer);
  });
};

export const authenticateQueuedRunSocket = async (
  socket: QueuedRunSocket,
  next: SocketNext,
): Promise<void> => {
  const cookieHeader = socket.handshake.headers.cookie;
  const apiKey =
    firstString(socket.handshake.auth?.apiKey) ??
    firstString(socket.handshake.headers['x-api-key']);

  if (!cookieHeader && !apiKey) {
    next(new Error('Unauthorized'));
    return;
  }

  const identity = await resolveHttpCredentials(cookieHeader, apiKey);
  if (!identity) {
    next(new Error('Unauthorized'));
    return;
  }

  socket.data.userId = identity.userId;
  scheduleSocketExpiration(socket, identity.expiresAtMs);
  next();
};

export const joinQueuedRunRoom = async (socket: QueuedRunSocket): Promise<void> => {
  if (!socket.data.userId) return;
  await socket.join(`user-${socket.data.userId}`);
};

export const handleQueuedRunConnection = async (
  socket: QueuedRunSocket,
  recentRecoveries: Map<string, any[]>,
  logger: SocketLogger,
): Promise<void> => {
  const userId = socket.data.userId;
  if (!userId) {
    logger.log('warn', `Client connected to queued-run namespace without verified identity: ${socket.id}`);
    socket.disconnect(true);
    return;
  }

  try {
    await joinQueuedRunRoom(socket);
  } catch {
    logger.log('warn', `Queued-run room join failed for socket ${socket.id}`);
    socket.disconnect(true);
    return;
  }

  logger.log('info', `Client joined queued-run namespace for user: ${userId}, socket: ${socket.id}`);

  const recoveries = recentRecoveries.get(userId);
  if (recoveries) {
    recoveries.forEach((recoveryData) => {
      socket.emit('run-recovered', recoveryData);
      logger.log('info', `Sent stored recovery notification for run: ${recoveryData.runId} to user: ${userId}`);
    });
    recentRecoveries.delete(userId);
  }

  socket.on('disconnect', () => {
    logger.log('info', `Client disconnected from queued-run namespace: ${socket.id}`);
  });
};

export const registerQueuedRunNamespace = (
  io: Server,
  recentRecoveries: Map<string, any[]>,
  logger: SocketLogger,
): void => {
  const namespace = io.of('/queued-run');
  namespace.use(authenticateQueuedRunSocket);
  namespace.on('connection', (socket) => {
    void handleQueuedRunConnection(socket, recentRecoveries, logger);
  });
};

type SocketOriginPolicyOptions = {
  allowedOrigin: string;
  isProduction: boolean;
  allowedExtensionOrigins?: string;
};

const normalizedOrigin = (origin: string): string | undefined => {
  try {
    return new URL(origin).origin;
  } catch {
    return undefined;
  }
};

const isLocalDevelopmentOrigin = (origin: string): boolean => {
  try {
    const url = new URL(origin);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      (url.hostname === 'localhost' ||
        url.hostname === '127.0.0.1' ||
        url.hostname === '[::1]')
    );
  } catch {
    return false;
  }
};

const normalizedExtensionOrigin = (origin: string): string | undefined => {
  const match = origin.trim().match(/^chrome-extension:\/\/([a-p]{32})\/?$/i);
  return match
    ? `chrome-extension://${match[1].toLowerCase()}`
    : undefined;
};

export const createSocketOriginPolicy = ({
  allowedOrigin,
  isProduction,
  allowedExtensionOrigins = '',
}: SocketOriginPolicyOptions) => {
  const normalizedAllowedOrigin = normalizedOrigin(allowedOrigin);
  const allowedExtensions = new Set(
    allowedExtensionOrigins
      .split(',')
      .map(normalizedExtensionOrigin)
      .filter((origin): origin is string => origin !== undefined),
  );

  return (
    request: IncomingMessage,
    callback: (errorCode: string | null | undefined, success: boolean) => void,
  ): void => {
    const origin = firstString(request.headers.origin);

    // Browsers send Origin on WebSocket and cross-origin polling handshakes.
    // Missing Origin is retained for trusted non-browser/API-key clients.
    if (!origin) {
      callback(null, true);
      return;
    }

    if (origin.toLowerCase().startsWith('chrome-extension:')) {
      const extensionOrigin = normalizedExtensionOrigin(origin);
      callback(
        null,
        extensionOrigin !== undefined && allowedExtensions.has(extensionOrigin),
      );
      return;
    }

    const normalizedRequestOrigin = normalizedOrigin(origin);
    const allowed =
      normalizedRequestOrigin !== undefined &&
      (normalizedRequestOrigin === normalizedAllowedOrigin ||
        (!isProduction && isLocalDevelopmentOrigin(normalizedRequestOrigin)));
    callback(null, allowed);
  };
};
