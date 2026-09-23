import mongoose, { Document, Schema, Types } from 'mongoose';
import type { ClusterWindow } from '../services/clusterEntitlements';

export type ClusterKind = 'curated' | 'custom';
export type ClusterStatus = 'draft' | 'published' | 'archived';
export type ClusterSourceMode = 'filter' | 'source';

export type ClusterFilter = {
  frozenIndustries: string[];
  frozenCategories: string[];
  frozenExperienceLevels: string[];
  frozenExperienceYears: string[];
  frozenStates: string[];
  locationIsRemote?: boolean | null;
  excludeStudentEscape?: boolean;
  companyNames?: string[];
  /** Preferred company filter — opaque CX ids from scoutx_companies. */
  companyIds?: string[];
  h1bSponsorFriendly?: boolean;
};

export type ClusterSourceBinding = {
  mode: ClusterSourceMode;
  sources: string[];
  companyNames: string[];
  companyIds: string[];
  robotMetaIds: string[];
};

export interface ICluster extends Document {
  slug: string;
  name: string;
  description: string;
  kind: ClusterKind;
  status: ClusterStatus;
  coverImage?: string | null;
  companyLogos: string[];
  filtersSummary: string[];
  filter: ClusterFilter;
  sourceBinding: ClusterSourceBinding;
  jobCountPreview: number;
  /** Cached employer names for browse cards / search (from filter + listings). */
  companyNamesPreview?: string[];
  createdBy?: string | null;
  requestId?: Types.ObjectId | null;
  publishedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const ClusterFilterSchema = new Schema(
  {
    frozenIndustries: { type: [String], default: [] },
    frozenCategories: { type: [String], default: [] },
    frozenExperienceLevels: { type: [String], default: [] },
    frozenExperienceYears: { type: [String], default: [] },
    frozenStates: { type: [String], default: [] },
    locationIsRemote: { type: Boolean, default: null },
    excludeStudentEscape: { type: Boolean, default: true },
    companyNames: { type: [String], default: [] },
    companyIds: { type: [String], default: [] },
    h1bSponsorFriendly: { type: Boolean, default: false },
  },
  { _id: false }
);

const ClusterSourceBindingSchema = new Schema(
  {
    mode: { type: String, enum: ['filter', 'source'], default: 'filter' },
    sources: { type: [String], default: [] },
    companyNames: { type: [String], default: [] },
    companyIds: { type: [String], default: [] },
    robotMetaIds: { type: [String], default: [] },
  },
  { _id: false }
);

const ClusterSchema = new Schema(
  {
    slug: { type: String, required: true, unique: true, index: true, trim: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    kind: { type: String, enum: ['curated', 'custom'], required: true, index: true },
    status: {
      type: String,
      enum: ['draft', 'published', 'archived'],
      default: 'draft',
      index: true,
    },
    coverImage: { type: String, default: null },
    companyLogos: { type: [String], default: [] },
    filtersSummary: { type: [String], default: [] },
    filter: { type: ClusterFilterSchema, default: () => ({}) },
    sourceBinding: { type: ClusterSourceBindingSchema, default: () => ({ mode: 'filter' }) },
    jobCountPreview: { type: Number, default: 0 },
    companyNamesPreview: { type: [String], default: [] },
    createdBy: { type: String, default: null },
    requestId: { type: Schema.Types.ObjectId, ref: 'ClusterRequest', default: null },
    publishedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    collection: 'scoutx_clusters',
  }
);

ClusterSchema.index({ status: 1, kind: 1 });
ClusterSchema.index({ status: 1, name: 1 });

ClusterSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret: Record<string, unknown>) => {
    ret.id = String(ret._id);
    delete ret._id;
  },
});

const Cluster =
  mongoose.models.Cluster || mongoose.model<ICluster>('Cluster', ClusterSchema);

export type { ClusterWindow };
export default Cluster;
