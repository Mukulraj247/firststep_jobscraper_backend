import mongoose, { Document, Schema, Types } from 'mongoose';

export type H1bCompanyScore = 'high' | 'medium' | 'low' | 'unknown';

export type Fy2026ProfileBlock = {
  certifiedCount: number;
  topJobTitles: Array<{ title: string; n: number }>;
  topSocCodes: Array<{ code: string; title: string; n: number }>;
  topStates: Array<{ state: string; n: number }>;
  dataAsOf: Date | null;
  sourceLabel: string;
};

export interface ISponsorshipProfile extends Document {
  brandId: Types.ObjectId;
  brandName: string;
  brandNameKey: string;
  companyScore: H1bCompanyScore;
  filingCount7yr: number;
  certifiedCount: number;
  certifiedRate: number;
  yearsActiveCount: number;
  lastFilingYear: number;
  capExempt: boolean;
  topSocCodes: Array<{ code: string; title: string; n: number }>;
  topJobTitles: Array<{ title: string; n: number }>;
  govEmployerKeys: string[];
  dataAsOf: Date | null;
  /** FY2026-only certified role index for job-level title match. */
  fy2026: Fy2026ProfileBlock;
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

const Fy2026BlockSchema = new Schema(
  {
    certifiedCount: { type: Number, default: 0 },
    topJobTitles: { type: [TopTitleSchema], default: [] },
    topSocCodes: { type: [TopSocSchema], default: [] },
    topStates: { type: [TopStateSchema], default: [] },
    dataAsOf: { type: Date, default: null },
    sourceLabel: { type: String, default: '' },
  },
  { _id: false }
);

const SponsorshipProfileSchema = new Schema<ISponsorshipProfile>(
  {
    brandId: { type: Schema.Types.ObjectId, ref: 'CompanyBrand', required: true },
    brandName: { type: String, required: true },
    brandNameKey: { type: String, required: true, unique: true },
    companyScore: {
      type: String,
      enum: ['high', 'medium', 'low', 'unknown'],
      default: 'unknown',
      index: true,
    },
    filingCount7yr: { type: Number, default: 0 },
    certifiedCount: { type: Number, default: 0 },
    certifiedRate: { type: Number, default: 0 },
    yearsActiveCount: { type: Number, default: 0 },
    lastFilingYear: { type: Number, default: 0 },
    capExempt: { type: Boolean, default: false },
    topSocCodes: { type: [TopSocSchema], default: [] },
    topJobTitles: { type: [TopTitleSchema], default: [] },
    govEmployerKeys: { type: [String], default: [] },
    dataAsOf: { type: Date, default: null },
    fy2026: {
      type: Fy2026BlockSchema,
      default: () => ({
        certifiedCount: 0,
        topJobTitles: [],
        topSocCodes: [],
        topStates: [],
        dataAsOf: null,
        sourceLabel: '',
      }),
    },
  },
  {
    timestamps: true,
    collection: 'h1b_sponsorship_profiles',
  }
);

const SponsorshipProfile =
  mongoose.models.SponsorshipProfile ||
  mongoose.model<ISponsorshipProfile>('SponsorshipProfile', SponsorshipProfileSchema);

export default SponsorshipProfile;
