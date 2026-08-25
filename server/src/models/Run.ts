import mongoose, { Document, Schema } from 'mongoose';
import {
  addAdmissionGuardReleaseToTerminalUpdate,
  addFailureClassificationToTerminalUpdate,
  addSortAtToTerminalUpdate,
  isFailureRunStatus,
  isTerminalRunStatus,
  resolveTerminalSortAt,
} from '../services/runLifecycle';

export interface IRun extends Document {
  /**
   * Run lifecycle status. Common values:
   * queued | pending | running | success | completed | failed | aborted | dead
   * `dead` = attempts exhausted (dead-letter); distinct from retryable `failed`.
   */
  status: string;
  /** Last scrape heartbeat ISO timestamp; used for orphan lease reclaim. */
  heartbeatAt?: string | null;
  name: string;
  robotId: string;
  robotMetaId: string;
  startedAt: string;
  finishedAt: string;
  browserId: string;
  interpreterSettings: any;
  log?: string | null;
  runId: string;
  /** Stable account owner used by admission/idempotency (legacy rows use runByUserId). */
  ownerId?: string | null;
  /** Native date used for deterministic run ordering without parsing legacy strings. */
  sortAt?: Date | null;
  retryOfRunId?: string | null;
  originalRunId?: string | null;
  retrySequence?: number | null;
  retryRequestKey?: string | null;
  /** Reserved for Task 6 failure normalization. */
  normalizedFailureReason?: string | null;
  /** Internal unique reservation while this automation run is active. */
  activeAutomationKey?: string | null;
  /** Internal per-account active-run slot. */
  accountActiveSlot?: number | null;
  runByUserId?: mongoose.Types.ObjectId | string | number | null;
  runByScheduleId?: string | null;
  runByAPI?: boolean | null;
  runBySDK?: boolean | null;
  serializableOutput?: any | null;
  binaryOutput?: any;
  retryCount?: number;
  duration?: number | null;
  errorMessage?: string | null;
  queueJobId?: string | null;
  /** Denormalized list-extraction row count; always written on finish (default 0). */
  rowsExtracted: number;
  /** Net-new / promoted job-board rows from this run (queued + readyFromList). */
  jobsAddedToBoard?: number;
  /** Board enqueue: rows considered from extraction. */
  jobsBoardConsidered?: number;
  /** Board enqueue: skipped as already on board / fresh. */
  jobsBoardDeduped?: number;
  /** Drift anomaly taxonomy: zero_rows | row_drop | null */
  anomaly?: string | null;
  anomalyMeta?: {
    current: number;
    baseline: number | null;
    ratio: number | null;
    baselineSource: 'last_good_run' | 'previewRows' | 'none';
    escalated: boolean;
    threshold: number | null;
  } | null;
  /** Scout-X scrape ID copied from the robot at run create (history across recreate). */
  scoutId?: string | null;
  /** Operator/system failure taxonomy; starts with layout_change. */
  failureReason?: string | null;
  /** How failureReason was set: suggested | confirmed | override */
  failureReasonSource?: 'suggested' | 'confirmed' | 'override' | null;
}

const RunSchema: Schema = new Schema(
  {
    status: { type: String, required: true },
    name: { type: String, required: true },
    robotId: { type: String, default: null },
    robotMetaId: { type: String, required: true },
    startedAt: { type: String, default: null },
    finishedAt: { type: String, default: null },
    heartbeatAt: { type: String, default: null },
    browserId: { type: String, default: null },
    interpreterSettings: { type: Schema.Types.Mixed, default: null },
    log: { type: String, default: null },
    runId: { type: String, required: true },
    ownerId: { type: String, default: null },
    sortAt: { type: Date, default: null },
    retryOfRunId: { type: String, default: null },
    originalRunId: { type: String, default: null },
    retrySequence: { type: Number, default: null },
    retryRequestKey: { type: String, default: undefined },
    normalizedFailureReason: { type: String, default: null },
    activeAutomationKey: { type: String, default: undefined },
    accountActiveSlot: { type: Number, default: undefined },
    runByUserId: { type: Schema.Types.Mixed, default: null },
    runByScheduleId: { type: String, default: null },
    runByAPI: { type: Boolean, default: null },
    runBySDK: { type: Boolean, default: null },
    serializableOutput: { type: Schema.Types.Mixed, default: null },
    binaryOutput: { type: Schema.Types.Mixed, default: {} },
    retryCount: { type: Number, default: 0 },
    duration: { type: Number, default: null },
    errorMessage: { type: String, default: null },
    queueJobId: { type: String, default: null },
    rowsExtracted: { type: Number, default: 0 },
    jobsAddedToBoard: { type: Number, default: 0 },
    jobsBoardConsidered: { type: Number, default: 0 },
    jobsBoardDeduped: { type: Number, default: 0 },
    anomaly: { type: String, default: null },
    anomalyMeta: { type: Schema.Types.Mixed, default: null },
    scoutId: { type: String, default: null },
    failureReason: { type: String, default: null },
    failureReasonSource: { type: String, default: null },
  },
  {
    timestamps: false,
    collection: 'maxun_runs'
  }
);

RunSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (doc, ret) => {
    ret.id = ret._id;
    delete ret._id;
  },
});

RunSchema.pre('save', function releaseAdmissionGuardsOnTerminalSave() {
  if (isFailureRunStatus(this.status as string | null | undefined)) {
    const classified = addFailureClassificationToTerminalUpdate({
      status: this.status,
      failureReason: this.failureReason,
      failureReasonSource: this.failureReasonSource,
      normalizedFailureReason: this.normalizedFailureReason,
      errorMessage: this.errorMessage,
    });
    this.set('failureReason', classified.failureReason);
    this.set('failureReasonSource', classified.failureReasonSource);
    this.set('normalizedFailureReason', classified.normalizedFailureReason);
  }
  if (isTerminalRunStatus(this.status as string | null | undefined)) {
    this.set('activeAutomationKey', undefined);
    this.set('accountActiveSlot', undefined);
    const finishedAt = this.get('finishedAt') as string | null | undefined;
    if (finishedAt) {
      this.set('sortAt', resolveTerminalSortAt(finishedAt));
    }
  }
});

RunSchema.pre(
  ['updateOne', 'updateMany', 'findOneAndUpdate'],
  function releaseAdmissionGuardsOnTerminalUpdate() {
    const update = this.getUpdate() as Record<string, any> | null;
    if (update) {
      this.setUpdate(
        addSortAtToTerminalUpdate(
          addAdmissionGuardReleaseToTerminalUpdate(
            addFailureClassificationToTerminalUpdate(update)
          )
        )
      );
    }
  }
);

RunSchema.index({ robotMetaId: 1, startedAt: 1 }, { name: 'run_robot_meta_started_at_idx' });
RunSchema.index({ robotMetaId: 1, _id: -1 }, { name: 'run_robot_meta_id_desc_idx' });
RunSchema.index({ status: 1, startedAt: 1 }, { name: 'run_status_started_at_idx' });
RunSchema.index({ runId: 1 }, { unique: true, name: 'run_id_uidx' });
RunSchema.index({ scoutId: 1, startedAt: -1 }, { name: 'run_scout_id_started_at_idx' });
RunSchema.index(
  { ownerId: 1, retryRequestKey: 1 },
  {
    unique: true,
    name: 'run_owner_retry_request_key_uidx',
    partialFilterExpression: { retryRequestKey: { $type: 'string' } },
  }
);
RunSchema.index(
  { ownerId: 1, activeAutomationKey: 1 },
  {
    unique: true,
    name: 'run_owner_active_automation_uidx',
    partialFilterExpression: { activeAutomationKey: { $type: 'string' } },
  }
);
RunSchema.index(
  { ownerId: 1, accountActiveSlot: 1 },
  {
    unique: true,
    name: 'run_owner_active_slot_uidx',
    partialFilterExpression: { accountActiveSlot: { $type: 'number' } },
  }
);

/** Post-backfill list indexes (ownerId + sortAt); require backfillRunListFields. */
RunSchema.index({ ownerId: 1, sortAt: -1, _id: -1 }, { name: 'run_owner_sort_at_desc_idx' });
RunSchema.index({ ownerId: 1, status: 1, sortAt: -1 }, { name: 'run_owner_status_sort_at_idx' });
RunSchema.index(
  { ownerId: 1, normalizedFailureReason: 1, sortAt: -1 },
  { name: 'run_owner_failure_reason_sort_at_idx' }
);
RunSchema.index(
  { ownerId: 1, robotMetaId: 1, sortAt: -1 },
  { name: 'run_owner_robot_meta_sort_at_idx' }
);
RunSchema.index({ sortAt: 1, status: 1 }, { name: 'run_sort_at_status_idx' });

const Run = mongoose.models.Run || mongoose.model<IRun>('Run', RunSchema);

export default Run;
