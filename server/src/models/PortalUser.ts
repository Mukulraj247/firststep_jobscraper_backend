import mongoose, { Document, Schema } from 'mongoose';
import type { ScoutXRole } from '../services/scoutxAuth0';

export type FirstStepPlanSnapshot = {
  subscriptionType: string | null;
  isActive: boolean | null;
  status: string | null;
  fetchedAt: Date;
  error?: string | null;
};

export interface IPortalUser extends Document {
  auth0Sub: string;
  email: string;
  name?: string | null;
  scoutxRoles: ScoutXRole[];
  firstStepRole?: string | null;
  firstStepPlan?: FirstStepPlanSnapshot | null;
}

const FirstStepPlanSchema = new Schema(
  {
    subscriptionType: { type: String, default: null },
    isActive: { type: Boolean, default: null },
    status: { type: String, default: null },
    fetchedAt: { type: Date, required: true },
    error: { type: String, default: null },
  },
  { _id: false }
);

const PortalUserSchema = new Schema(
  {
    auth0Sub: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    email: {
      type: String,
      required: true,
      index: true,
    },
    name: { type: String, default: null },
    scoutxRoles: { type: [String], default: [] },
    firstStepRole: { type: String, default: null },
    firstStepPlan: { type: FirstStepPlanSchema, default: null },
  },
  {
    timestamps: true,
    collection: 'scoutx_portal_users',
  }
);

PortalUserSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret: Record<string, unknown>) => {
    ret.id = ret._id;
    delete ret._id;
  },
});

const PortalUser =
  mongoose.models.PortalUser || mongoose.model<IPortalUser>('PortalUser', PortalUserSchema);

export default PortalUser;
