import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Socket } from 'socket.io';
import { sign } from 'jsonwebtoken';

vi.mock('../models/User', () => ({
  default: { findOne: vi.fn() },
}));

import User from '../models/User';
import {
  authenticateQueuedRunSocket,
  createSocketOriginPolicy,
  handleQueuedRunConnection,
  joinQueuedRunRoom,
  registerQueuedRunNamespace,
} from './socketAuth';

const originalJwtSecret = process.env.JWT_SECRET;

const makeSocket = (overrides: {
  auth?: Record<string, unknown>;
  headers?: Record<string, string>;
  query?: Record<string, string>;
  join?: ReturnType<typeof vi.fn>;
} = {}) => ({
  id: 'socket-1',
  data: {},
  handshake: {
    auth: overrides.auth ?? {},
    headers: overrides.headers ?? {},
    query: overrides.query ?? {},
  },
  join: overrides.join ?? vi.fn().mockResolvedValue(undefined),
  emit: vi.fn(),
  disconnect: vi.fn(),
  once: vi.fn(),
  on: vi.fn(),
} as unknown as Socket);

describe('authenticateQueuedRunSocket', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.JWT_SECRET = 'socket-auth-test-secret';
  });

  afterAll(() => {
    if (originalJwtSecret === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = originalJwtSecret;
    }
  });

  it('rejects connections with no credentials', async () => {
    const socket = makeSocket();
    const next = vi.fn();

    await authenticateQueuedRunSocket(socket, next);

    expect(next).toHaveBeenCalledOnce();
    expect(next.mock.calls[0][0]).toEqual(new Error('Unauthorized'));
    expect(socket.data.userId).toBeUndefined();
  });

  it('rejects an invalid session cookie without exposing verification details', async () => {
    const socket = makeSocket({
      headers: { cookie: 'token=not-a-valid-jwt' },
    });
    const next = vi.fn();

    await authenticateQueuedRunSocket(socket, next);

    expect(next).toHaveBeenCalledOnce();
    expect(next.mock.calls[0][0]).toEqual(new Error('Unauthorized'));
    expect(socket.data.userId).toBeUndefined();
  });

  it('rejects an expired session cookie', async () => {
    const token = sign({ id: 'expired-user' }, process.env.JWT_SECRET!, { expiresIn: -1 });
    const socket = makeSocket({ headers: { cookie: `token=${token}` } });
    const next = vi.fn();

    await authenticateQueuedRunSocket(socket, next);

    expect(next.mock.calls[0][0]).toEqual(new Error('Unauthorized'));
    expect(socket.data.userId).toBeUndefined();
  });

  it('sets socket.data.userId from a valid session cookie', async () => {
    const token = sign({ id: 'verified-session-user' }, process.env.JWT_SECRET!);
    const socket = makeSocket({
      headers: { cookie: `token=${token}` },
      query: { userId: 'victim-user' },
    });
    const next = vi.fn();

    await authenticateQueuedRunSocket(socket, next);

    expect(next).toHaveBeenCalledWith();
    expect(socket.data.userId).toBe('verified-session-user');
  });

  it('ignores query userId and prevents query-only impersonation', async () => {
    const socket = makeSocket({ query: { userId: 'victim-user' } });
    const next = vi.fn();

    await authenticateQueuedRunSocket(socket, next);

    expect(next.mock.calls[0][0]).toEqual(new Error('Unauthorized'));
    expect(socket.data.userId).toBeUndefined();
  });

  it('sets socket.data.userId from an API key supplied in handshake auth', async () => {
    vi.mocked(User.findOne).mockResolvedValue({
      id: 'verified-api-user',
    } as Awaited<ReturnType<typeof User.findOne>>);
    const socket = makeSocket({ auth: { apiKey: 'valid-api-key' } });
    const next = vi.fn();

    await authenticateQueuedRunSocket(socket, next);

    expect(User.findOne).toHaveBeenCalledWith({ api_key: 'valid-api-key' });
    expect(next).toHaveBeenCalledWith();
    expect(socket.data.userId).toBe('verified-api-user');
  });

  it('rejects an invalid API key without authorizing or deriving a room', async () => {
    vi.mocked(User.findOne).mockResolvedValue(null);
    const socket = makeSocket({ auth: { apiKey: 'invalid-api-key' } });
    const next = vi.fn();

    await authenticateQueuedRunSocket(socket, next);
    await joinQueuedRunRoom(socket);

    expect(User.findOne).toHaveBeenCalledWith({ api_key: 'invalid-api-key' });
    expect(next).toHaveBeenCalledOnce();
    expect(next.mock.calls[0][0]).toEqual(new Error('Unauthorized'));
    expect(socket.data.userId).toBeUndefined();
    expect(socket.join).not.toHaveBeenCalled();
  });

  it('joins a room derived only from the verified socket identity', async () => {
    const token = sign({ id: 'verified-user' }, process.env.JWT_SECRET!);
    const socket = makeSocket({
      headers: { cookie: `token=${token}` },
      query: { userId: 'victim-user' },
    });

    await authenticateQueuedRunSocket(socket, vi.fn());

    await joinQueuedRunRoom(socket);

    expect(socket.join).toHaveBeenCalledOnce();
    expect(socket.join).toHaveBeenCalledWith('user-verified-user');
  });

  it('disconnects without emitting recoveries when room joining fails', async () => {
    const joinError = new Error('internal adapter detail');
    const socket = makeSocket({
      join: vi.fn().mockRejectedValue(joinError),
    });
    socket.data.userId = 'verified-user';
    const recoveries = new Map([
      ['verified-user', [{ runId: 'run-1' }]],
    ]);
    const log = vi.fn();

    await handleQueuedRunConnection(socket, recoveries, { log });

    expect(socket.emit).not.toHaveBeenCalled();
    expect(recoveries.has('verified-user')).toBe(true);
    expect(socket.disconnect).toHaveBeenCalledWith(true);
    expect(log).toHaveBeenCalledWith(
      'warn',
      'Queued-run room join failed for socket socket-1',
    );
    expect(log.mock.calls.flat().join(' ')).not.toContain(joinError.message);
  });

  it('disconnects a JWT-authenticated socket when its token expires', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
    const token = sign(
      { id: 'expiring-user' },
      process.env.JWT_SECRET!,
      { expiresIn: 1 },
    );
    const socket = makeSocket({ headers: { cookie: `token=${token}` } });
    const next = vi.fn();

    await authenticateQueuedRunSocket(socket, next);
    await vi.advanceTimersByTimeAsync(999);
    expect(socket.disconnect).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(socket.disconnect).toHaveBeenCalledWith(true);
    vi.useRealTimers();
  });
});

