import mongoose, { Document, Schema } from 'mongoose';

export interface IScrapeProfile extends Document {
  tier: number;
  successes: number;
  failures: number;
  lastSuccessAt: Date | null;
  avgCost: number;
  updatedAt: Date;
}

const ScrapeProfileSchema: Schema = new Schema(
  {
    _id: { type: String, required: true },
    tier: { type: Number, default: 1, min: 1, max: 3 },
    successes: { type: Number, default: 0 },
    failures: { type: Number, default: 0 },
    lastSuccessAt: { type: Date, default: null },
    avgCost: { type: Number, default: 1 },
  },
  {
    timestamps: { createdAt: false, updatedAt: true },
    collection: 'maxun_scrape_profiles',
  }
);

const ScrapeProfile =
  mongoose.models.ScrapeProfile || mongoose.model<IScrapeProfile>('ScrapeProfile', ScrapeProfileSchema);

export default ScrapeProfile;
