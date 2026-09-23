import mongoose, { Document, Schema } from 'mongoose';

export interface IAssignedJob extends Document {
  auth0Sub: string;
  jobUrlKey: string;
  jobId?: string | null;
  assignedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const AssignedJobSchema = new Schema(
  {
    auth0Sub: { type: String, required: true, index: true },
    jobUrlKey: { type: String, required: true, index: true },
    jobId: { type: String, default: null },
    assignedAt: { type: Date, default: () => new Date(), index: true },
  },
  {
    timestamps: true,
    collection: 'scoutx_assigned_jobs',
  }
);

AssignedJobSchema.index({ auth0Sub: 1, jobUrlKey: 1 }, { unique: true });
AssignedJobSchema.index({ auth0Sub: 1, assignedAt: -1 });

AssignedJobSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret: Record<string, unknown>) => {
    ret.id = String(ret._id);
    delete ret._id;
  },
});

const AssignedJob =
  mongoose.models.AssignedJob || mongoose.model<IAssignedJob>('AssignedJob', AssignedJobSchema);

export default AssignedJob;
