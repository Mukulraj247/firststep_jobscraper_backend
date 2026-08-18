import Run from '../models/Run';
import Robot from '../models/Robot';
import { normalizeOwnerIdForWrite, ownerIdFilter, ownerIdVariants } from '../utils/ownerId';
import { createQueuedAutomationRun } from './automationRun';
import {
  ACTIVE_RUN_STATUSES,
  TERMINAL_RUN_STATUSES,
  isTerminalRunStatus,
} from './runLifecycle';

export const ACCOUNT_ACTIVE_RUN_LIMIT = Math.max(
  1,
  Number.parseInt(process.env.ACCOUNT_ACTIVE_RUN_LIMIT || '8', 10) || 8
);

type RunRecord = {
  runId: string;
  browserId?: string;
  queueJobId?: string;
  ownerId?: string;
  robotMetaId: string;
  status: string;
  retryRequestKey?: string;
  retryOfRunId?: string;
  originalRunId?: string;
  retrySequence?: number;
};

type RetryLineage = {
  retryOfRunId: string;
  originalRunId: string;
  retrySequence: number;
  retryRequestKey: string;
};

type QueuedRunResult = {
  runId: string;
  browserId: string;
  queued: boolean;
  queueJobId?: string;
};

export interface RunAdmissionDependencies {
  findRun(runId: string): Promise<RunRecord | null>;
  findRetryByKey(ownerId: string, requestKey: string): Promise<RunRecord | null>;
  findOwnedRobot(ownerId: string, robotMetaId: string): Promise<any | null>;
  getActiveRunUsage(ownerId: string): Promise<{
    activeCount: number;
    occupiedSlots: number[];
  }>;
  findActiveRun(ownerId: string, robotMetaId: string): Promise<RunRecord | null>;
  releaseInactiveReservations?(ownerId: string): Promise<void>;
  createQueuedRun(
    robot: any,
    ownerId: string,
    options: {
      source: 'manual' | 'scheduled';
      scheduleJobId?: string;
      runtimeConfig?: Record<string, any>;
      lineage?: RetryLineage;
      admission: {
        activeAutomationKey: string;
        accountActiveSlot: number;
      };
    }
  ): Promise<QueuedRunResult>;
}

export type AdmissionErrorCode =
  | 'AUTOMATION_RUN_ACTIVE'
  | 'ACCOUNT_RUN_LIMIT'
  | 'RUN_NOT_FOUND'
  | 'IDEMPOTENCY_KEY_REQUIRED';

export class AdmissionError extends Error {
  constructor(
    public readonly code: AdmissionErrorCode,
    public readonly statusCode: number,
    message: string,
    public readonly activeRunId?: string
  ) {
    super(message);
    this.name = 'AdmissionError';
  }
}

const ownerLocks = new Map<string, Promise<void>>();

async function withOwnerLock<T>(ownerId: string, work: () => Promise<T>): Promise<T> {
  const previous = ownerLocks.get(ownerId) || Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.then(() => current);
  ownerLocks.set(ownerId, queued);
  await previous;
  try {
    return await work();
  } finally {
    release();
    if (ownerLocks.get(ownerId) === queued) {
      ownerLocks.delete(ownerId);
    }
  }
}

function duplicateIndex(error: any): string | null {
  if (error?.code !== 11000) return null;
  const keyPattern = error?.keyPattern || {};
  if (keyPattern.retryRequestKey) return 'retryRequestKey';
  if (keyPattern.activeAutomationKey) return 'activeAutomationKey';
  if (keyPattern.accountActiveSlot) return 'accountActiveSlot';
  const message = String(error?.message || '');
  if (message.includes('retryRequestKey')) return 'retryRequestKey';
  if (message.includes('activeAutomationKey')) return 'activeAutomationKey';
  if (message.includes('accountActiveSlot')) return 'accountActiveSlot';
  return null;
}

function activeError(activeRunId?: string): AdmissionError {
  return new AdmissionError(
    'AUTOMATION_RUN_ACTIVE',
    409,
    'This automation already has an active run',
    activeRunId
  );
}

function limitError(): AdmissionError {
  return new AdmissionError(
    'ACCOUNT_RUN_LIMIT',
    429,
    `Account active-run limit (${ACCOUNT_ACTIVE_RUN_LIMIT}) reached`
  );
}

