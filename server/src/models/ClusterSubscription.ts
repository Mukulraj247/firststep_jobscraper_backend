import mongoose, { Document, Schema, Types } from 'mongoose';
import type { ClusterWindow } from '../services/clusterEntitlements';

export type ClusterSubscriptionStatus = 'active' | 'paused';

/**
 * How the subscription was created:
 * - self_serve: user browse/checkout — counts against plan-included slots
 * - request_fulfillment: ops published a user request (First Step add-on) — does not use included slots
 * - admin_assigned: ops assigned after purchase — does not use included slots
 */
export type ClusterSubscriptionSource =
  | 'self_serve'
  | 'request_fulfillment'
  | 'admin_assigned';

export interface IClusterSubscription extends Document {
  auth0Sub: string;
  clusterId: Types.ObjectId;
  window: ClusterWindow;
  status: ClusterSubscriptionStatus;
  source: ClusterSubscriptionSource;
  lastViewedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const ClusterSubscriptionSchema = new Schema(
  {
    auth0Sub: { type: String, required: true, index: true },
    clusterId: {
      type: Schema.Types.ObjectId,
      ref: 'Cluster',
      required: true,
      index: true,
    },
    window: {
      type: String,
      enum: ['1h', '12h', '24h'],
      required: true,
      default: '24h',
    },
    status: {
      type: String,
      enum: ['active', 'paused'],
      default: 'active',
      index: true,
    },
    source: {
      type: String,
      enum: ['self_serve', 'request_fulfillment', 'admin_assigned'],
      default: 'self_serve',
      index: true,
    },
    lastViewedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    collection: 'scoutx_cluster_subscriptions',
  }
);

ClusterSubscriptionSchema.index({ auth0Sub: 1, clusterId: 1 }, { unique: true });
ClusterSubscriptionSchema.index({ auth0Sub: 1, status: 1 });

ClusterSubscriptionSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret: Record<string, unknown>) => {
    ret.id = String(ret._id);
    delete ret._id;
    if (ret.clusterId) ret.clusterId = String(ret.clusterId);
  },
});

const ClusterSubscription =
  mongoose.models.ClusterSubscription ||
  mongoose.model<IClusterSubscription>('ClusterSubscription', ClusterSubscriptionSchema);

export default ClusterSubscription;

/** Plan-included slots only count self-serve activations. */
export function isIncludedSlotSource(source: string | null | undefined): boolean {
  return !source || source === 'self_serve';
}
