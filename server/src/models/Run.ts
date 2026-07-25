import mongoose, { Document, Schema } from 'mongoose';

export interface IRun extends Document {
  status: string;
  name: string;
  robotId: string;
  robotMetaId: string;
  startedAt: string;
  finishedAt: string;
  browserId: string;
  interpreterSettings: any;
  log?: string | null;
  runId: string;
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
}

const RunSchema: Schema = new Schema(
  {
    status: { type: String, required: true },
    name: { type: String, required: true },
    robotId: { type: String, default: null },
    robotMetaId: { type: String, required: true },
    startedAt: { type: String, default: null },
    finishedAt: { type: String, default: null },
    browserId: { type: String, default: null },
    interpreterSettings: { type: Schema.Types.Mixed, default: null },
    log: { type: String, default: null },
    runId: { type: String, required: true },
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

RunSchema.index({ robotMetaId: 1, startedAt: 1 }, { name: 'run_robot_meta_started_at_idx' });
RunSchema.index({ status: 1, startedAt: 1 }, { name: 'run_status_started_at_idx' });
RunSchema.index({ runId: 1 }, { unique: true, name: 'run_id_uidx' });

const Run = mongoose.models.Run || mongoose.model<IRun>('Run', RunSchema);

export default Run;
