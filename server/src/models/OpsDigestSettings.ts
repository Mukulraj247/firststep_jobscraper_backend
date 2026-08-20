import mongoose, { Schema } from 'mongoose';

/** Singleton ops-digest recipient list (editable from Communication UI). */
export type OpsDigestSettingsDoc = {
  _id: string;
  recipients: string[];
  updatedAt?: Date;
};

const OpsDigestSettingsSchema = new Schema(
  {
    _id: { type: String, required: true },
    recipients: { type: [String], default: [] },
  },
  {
    timestamps: { createdAt: false, updatedAt: true },
    collection: 'maxun_ops_digest_settings',
  }
);

const OpsDigestSettings =
  mongoose.models.OpsDigestSettings ||
  mongoose.model<OpsDigestSettingsDoc>('OpsDigestSettings', OpsDigestSettingsSchema);

export const OPS_DIGEST_SETTINGS_ID = 'default';

export default OpsDigestSettings;