function toQueuedRunResult(run: RunRecord): QueuedRunResult & Partial<RetryLineage> {
  return {
    runId: run.runId,
    browserId: run.browserId || '',
    queued: ACTIVE_RUN_STATUSES.includes(
      String(run.status).toLowerCase() as (typeof ACTIVE_RUN_STATUSES)[number]
    ),
    ...(run.queueJobId ? { queueJobId: run.queueJobId } : {}),
    ...(run.retryOfRunId ? { retryOfRunId: run.retryOfRunId } : {}),
    ...(run.originalRunId ? { originalRunId: run.originalRunId } : {}),
    ...(run.retrySequence != null ? { retrySequence: run.retrySequence } : {}),
    ...(run.retryRequestKey ? { retryRequestKey: run.retryRequestKey } : {}),
  };
}

export function createRunAdmissionService(dependencies: RunAdmissionDependencies) {
  async function createWithSlot(input: {
    ownerId: string;
    robot: any;
    source: 'manual' | 'scheduled';
    scheduleJobId?: string;
    runtimeConfig?: Record<string, any>;
    lineage?: RetryLineage;
    candidateSlots: number[];
  }): Promise<{ created: boolean; run: QueuedRunResult & Partial<RetryLineage> }> {
    for (const slot of input.candidateSlots) {
      try {
        const run = await dependencies.createQueuedRun(input.robot, input.ownerId, {
          source: input.source,
          ...(input.scheduleJobId ? { scheduleJobId: input.scheduleJobId } : {}),
          runtimeConfig: input.runtimeConfig,
          lineage: input.lineage,
          admission: {
            activeAutomationKey: String(input.robot.recording_meta.id),
            accountActiveSlot: slot,
          },
        });
        return { created: true, run };
      } catch (error: any) {
        const duplicate = duplicateIndex(error);
        if (duplicate === 'accountActiveSlot') continue;
        if (duplicate === 'activeAutomationKey') throw activeError();
        if (duplicate === 'retryRequestKey' && input.lineage) {
          const existing = await dependencies.findRetryByKey(
            input.ownerId,
            input.lineage.retryRequestKey
          );
          if (existing) {
            return { created: false, run: toQueuedRunResult(existing) };
          }
        }
        throw error;
      }
    }
    throw limitError();
  }

  function availableSlotCandidates(usage: {
    activeCount: number;
    occupiedSlots: number[];
  }): number[] {
    const availableCount = ACCOUNT_ACTIVE_RUN_LIMIT - usage.activeCount;
    const occupiedSlots = new Set(usage.occupiedSlots);
    return Array.from(
      { length: ACCOUNT_ACTIVE_RUN_LIMIT },
      (_, slot) => slot
    ).filter((slot) => !occupiedSlots.has(slot)).slice(0, availableCount);
  }

  async function admitNew(input: {
    ownerId: unknown;
    robot: any;
    source: 'manual' | 'scheduled';
    scheduleJobId?: string;
    runtimeConfig?: Record<string, any>;
  }) {
    const ownerId = normalizeOwnerIdForWrite(input.ownerId);
    return withOwnerLock(ownerId, async () => {
      await dependencies.releaseInactiveReservations?.(ownerId);
      const active = await dependencies.findActiveRun(
        ownerId,
        String(input.robot.recording_meta.id)
      );
      if (active) throw activeError();
      const usage = await dependencies.getActiveRunUsage(ownerId);
      if (usage.activeCount >= ACCOUNT_ACTIVE_RUN_LIMIT) {
        throw limitError();
      }
      return createWithSlot({
        ownerId,
        robot: input.robot,
        source: input.source,
        scheduleJobId: input.scheduleJobId,
        runtimeConfig: input.runtimeConfig,
        candidateSlots: availableSlotCandidates(usage),
      });
    });
  }

  return {
    async admitManual(input: {
      ownerId: unknown;
      robot: any;
      runtimeConfig?: Record<string, any>;
    }) {
      return admitNew({
        ...input,
        source: 'manual',
      });
    },

    async admitScheduled(input: {
      ownerId: unknown;
      robot: any;
      scheduleJobId?: string;
    }) {
      return admitNew({
        ...input,
        source: 'scheduled',
      });
    },

    async admitRetry(input: {
      ownerId: unknown;
      runId: string;
      requestKey: string;
    }) {
      const ownerId = normalizeOwnerIdForWrite(input.ownerId);
      const requestKey = String(input.requestKey || '').trim();
      if (!requestKey) {
        throw new AdmissionError(
          'IDEMPOTENCY_KEY_REQUIRED',
          400,
          'Idempotency-Key header is required'
        );
      }

      return withOwnerLock(ownerId, async () => {
        const previouslyAccepted = await dependencies.findRetryByKey(ownerId, requestKey);
        if (previouslyAccepted) {
          return { created: false, run: toQueuedRunResult(previouslyAccepted) };
        }

        const source = await dependencies.findRun(input.runId);
        if (!source) {
          throw new AdmissionError('RUN_NOT_FOUND', 404, 'Run not found');
        }
        if (source.ownerId && normalizeOwnerIdForWrite(source.ownerId) !== ownerId) {
          throw new AdmissionError('RUN_NOT_FOUND', 404, 'Run not found');
        }
        const robot = await dependencies.findOwnedRobot(ownerId, source.robotMetaId);
        if (!robot) {
          throw new AdmissionError('RUN_NOT_FOUND', 404, 'Run not found');
        }
        if (!isTerminalRunStatus(source.status)) {
          throw activeError(source.runId);
        }

        await dependencies.releaseInactiveReservations?.(ownerId);
        const active = await dependencies.findActiveRun(ownerId, source.robotMetaId);
        if (active) throw activeError(active.runId);
        const usage = await dependencies.getActiveRunUsage(ownerId);
        if (usage.activeCount >= ACCOUNT_ACTIVE_RUN_LIMIT) {
          throw limitError();
        }

        const lineage: RetryLineage = {
          retryOfRunId: source.runId,
          originalRunId: source.originalRunId || source.runId,
          retrySequence: (source.retrySequence || 0) + 1,
          retryRequestKey: requestKey,
        };
        const admitted = await createWithSlot({
          ownerId,
          robot,
          source: 'manual',
          lineage,
          candidateSlots: availableSlotCandidates(usage),
        });
        if (!admitted.created) {
          return admitted;
        }
        return {
          created: true,
          run: { ...admitted.run, ...lineage },
        };
      });
    },
  };
}

