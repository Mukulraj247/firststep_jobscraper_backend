import mongoose, { Document, Schema, Types } from 'mongoose';

export type ClusterActivityAction =
  | 'created'
  | 'updated'
  | 'published'
  | 'unpublished'
  | 'archived'
  | 'restored'
  | 'sources_bound'
  | 'preview_refreshed'
  | 'fulfilled_from_request'
  | 'duplicated'
  | 'deleted';

export interface IClusterActivity extends Document {
  clusterId: Types.ObjectId;
  at: Date;
  actor: string;
  action: ClusterActivityAction;
  detail?: string | null;
}

const ClusterActivitySchema = new Schema(
  {
    clusterId: { type: Schema.Types.ObjectId, ref: 'Cluster', required: true, index: true },
    at: { type: Date, default: Date.now, index: true },
    actor: { type: String, default: 'ops' },
    action: {
      type: String,
      required: true,
      enum: [
        'created',
        'updated',
        'published',
        'unpublished',
        'archived',
        'restored',
        'sources_bound',
        'preview_refreshed',
        'fulfilled_from_request',
        'duplicated',
        'deleted',
      ],
    },
    detail: { type: String, default: null },
  },
  {
    timestamps: false,
    collection: 'scoutx_cluster_activity',
  }
);

ClusterActivitySchema.index({ clusterId: 1, at: -1 });

ClusterActivitySchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret: Record<string, unknown>) => {
    ret.id = String(ret._id);
    delete ret._id;
  },
});

const ClusterActivity =
  mongoose.models.ClusterActivity ||
  mongoose.model<IClusterActivity>('ClusterActivity', ClusterActivitySchema);

export default ClusterActivity;
