import mongoose, { Document, Schema } from 'mongoose';

export interface ISavedJob extends Document {
  auth0Sub: string;
  jobUrlKey: string;
  jobId?: string | null;
  savedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const SavedJobSchema = new Schema(
  {
    auth0Sub: { type: String, required: true, index: true },
    jobUrlKey: { type: String, required: true, index: true },
    jobId: { type: String, default: null },
    savedAt: { type: Date, default: () => new Date(), index: true },
  },
  {
    timestamps: true,
    collection: 'scoutx_saved_jobs',
  }
);

SavedJobSchema.index({ auth0Sub: 1, jobUrlKey: 1 }, { unique: true });
SavedJobSchema.index({ auth0Sub: 1, savedAt: -1 });

SavedJobSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret: Record<string, unknown>) => {
    ret.id = String(ret._id);
    delete ret._id;
  },
});

const SavedJob =
  mongoose.models.SavedJob || mongoose.model<ISavedJob>('SavedJob', SavedJobSchema);

export default SavedJob;
