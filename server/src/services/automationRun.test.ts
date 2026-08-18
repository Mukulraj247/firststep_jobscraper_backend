import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  updateOne: vi.fn(),
  enqueue: vi.fn(),
}));

vi.mock('../models/Run', () => ({
  default: {
    create: mocks.create,
    updateOne: mocks.updateOne,
  },
}));
vi.mock('../queue/scraperQueue', () => ({
  enqueueScraperRun: mocks.enqueue,
  requeueScraperRun: vi.fn(),
}));
vi.mock('./automation', () => ({
  getAutomationConfig: vi.fn(() => ({ targetUrl: 'https://example.com' })),
}));
vi.mock('./automationConfigView', () => ({
  toOperationalRunConfig: vi.fn((config) => config),
}));
vi.mock('../logger', () => ({
  default: { log: vi.fn() },
}));

import { createQueuedAutomationRun } from './automationRun';

describe('createQueuedAutomationRun', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.create.mockResolvedValue({});
    mocks.updateOne.mockResolvedValue({ modifiedCount: 1 });
  });

  it('marks the created run failed when Agenda enqueue fails', async () => {
    mocks.enqueue.mockRejectedValueOnce(new Error('Agenda unavailable'));
    const robot = {
      _id: 'robot-db-1',
      recording_meta: { id: 'automation-1', name: 'Example' },
    };

    await expect(createQueuedAutomationRun(robot, 'owner-1')).rejects.toThrow('Agenda unavailable');

    expect(mocks.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ runId: expect.any(String) }),
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'failed',
          finishedAt: expect.any(String),
          errorMessage: 'Agenda unavailable',
        }),
      })
    );
  });

  it('preserves duplicate-key metadata for admission conflict handling', async () => {
    const duplicate = Object.assign(new Error('duplicate active reservation'), {
      code: 11000,
      keyPattern: { ownerId: 1, activeAutomationKey: 1 },
    });
    mocks.create.mockRejectedValueOnce(duplicate);
    const robot = {
      _id: 'robot-db-1',
      recording_meta: { id: 'automation-1', name: 'Example' },
    };

    await expect(createQueuedAutomationRun(robot, 'owner-1')).rejects.toBe(duplicate);
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
});