const defaultDependencies: RunAdmissionDependencies = {
  async findRun(runId) {
    return Run.findOne({ runId }).lean() as any;
  },
  async findRetryByKey(ownerId, requestKey) {
    return Run.findOne({ ownerId, retryRequestKey: requestKey }).lean() as any;
  },
  async findOwnedRobot(ownerId, robotMetaId) {
    return Robot.findOne({
      ...ownerIdFilter(ownerId),
      'recording_meta.id': robotMetaId,
    }).lean();
  },
  async getActiveRunUsage(ownerId) {
    const variants = ownerIdVariants(ownerId);
    const [usage] = await Run.aggregate([
      {
        $match: {
          $or: [{ ownerId }, { runByUserId: { $in: variants } }],
          status: { $in: [...ACTIVE_RUN_STATUSES] },
        },
      },
      {
        $group: {
          _id: null,
          activeCount: { $sum: 1 },
          occupiedSlots: { $addToSet: '$accountActiveSlot' },
        },
      },
    ]);
    return {
      activeCount: usage?.activeCount || 0,
      occupiedSlots: (usage?.occupiedSlots || []).filter(
        (slot: unknown): slot is number => typeof slot === 'number'
      ),
    };
  },
  async findActiveRun(ownerId, robotMetaId) {
    const variants = ownerIdVariants(ownerId);
    return Run.findOne({
      $or: [{ ownerId }, { runByUserId: { $in: variants } }],
      robotMetaId,
      status: { $in: [...ACTIVE_RUN_STATUSES] },
    }).lean() as any;
  },
  async releaseInactiveReservations(ownerId) {
    await Run.updateMany(
      {
        ownerId,
        status: { $in: [...TERMINAL_RUN_STATUSES] },
        $or: [
          { activeAutomationKey: { $exists: true } },
          { accountActiveSlot: { $exists: true } },
        ],
      },
      { $unset: { activeAutomationKey: 1, accountActiveSlot: 1 } }
    );
  },
  createQueuedRun: createQueuedAutomationRun as RunAdmissionDependencies['createQueuedRun'],
};

export const runAdmission = createRunAdmissionService(defaultDependencies);
