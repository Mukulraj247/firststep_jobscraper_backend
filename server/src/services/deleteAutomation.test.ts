import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findRobot: vi.fn(),
  deleteRobot: vi.fn(),
  findRuns: vi.fn(),
  updateManyRuns: vi.fn(),
  deleteManyRuns: vi.fn(),
  deleteExtracted: vi.fn(),
  cancelScheduledTrigger: vi.fn(),
  getAgenda: vi.fn(),
  agendaCancel: vi.fn(),
  enqueueAbortRun: vi.fn(),
  abortRun: vi.fn(),
  killScrapeChildForRun: vi.fn(),
  getSessionStatePath: vi.fn(),
  removeFirebase: vi.fn(),
  unlink: vi.fn(),
}));

vi.mock('../models/Robot', () => ({
  default: {
    findOne: (...args: unknown[]) => mocks.findRobot(...args),
    deleteOne: (...args: unknown[]) => mocks.deleteRobot(...args),
  },
}));

vi.mock('../models/Run', () => ({
  default: {
    find: (...args: unknown[]) => ({
      select: () => ({
        lean: () => mocks.findRuns(...args),
      }),
    }),
    updateMany: (...args: unknown[]) => mocks.updateManyRuns(...args),
    deleteMany: (...args: unknown[]) => mocks.deleteManyRuns(...args),
  },
}));

vi.mock('../models/ExtractedData', () => ({
  default: {
    deleteMany: (...args: unknown[]) => mocks.deleteExtracted(...args),
  },
}));

vi.mock('../queue/scraperQueue', () => ({
  cancelScheduledTrigger: (...args: unknown[]) => mocks.cancelScheduledTrigger(...args),
  getAgenda: (...args: unknown[]) => mocks.getAgenda(...args),
  enqueueAbortRun: (...args: unknown[]) => mocks.enqueueAbortRun(...args),
}));

vi.mock('../workers/execution', () => ({
  abortRun: (...args: unknown[]) => mocks.abortRun(...args),
}));

vi.mock('../workers/scrapeJobSupervisor', () => ({
  killScrapeChildForRun: (...args: unknown[]) => mocks.killScrapeChildForRun(...args),
}));

vi.mock('../storage/sessionState', () => ({
  getSessionStatePath: (...args: unknown[]) => mocks.getSessionStatePath(...args),
}));

vi.mock('../storage/firebaseStorage', () => ({
  removeFirebaseObjectsForRunIds: (...args: unknown[]) => mocks.removeFirebase(...args),
}));

vi.mock('fs/promises', () => ({
  unlink: (...args: unknown[]) => mocks.unlink(...args),
}));

vi.mock('../logger', () => ({
  default: { log: vi.fn() },
}));

import { deleteAutomationCascade } from './deleteAutomation';

describe('deleteAutomationCascade', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DELETE_AUTOMATION_ABORT_WAIT_MS = '0';
    mocks.findRobot.mockResolvedValue({ _id: 'robot-oid', userId: 'u1' });
    mocks.deleteRobot.mockResolvedValue({ deletedCount: 1 });
    mocks.deleteManyRuns.mockResolvedValue({ deletedCount: 1 });
    mocks.deleteExtracted.mockResolvedValue({ deletedCount: 0 });
    mocks.cancelScheduledTrigger.mockResolvedValue(undefined);
    mocks.agendaCancel.mockResolvedValue(2);
    mocks.getAgenda.mockResolvedValue({ cancel: mocks.agendaCancel });
    mocks.enqueueAbortRun.mockResolvedValue({});
    mocks.abortRun.mockResolvedValue(true);
    mocks.killScrapeChildForRun.mockResolvedValue(false);
    mocks.getSessionStatePath.mockResolvedValue('/tmp/session.json');
    mocks.unlink.mockRejectedValue(new Error('ENOENT'));
    mocks.removeFirebase.mockResolvedValue(undefined);
    mocks.updateManyRuns.mockResolvedValue({ modifiedCount: 1 });
  });

  it('aborts in-flight runs before deleting robot and runs', async () => {
    mocks.findRuns.mockResolvedValue([
      { runId: 'run-active', status: 'running' },
      { runId: 'run-done', status: 'completed' },
    ]);

    await deleteAutomationCascade('u1', 'auto-1');

    expect(mocks.updateManyRuns).toHaveBeenCalledWith(
      { robotMetaId: 'auto-1', runId: { $in: ['run-active'] } },
      expect.objectContaining({
        $set: expect.objectContaining({ status: 'aborted' }),
      })
    );
    expect(mocks.killScrapeChildForRun).toHaveBeenCalledWith('run-active');
    expect(mocks.abortRun).toHaveBeenCalledWith('run-active', 'u1');
    expect(mocks.enqueueAbortRun).toHaveBeenCalledWith('u1', 'run-active');
    expect(mocks.killScrapeChildForRun).not.toHaveBeenCalledWith('run-done');

    expect(mocks.agendaCancel).toHaveBeenCalled();
    expect(mocks.deleteManyRuns).toHaveBeenCalled();
    expect(mocks.deleteRobot).toHaveBeenCalled();
  });

  it('skips abort when no active runs', async () => {
    mocks.findRuns.mockResolvedValue([{ runId: 'run-done', status: 'completed' }]);

    await deleteAutomationCascade('u1', 'auto-2');

    expect(mocks.updateManyRuns).not.toHaveBeenCalled();
    expect(mocks.enqueueAbortRun).not.toHaveBeenCalled();
    expect(mocks.deleteRobot).toHaveBeenCalled();
  });

  it('throws 404 when automation missing', async () => {
    mocks.findRobot.mockResolvedValue(null);
    await expect(deleteAutomationCascade('u1', 'missing')).rejects.toMatchObject({
      message: 'Automation not found',
      statusCode: 404,
    });
  });
});
