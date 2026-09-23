import mongoose, { Document, Schema } from 'mongoose';

export type CompanyNameSource =
  | 'ops'
  | 'automation'
  | 'ats_hint'
  | 'aggregator'
  | 'derived';

export interface ICompany extends Document {
  /** Public opaque ID: CX-A1B2C3D4 */
  companyId: string;
  /** Stable identity key: apple.com | workday:hpe */
  companyKey: string;
  displayName: string;
  nameSource: CompanyNameSource;
  namePrecedence: number;
  aliases: string[];
  hosts: string[];
  atsProviders: string[];
  /** When this key is a sibling of another company, point at the canonical companyKey. */
  mergedInto: string;
  jobCount: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const CompanySchema = new Schema(
  {
    companyId: { type: String, required: true, unique: true, index: true, trim: true },
    companyKey: { type: String, required: true, unique: true, index: true, trim: true },
    displayName: { type: String, required: true, trim: true },
    nameSource: {
      type: String,
      enum: ['ops', 'automation', 'ats_hint', 'aggregator', 'derived'],
      default: 'derived',
    },
    namePrecedence: { type: Number, default: 1 },
    aliases: { type: [String], default: [] },
    hosts: { type: [String], default: [] },
    atsProviders: { type: [String], default: [] },
    mergedInto: { type: String, default: '', index: true },
    jobCount: { type: Number, default: 0 },
    firstSeenAt: { type: Date, default: () => new Date() },
    lastSeenAt: { type: Date, default: () => new Date() },
  },
  {
    timestamps: true,
    collection: 'scoutx_companies',
  }
);

CompanySchema.index({ displayName: 1 });

CompanySchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc: unknown, ret: any) => {
    ret.id = String(ret._id);
    delete ret._id;
  },
});

const Company =
  mongoose.models.Company || mongoose.model<ICompany>('Company', CompanySchema);

export default Company;
