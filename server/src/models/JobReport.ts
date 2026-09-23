import mongoose, { Document, Schema } from 'mongoose';

export type JobReportReason =
  | 'incorrect_company'
  | 'incorrect_category'
  | 'old_job'
  | 'other';

export type JobReportStatus = 'open' | 'reviewed';

export interface IJobReport extends Document {
  auth0Sub: string;
  reporterEmail?: string | null;
  reporterName?: string | null;
  jobId?: string | null;
  jobUrlKey: string;
  jobUrl?: string | null;
  title: string;
  company: string;
  reason: JobReportReason;
  note?: string | null;
  status: JobReportStatus;
  reviewedAt?: Date | null;
  reviewedBy?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const JobReportSchema = new Schema(
  {
    auth0Sub: { type: String, required: true, index: true },
    reporterEmail: { type: String, default: null },
    reporterName: { type: String, default: null },
    jobId: { type: String, default: null },
    jobUrlKey: { type: String, required: true, index: true },
    jobUrl: { type: String, default: null },
    title: { type: String, default: '' },
    company: { type: String, default: '' },
    reason: {
      type: String,
      enum: ['incorrect_company', 'incorrect_category', 'old_job', 'other'],
      required: true,
    },
    note: { type: String, default: null },
    status: {
      type: String,
      enum: ['open', 'reviewed'],
      default: 'open',
      index: true,
    },
    reviewedAt: { type: Date, default: null },
    reviewedBy: { type: String, default: null },
  },
  {
    timestamps: true,
    collection: 'scoutx_job_reports',
  }
);

JobReportSchema.index({ status: 1, createdAt: -1 });
JobReportSchema.index({ auth0Sub: 1, jobUrlKey: 1, createdAt: -1 });

JobReportSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret: Record<string, unknown>) => {
    ret.id = String(ret._id);
    delete ret._id;
  },
});

const JobReport =
  mongoose.models.JobReport || mongoose.model<IJobReport>('JobReport', JobReportSchema);

export default JobReport;
