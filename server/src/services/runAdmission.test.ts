import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ACCOUNT_ACTIVE_RUN_LIMIT,
  AdmissionError,
  createRunAdmissionService,
  type RunAdmissionDependencies,
} from './runAdmission';

type StoredRun = {
  runId: string;
  ownerId: string;
  robotMetaId: string;
  status: string;
  retryRequestKey?: string;
  retryOfRunId?: string;
  originalRunId?: string;
  retrySequence?: number;
  accountActiveSlot?: number;
};

describe('run admission', () => {
  let runs: StoredRun[];
  let robots: Map<string, any>;
  let sequence: number;
  let dependencies: RunAdmissionDependencies;

  beforeEach(() => {
    runs = [];
    robots = new Map([
      ['automation-1', {
        _id: 'robot-db-1',
        recording_meta: { id: 'automation-1', name: 'Example' },
      }],
    ]);
    sequence = 0;

    dependencies = {
      findRun: vi.fn(async (runId: string) => runs.find((run) => run.runId === runId) || null),
      findRetryByKey: vi.fn(async (ownerId: string, requestKey: string) =>
        runs.find((run) => run.ownerId === ownerId && run.retryRequestKey === requestKey) || null),
      findOwnedRobot: vi.fn(async (ownerId: string, robotMetaId: string) =>
        ownerId === 'owner-1' ? robots.get(robotMetaId) || null : null),
      getActiveRunUsage: vi.fn(async (ownerId: string) => {
        const activeRuns = runs.filter((run) =>
          run.ownerId === ownerId &&
          ['pending', 'queued', 'scheduled', 'running', 'aborting'].includes(run.status)
        );
        return {
          activeCount: activeRuns.length,
          occupiedSlots: activeRuns.flatMap((run) =>
            run.accountActiveSlot == null ? [] : [run.accountActiveSlot]),
        };
      }),
      findActiveRun: vi.fn(async (ownerId: string, robotMetaId: string) =>
        runs.find((run) =>
          run.ownerId === ownerId &&
          run.robotMetaId === robotMetaId &&
          ['pending', 'queued', 'scheduled', 'running', 'aborting'].includes(run.status)
        ) || null),
      createQueuedRun: vi.fn(async (robot: any, ownerId: string, options: any) => {
        await Promise.resolve();
        const run: StoredRun = {
          runId: `run-${++sequence}`,
          ownerId,
          robotMetaId: robot.recording_meta.id,
          status: 'pending',
          accountActiveSlot: options.admission.accountActiveSlot,
          ...options.lineage,
        };
        runs.push(run);
        return { runId: run.runId, browserId: `browser-${sequence}`, queued: true };
      }),
    };
  });

  it('admits only one of ten parallel manual runs for an automation', async () => {
    const service = createRunAdmissionService(dependencies);

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        service.admitManual({ ownerId: 'owner-1', robot: robots.get('automation-1') })
      )
    );

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(runs.filter((run) => run.status === 'pending')).toHaveLength(1);
    for (const result of results.filter((item) => item.status === 'rejected')) {
      expect((result as PromiseRejectedResult).reason).toMatchObject({
        code: 'AUTOMATION_RUN_ACTIVE',
        statusCode: 409,
      });
    }
  });

  it('single-flights a scheduled and manual run racing for one automation', async () => {
    const service = createRunAdmissionService(dependencies);

    const results = await Promise.allSettled([
      service.admitManual({ ownerId: 'owner-1', robot: robots.get('automation-1') }),
      service.admitScheduled({
        ownerId: 'owner-1',
        robot: robots.get('automation-1'),
        scheduleJobId: 'schedule-1',
      }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(runs.filter((run) => run.status === 'pending')).toHaveLength(1);
  });

  it('returns one retry for ten parallel requests with the same idempotency key', async () => {
    runs.push({
      runId: 'failed-run',
      ownerId: 'owner-1',
      robotMetaId: 'automation-1',
      status: 'failed',
    });
    const service = createRunAdmissionService(dependencies);

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        service.admitRetry({
          ownerId: 'owner-1',
          runId: 'failed-run',
          requestKey: 'retry-key-1',
        })
      )
    );

    expect(new Set(results.map((result) => result.run.runId))).toEqual(new Set(['run-1']));
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(runs.filter((run) => run.retryRequestKey === 'retry-key-1')).toHaveLength(1);
  });

  it('reports a storage-level retry-key race as previously accepted', async () => {
    const source: StoredRun = {
      runId: 'failed-run',
      ownerId: 'owner-1',
      robotMetaId: 'automation-1',
      status: 'failed',
    };
    const existing = {
      runId: 'existing-retry',
      ownerId: 'owner-1',
      robotMetaId: 'automation-1',
      status: 'pending',
      retryOfRunId: 'failed-run',
      originalRunId: 'failed-run',
      retrySequence: 1,
      retryRequestKey: 'retry-race',
      browserId: 'browser-existing',
      serializableOutput: { secret: true },
    };
    runs.push(source);
    vi.mocked(dependencies.findRetryByKey)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existing);
    vi.mocked(dependencies.createQueuedRun).mockRejectedValueOnce(Object.assign(
      new Error('duplicate retry key'),
      { code: 11000, keyPattern: { ownerId: 1, retryRequestKey: 1 } }
    ));
    const service = createRunAdmissionService(dependencies);

    const result = await service.admitRetry({
      ownerId: 'owner-1',
      runId: source.runId,
      requestKey: 'retry-race',
    });

    expect(result.created).toBe(false);
    expect(result.run).toMatchObject({
      runId: 'existing-retry',
      browserId: 'browser-existing',
      retryRequestKey: 'retry-race',
    });
    expect(result.run).not.toHaveProperty('serializableOutput');
  });

  it('rejects retrying a non-terminal run', async () => {
    runs.push({
      runId: 'running-run',
      ownerId: 'owner-1',
      robotMetaId: 'automation-1',
      status: 'aborting',
    });
    const service = createRunAdmissionService(dependencies);

    await expect(service.admitRetry({
      ownerId: 'owner-1',
      runId: 'running-run',
      requestKey: 'retry-key-2',
    })).rejects.toMatchObject({
      code: 'AUTOMATION_RUN_ACTIVE',
      statusCode: 409,
    });
  });

  it('checks ownership before admitting a retry', async () => {
    runs.push({
      runId: 'foreign-run',
      ownerId: 'owner-2',
      robotMetaId: 'automation-1',
      status: 'failed',
    });
    const service = createRunAdmissionService(dependencies);

    await expect(service.admitRetry({
      ownerId: 'owner-1',
      runId: 'foreign-run',
      requestKey: 'retry-key-3',
    })).rejects.toMatchObject({
      code: 'RUN_NOT_FOUND',
      statusCode: 404,
    });
    expect(dependencies.createQueuedRun).not.toHaveBeenCalled();
  });

  it('allows a completed retry to be retried later with a new key', async () => {
    runs.push({
      runId: 'failed-run',
      ownerId: 'owner-1',
      robotMetaId: 'automation-1',
      status: 'failed',
    });
    const service = createRunAdmissionService(dependencies);
    const first = await service.admitRetry({
      ownerId: 'owner-1',
      runId: 'failed-run',
      requestKey: 'retry-key-4',
    });
    runs.find((run) => run.runId === first.run.runId)!.status = 'completed';

    const second = await service.admitRetry({
      ownerId: 'owner-1',
      runId: first.run.runId,
      requestKey: 'retry-key-5',
    });

    expect(second.created).toBe(true);
    expect(second.run).toMatchObject({
      retryOfRunId: first.run.runId,
      originalRunId: 'failed-run',
      retrySequence: 2,
      retryRequestKey: 'retry-key-5',
    });
  });

  it('enforces the default account active-run limit', async () => {
    for (let index = 0; index < 8; index += 1) {
      runs.push({
        runId: `active-${index}`,
        ownerId: 'owner-1',
        robotMetaId: `other-${index}`,
        status: 'running',
      });
    }
    const service = createRunAdmissionService(dependencies);

    await expect(service.admitManual({
      ownerId: 'owner-1',
      robot: robots.get('automation-1'),
    })).rejects.toEqual(expect.objectContaining({
      code: 'ACCOUNT_RUN_LIMIT',
      statusCode: 429,
    }));
  });

  it('counts unslotted active runs against concurrent storage-level slot admission', async () => {
    const unslottedActiveCount = 3;
    for (let index = 0; index < unslottedActiveCount; index += 1) {
      runs.push({
        runId: `legacy-active-${index}`,
        ownerId: 'owner-1',
        robotMetaId: `legacy-automation-${index}`,
        status: 'running',
      });
    }

    const competingRobots = Array.from(
      { length: ACCOUNT_ACTIVE_RUN_LIMIT },
      (_, index) => ({
        _id: `robot-db-${index + 2}`,
        recording_meta: {
          id: `competing-automation-${index}`,
          name: `Competing ${index}`,
        },
      })
    );
    vi.mocked(dependencies.getActiveRunUsage).mockResolvedValue({
      activeCount: unslottedActiveCount,
      occupiedSlots: [],
    });
    const occupiedSlots = new Set<number>();
    vi.mocked(dependencies.createQueuedRun).mockImplementation(
      async (robot: any, ownerId: string, options: any) => {
        await Promise.resolve();
        const slot = options.admission.accountActiveSlot;
        if (occupiedSlots.has(slot)) {
          throw Object.assign(new Error('duplicate account slot'), {
            code: 11000,
            keyPattern: { ownerId: 1, accountActiveSlot: 1 },
          });
        }
        occupiedSlots.add(slot);
        const run: StoredRun = {
          runId: `run-${++sequence}`,
          ownerId,
          robotMetaId: robot.recording_meta.id,
          status: 'pending',
          accountActiveSlot: slot,
        };
        runs.push(run);
        return { runId: run.runId, browserId: `browser-${sequence}`, queued: true };
      }
    );

    const results = await Promise.allSettled(
      competingRobots.map((robot) =>
        createRunAdmissionService(dependencies).admitManual({ ownerId: 'owner-1', robot })
      )
    );

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(
      ACCOUNT_ACTIVE_RUN_LIMIT - unslottedActiveCount
    );
    expect(runs.filter((run) =>
      ['pending', 'queued', 'scheduled', 'running', 'aborting'].includes(run.status)
    )).toHaveLength(ACCOUNT_ACTIVE_RUN_LIMIT);
  });

  it('uses all remaining capacity when active runs already occupy low slots', async () => {
    const occupiedSlotCount = ACCOUNT_ACTIVE_RUN_LIMIT / 2;
    for (let slot = 0; slot < occupiedSlotCount; slot += 1) {
      runs.push({
        runId: `slotted-active-${slot}`,
        ownerId: 'owner-1',
        robotMetaId: `slotted-automation-${slot}`,
        status: 'running',
        accountActiveSlot: slot,
      });
    }
    vi.mocked(dependencies.createQueuedRun).mockImplementation(
      async (robot: any, ownerId: string, options: any) => {
        const slot = options.admission.accountActiveSlot;
        if (runs.some((run) => run.ownerId === ownerId && run.accountActiveSlot === slot)) {
          throw Object.assign(new Error('duplicate account slot'), {
            code: 11000,
            keyPattern: { ownerId: 1, accountActiveSlot: 1 },
          });
        }
        const run: StoredRun = {
          runId: `run-${++sequence}`,
          ownerId,
          robotMetaId: robot.recording_meta.id,
          status: 'pending',
          accountActiveSlot: slot,
        };
        runs.push(run);
        return { runId: run.runId, browserId: `browser-${sequence}`, queued: true };
      }
    );

    const results = await Promise.allSettled(
      Array.from(
        { length: ACCOUNT_ACTIVE_RUN_LIMIT - occupiedSlotCount },
        (_, index) => createRunAdmissionService(dependencies).admitManual({
          ownerId: 'owner-1',
          robot: {
            recording_meta: {
              id: `remaining-automation-${index}`,
              name: `Remaining ${index}`,
            },
          },
        })
      )
    );

    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
    expect(runs).toHaveLength(ACCOUNT_ACTIVE_RUN_LIMIT);
  });

  it('requires a non-empty retry idempotency key', async () => {
    const service = createRunAdmissionService(dependencies);

    await expect(service.admitRetry({
      ownerId: 'owner-1',
      runId: 'anything',
      requestKey: ' ',
    })).rejects.toEqual(expect.any(AdmissionError));
  });
});