describe('queued-run namespace registration', () => {
  it('registers authentication and the connection handler', () => {
    const namespace = {
      use: vi.fn(),
      on: vi.fn(),
    };
    const io = {
      of: vi.fn().mockReturnValue(namespace),
    };

    registerQueuedRunNamespace(
      io as never,
      new Map(),
      { log: vi.fn() },
    );

    expect(io.of).toHaveBeenCalledWith('/queued-run');
    expect(namespace.use).toHaveBeenCalledWith(authenticateQueuedRunSocket);
    expect(namespace.on).toHaveBeenCalledWith('connection', expect.any(Function));
  });
});

describe('Socket.IO handshake origin policy', () => {
  const checkOrigin = (
    origin: string | undefined,
    isProduction = true,
    allowedExtensionOrigins = '',
  ): Promise<boolean> =>
    new Promise((resolve) => {
      const policy = createSocketOriginPolicy({
        allowedOrigin: 'https://app.example.com/path',
        isProduction,
        allowedExtensionOrigins,
      });
      policy(
        { headers: origin === undefined ? {} : { origin } } as never,
        (_error, allowed) => resolve(allowed),
      );
    });

  it('allows the configured normalized origin', async () => {
    await expect(checkOrigin('https://app.example.com')).resolves.toBe(true);
  });

  it('rejects a hostile browser origin', async () => {
    await expect(checkOrigin('https://evil.example')).resolves.toBe(false);
  });

  it('allows local origins only outside production', async () => {
    await expect(checkOrigin('http://127.0.0.1:4173', false)).resolves.toBe(true);
    await expect(checkOrigin('http://127.0.0.1:4173', true)).resolves.toBe(false);
  });

  it('allows missing Origin for non-browser clients', async () => {
    await expect(checkOrigin(undefined)).resolves.toBe(true);
  });

  it('allows an explicitly configured Chrome extension origin', async () => {
    const extensionOrigin = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
    const otherExtension = 'chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba';

    await expect(
      checkOrigin(extensionOrigin, true, `${otherExtension}, ${extensionOrigin}/`),
    ).resolves.toBe(true);
  });

  it('still requires credentials after allowing an extension handshake', async () => {
    const extensionOrigin = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
    await expect(
      checkOrigin(extensionOrigin, true, extensionOrigin),
    ).resolves.toBe(true);

    const socket = makeSocket({ headers: { origin: extensionOrigin } });
    const next = vi.fn();
    await authenticateQueuedRunSocket(socket, next);

    expect(next.mock.calls[0][0]).toEqual(new Error('Unauthorized'));
    expect(socket.data.userId).toBeUndefined();
  });

  it('rejects an untrusted Chrome extension ID', async () => {
    await expect(
      checkOrigin(
        'chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba',
        true,
        'chrome-extension://abcdefghijklmnopabcdefghijklmnop',
      ),
    ).resolves.toBe(false);
  });

  it('rejects wildcard and unconfigured Chrome extension origins', async () => {
    const extensionOrigin = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';

    await expect(
      checkOrigin(extensionOrigin, true, 'chrome-extension://*'),
    ).resolves.toBe(false);
    await expect(checkOrigin(extensionOrigin)).resolves.toBe(false);
    await expect(
      checkOrigin(
        'chrome-extension://not-an-extension-id',
        true,
        extensionOrigin,
      ),
    ).resolves.toBe(false);
  });

  it('keeps normal web-origin matching unchanged when extensions are configured', async () => {
    const configuredExtension = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';

    await expect(
      checkOrigin('https://app.example.com', true, configuredExtension),
    ).resolves.toBe(true);
    await expect(
      checkOrigin('https://evil.example', true, configuredExtension),
    ).resolves.toBe(false);
  });
});
