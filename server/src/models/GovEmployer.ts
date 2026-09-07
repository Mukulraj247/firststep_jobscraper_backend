import mongoose, { Document, Schema } from 'mongoose';

export type TopCount = { title?: string; code?: string; state?: string; n: number };

export interface IGovEmployer extends Document {
  employerNameNormalized: string;
  employerNameKey: string;
  employerNameDisplay: string;
  employerNameVariants: string[];
  totalFilings: number;
  certifiedCount: number;
  deniedCount: number;
  withdrawnCount: number;
  firstFilingYear: number;
  lastFilingYear: number;
  yearsActive: number[];
  topJobTitles: Array<{ title: string; n: number }>;
  topSocCodes: Array<{ code: string; title: string; n: number }>;
  topStates: Array<{ state: string; n: number }>;
  dataAsOf: Date;
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

const GovEmployerSchema = new Schema<IGovEmployer>(
  {
    employerNameNormalized: { type: String, required: true, index: true },
    employerNameKey: { type: String, required: true, unique: true },
    employerNameDisplay: { type: String, default: '' },
    employerNameVariants: { type: [String], default: [] },
    totalFilings: { type: Number, default: 0 },
    certifiedCount: { type: Number, default: 0 },
    deniedCount: { type: Number, default: 0 },
    withdrawnCount: { type: Number, default: 0 },
    firstFilingYear: { type: Number, default: 0 },
    lastFilingYear: { type: Number, default: 0 },
    yearsActive: { type: [Number], default: [] },
    topJobTitles: { type: [TopTitleSchema], default: [] },
    topSocCodes: { type: [TopSocSchema], default: [] },
    topStates: { type: [TopStateSchema], default: [] },
    dataAsOf: { type: Date, default: null },
  },
  {
    timestamps: true,
    collection: 'h1b_gov_employers',
  }
);

GovEmployerSchema.index({ certifiedCount: -1 });
GovEmployerSchema.index({ employerNameDisplay: 1 });

const GovEmployer =
  mongoose.models.GovEmployer || mongoose.model<IGovEmployer>('GovEmployer', GovEmployerSchema);

export default GovEmployer;
