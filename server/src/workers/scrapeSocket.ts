/**
 * Socket emits for scraper jobs.
 * In a scrape child process (SCRAPE_JOB_CHILD=1), forward via IPC to the parent supervisor.
 * In the parent / in-process mode, emit on the real Socket.IO server.
 */

import logger from '../logger';

export type QueuedRunSocketIpcMessage = {
  type: 'socket';
  namespace: '/queued-run';
  room: string;
  event: string;
  payload: Record<string, unknown>;
};

const isScrapeChild = (): boolean => process.env.SCRAPE_JOB_CHILD === '1';

export async function emitQueuedRunEvent(
  userId: string,
  event: string,
  payload: Record<string, unknown>
): Promise<void> {
  const room = `user-${userId}`;
  if (isScrapeChild() && typeof process.send === 'function') {
    const msg: QueuedRunSocketIpcMessage = {
      type: 'socket',
      namespace: '/queued-run',
      room,
      event,
      payload,
    };
    try {
      process.send(msg);
    } catch (error: any) {
      logger.log('warn', `Failed to IPC socket event ${event}: ${error?.message || error}`);
    }
    return;
  }

  try {
    const { io } = await import('../server');
    io.of('/queued-run').to(room).emit(event, payload);
  } catch (error: any) {
    logger.log('warn', `Failed to emit ${event} for user ${userId}: ${error?.message || error}`);
  }
}
