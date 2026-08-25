import mongoose, { Document, Schema } from 'mongoose';

export type JobBoardStatus = 'queued' | 'enriching' | 'ready' | 'partial' | 'failed' | 'expired';

export type EnrichmentMethod = 'list' | 'ats' | 'scrape.do' | 'browser' | 'llm' | 'none';

export interface IJobBoardListSnapshot {
  jobTitle?: string;
  companyName?: string;
  jobDescription?: string;
  jobCategory?: string;
  location?: string;
  salaryRange?: string;
  employmentType?: string;
  remoteType?: string;
  jobExperience?: number;
  sectorIndustry?: string;
  f500?: string;
  date?: Date | string | null;
  about?: string;
  companyLogoUrl?: string;
  skills?: string[];
  responsibilities?: string[];
  minimumQualifications?: string[];
  preferredQualifications?: string[];
  benefits?: string[];
  certifications?: string[];
  seniorityLevel?: string;
  roleType?: string;
  educationRequirement?: string;
  visaSponsorship?: string;
  companyEmployeeCount?: number;
  companyFoundedYear?: number;
}

export interface IJobBoardEnrichment {
  method: EnrichmentMethod;
  tier: number;
  attempts: number;
  creditsSpent: number;
  lastError?: string;
  lastEnrichedAt?: Date | null;
  nextAttemptAt?: Date | null;
  llmModel?: string;
  llmInputHash?: string;
  llmTokens?: number;
}

export interface IJobBoardListing extends Document {
  jobUrlKey: string;
  jobUrl: string;
  applyUrl: string;
  ownerId: string;
  robotMetaIds: string[];
  runIds: string[];
  jobId: string;
  jobTitle: string;
  companyName: string;
  jobDescription: string;
  descriptionSnippet: string;
  jobCategory: string;
  location: string;
  salaryRange: string;
  employmentType: string;
  remoteType: string;
  jobExperience: number;
  sectorIndustry: string;
  f500: string;
  date: Date | null;
  companyLogoUrl: string;
  about: string;
  minimumQualifications: string[];
  preferredQualifications: string[];
  responsibilities: string[];
  benefits: string[];
  skills: string[];
  certifications: string[];
  seniorityLevel: string;
  roleType: string;
  educationRequirement: string;
  visaSponsorship: string;
  companyEmployeeCount: number;
  companyFoundedYear: number;
  status: JobBoardStatus;
  priority: number;
  leaseUntil: Date | null;
  claimedBy: string | null;
  contentHash: string;
  listSnapshot: IJobBoardListSnapshot;
  enrichment: IJobBoardEnrichment;
  /** Origin of the listing, e.g. hiring_cafe for Aggregators. Empty for company scrapers. */
  source: string;
  createdAt: Date;
  updatedAt: Date;
  lastSeenAt: Date;
}

const ListSnapshotSchema = new Schema(
  {
    jobTitle: { type: String, default: '' },
    companyName: { type: String, default: '' },
    jobDescription: { type: String, default: '' },
    jobCategory: { type: String, default: '' },
    location: { type: String, default: '' },
    salaryRange: { type: String, default: '' },
    employmentType: { type: String, default: '' },
    remoteType: { type: String, default: '' },
    jobExperience: { type: Number, default: 0 },
    sectorIndustry: { type: String, default: '' },
    f500: { type: String, default: '' },
    date: { type: Date, default: null },
    about: { type: String, default: '' },
    companyLogoUrl: { type: String, default: '' },
    skills: { type: [String], default: [] },
    responsibilities: { type: [String], default: [] },
    minimumQualifications: { type: [String], default: [] },
    preferredQualifications: { type: [String], default: [] },
    benefits: { type: [String], default: [] },
    certifications: { type: [String], default: [] },
    seniorityLevel: { type: String, default: '' },
    roleType: { type: String, default: '' },
    educationRequirement: { type: String, default: '' },
    visaSponsorship: { type: String, default: '' },
    companyEmployeeCount: { type: Number, default: 0 },
    companyFoundedYear: { type: Number, default: 0 },
  },
  { _id: false }
);

