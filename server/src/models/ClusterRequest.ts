import mongoose, { Document, Schema, Types } from 'mongoose';

export type ClusterRequestType = 'predefined' | 'custom_urls';
export type ClusterRequestStatus = 'submitted' | 'in_review' | 'published' | 'rejected';

export type ClusterRequestUrlRobotOverride = {
  url: string;
  robotMetaId: string;
};

export interface IClusterRequest extends Document {
  auth0Sub: string;
  type: ClusterRequestType;
  title: string;
  industries: string[];
  locations: string[];
  roles: string[];
  experienceLevels: string[];
  experienceMin?: number | null;
  experienceMax?: number | null;
  companies: string[];
  urls: string[];
  notes?: string | null;
  status: ClusterRequestStatus;
  resultClusterId?: Types.ObjectId | null;
  adminNotes?: string | null;
  /** Manual URL → automation links when host auto-match fails (e.g. Workday vs careers.*). */
  urlRobotOverrides?: ClusterRequestUrlRobotOverride[];
  submittedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ClusterRequestSchema = new Schema(
  {
    auth0Sub: { type: String, required: true, index: true },
    type: {
      type: String,
      enum: ['predefined', 'custom_urls'],
      required: true,
      default: 'predefined',
    },
    title: { type: String, required: true, trim: true },
    industries: { type: [String], default: [] },
    locations: { type: [String], default: [] },
    roles: { type: [String], default: [] },
    experienceLevels: { type: [String], default: [] },
    experienceMin: { type: Number, default: null },
    experienceMax: { type: Number, default: null },
    companies: { type: [String], default: [] },
    urls: { type: [String], default: [] },
    notes: { type: String, default: null },
    status: {
      type: String,
      enum: ['submitted', 'in_review', 'published', 'rejected'],
      default: 'submitted',
      index: true,
    },
    resultClusterId: { type: Schema.Types.ObjectId, ref: 'Cluster', default: null },
    adminNotes: { type: String, default: null },
    urlRobotOverrides: {
      type: [
        {
          url: { type: String, required: true },
          robotMetaId: { type: String, required: true },
          _id: false,
        },
      ],
      default: [],
    },
    submittedAt: { type: Date, default: () => new Date(), index: true },
  },
  {
    timestamps: true,
    collection: 'scoutx_cluster_requests',
  }
);

ClusterRequestSchema.index({ auth0Sub: 1, submittedAt: -1 });
ClusterRequestSchema.index({ status: 1, submittedAt: -1 });

ClusterRequestSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret: Record<string, unknown>) => {
    ret.id = String(ret._id);
    delete ret._id;
    if (ret.resultClusterId) ret.resultClusterId = String(ret.resultClusterId);
  },
});

const ClusterRequest =
  mongoose.models.ClusterRequest ||
  mongoose.model<IClusterRequest>('ClusterRequest', ClusterRequestSchema);

export default ClusterRequest;
