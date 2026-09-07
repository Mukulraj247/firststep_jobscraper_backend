import mongoose, { Document, Schema } from 'mongoose';

/**
 * Lean FY2026-only employer role index (certified filings).
 * Separate from 7yr h1b_gov_employers — used for job-level title match.
 */
export interface IFy2026GovRole extends Document {
  govEmployerKey: string;
  employerNameDisplay: string;
  employerNameNormalized: string;
  certifiedCount: number;
  totalFilings: number;
  topJobTitles: Array<{ title: string; n: number }>;
  topSocCodes: Array<{ code: string; title: string; n: number }>;
  topStates: Array<{ state: string; n: number }>;
  dataAsOf: Date | null;
  sourceLabel: string;
  createdAt: Date;
  updatedAt: Date;
}

const TopTitleSchema = new Schema(
  { title: { type: String, default: '' }, n: { type: Number, default: 0 } },
  { _id: false }
);
const TopSocSchema = new Schema(
  {
    code: { type: String, default: '' },
    title: { type: String, default: '' },
    n: { type: Number, default: 0 },
  },
  { _id: false }
);
const TopStateSchema = new Schema(
  { state: { type: String, default: '' }, n: { type: Number, default: 0 } },
  { _id: false }
);

const Fy2026GovRoleSchema = new Schema<IFy2026GovRole>(
  {
    govEmployerKey: { type: String, required: true, unique: true },
    employerNameDisplay: { type: String, default: '' },
    employerNameNormalized: { type: String, default: '', index: true },
    certifiedCount: { type: Number, default: 0, index: true },
    totalFilings: { type: Number, default: 0 },
    topJobTitles: { type: [TopTitleSchema], default: [] },
    topSocCodes: { type: [TopSocSchema], default: [] },
    topStates: { type: [TopStateSchema], default: [] },
    dataAsOf: { type: Date, default: null },
    sourceLabel: { type: String, default: 'FY2026_Q3' },
  },
  {
    timestamps: true,
    collection: 'h1b_fy2026_gov_roles',
  }
);

const Fy2026GovRole =
  mongoose.models.Fy2026GovRole ||
  mongoose.model<IFy2026GovRole>('Fy2026GovRole', Fy2026GovRoleSchema);

export default Fy2026GovRole;