const EnrichmentSchema = new Schema(
  {
    method: {
      type: String,
      enum: ['list', 'ats', 'scrape.do', 'browser', 'llm', 'none'],
      default: 'none',
    },
    tier: { type: Number, default: 0 },
    attempts: { type: Number, default: 0 },
    creditsSpent: { type: Number, default: 0 },
    lastError: { type: String, default: '' },
    lastEnrichedAt: { type: Date, default: null },
    nextAttemptAt: { type: Date, default: null },
    llmModel: { type: String, default: '' },
    llmInputHash: { type: String, default: '' },
    llmTokens: { type: Number, default: 0 },
  },
  { _id: false }
);

const JobBoardListingSchema: Schema = new Schema(
  {
    jobUrlKey: { type: String, required: true },
    jobUrl: { type: String, required: true },
    applyUrl: { type: String, default: '' },
    ownerId: { type: String, required: true, index: true },
    robotMetaIds: { type: [String], default: [] },
    runIds: { type: [String], default: [] },
    jobId: { type: String, default: '' },
    jobTitle: { type: String, default: '' },
    companyName: { type: String, default: '' },
    jobDescription: { type: String, default: '' },
    descriptionSnippet: { type: String, default: '' },
    jobCategory: { type: String, default: '' },
    location: { type: String, default: '' },
    salaryRange: { type: String, default: '' },
    employmentType: { type: String, default: '' },
    remoteType: { type: String, default: '' },
    jobExperience: { type: Number, default: 0 },
    sectorIndustry: { type: String, default: '' },
    f500: { type: String, default: '' },
    date: { type: Date, default: null },
    companyLogoUrl: { type: String, default: '' },
    about: { type: String, default: '' },
    minimumQualifications: { type: [String], default: [] },
    preferredQualifications: { type: [String], default: [] },
    responsibilities: { type: [String], default: [] },
    benefits: { type: [String], default: [] },
    skills: { type: [String], default: [] },
    certifications: { type: [String], default: [] },
    seniorityLevel: { type: String, default: '' },
    roleType: { type: String, default: '' },
    educationRequirement: { type: String, default: '' },
    visaSponsorship: { type: String, default: '' },
    companyEmployeeCount: { type: Number, default: 0 },
    companyFoundedYear: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ['queued', 'enriching', 'ready', 'partial', 'failed', 'expired'],
      default: 'queued',
      index: true,
    },
    priority: { type: Number, default: 0 },
    leaseUntil: { type: Date, default: null },
    claimedBy: { type: String, default: null },
    contentHash: { type: String, default: '' },
    listSnapshot: { type: ListSnapshotSchema, default: () => ({}) },
    enrichment: { type: EnrichmentSchema, default: () => ({}) },
    source: { type: String, default: '', index: true },
    lastSeenAt: { type: Date, default: () => new Date() },
  },
  {
    timestamps: true,
    collection: 'maxun_job_board',
  }
);

JobBoardListingSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = ret._id;
    delete ret._id;
  },
});

JobBoardListingSchema.index({ jobUrlKey: 1 }, { unique: true, name: 'job_board_url_key_uidx' });
JobBoardListingSchema.index({ ownerId: 1, status: 1, date: -1 }, { name: 'job_board_owner_status_date_idx' });
JobBoardListingSchema.index({ ownerId: 1, companyName: 1 }, { name: 'job_board_owner_company_idx' });
JobBoardListingSchema.index({ ownerId: 1, jobCategory: 1 }, { name: 'job_board_owner_category_idx' });
JobBoardListingSchema.index({ ownerId: 1, source: 1, date: -1 }, { name: 'job_board_owner_source_date_idx' });
JobBoardListingSchema.index(
  { status: 1, priority: -1, createdAt: 1 },
  { name: 'job_board_claim_scan_idx' }
);
JobBoardListingSchema.index({ status: 1, leaseUntil: 1 }, { name: 'job_board_lease_idx' });
JobBoardListingSchema.index({ lastSeenAt: 1 }, { name: 'job_board_last_seen_at_idx' });
JobBoardListingSchema.index(
  { jobTitle: 'text', companyName: 'text', location: 'text' },
  { name: 'job_board_text_idx', weights: { jobTitle: 10, companyName: 5, location: 2 } }
);

const JobBoardListing =
  mongoose.models.JobBoardListing ||
  mongoose.model<IJobBoardListing>('JobBoardListing', JobBoardListingSchema);

export default JobBoardListing;
