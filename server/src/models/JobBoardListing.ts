import mongoose, { Document, Schema } from 'mongoose';

export type JobBoardStatus =
  | 'queued'
  | 'enriching'
  | 'ready'
  | 'partial'
  | 'failed'
  | 'expired'
  /** Career free-path miss — parked for a future paid enricher; not claimed by active workers. */
  | 'deferred';

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
  /** Employer homepage from aggregator (e.g. code.org) — not the apply URL. */
  companyWebsite?: string;
  /** Hiring Cafe /job/{slug} used for light HTML re-fetch; never an employer URL. */
  aggregatorPostingUrl?: string;
}

export interface IJobBoardEnrichment {
  method: EnrichmentMethod;
  tier: number;
  attempts: number;
  creditsSpent: number;
  lastError?: string;
  lastEnrichedAt?: Date | null;
  nextAttemptAt?: Date | null;
  /** True when parked in deferred awaiting scrape.do / paid path later. */
  needsPaidPath?: boolean;
  llmModel?: string;
  llmInputHash?: string;
  llmTokens?: number;
}

export interface IJobBoardCategoryClassification {
  method: 'rules' | 'rules+ml';
  rulesVersion: string;
  classifierVersion: string;
  classifiedAt?: Date | null;
  contentHash: string;
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
  companyWebsite: string;
  aggregatorPostingUrl: string;
  status: JobBoardStatus;
  priority: number;
  leaseUntil: Date | null;
  claimedBy: string | null;
  contentHash: string;
  /** Up to 2 frozen categories from job-tagger sidecar. */
  frozenCategories: string[];
  categoryClassification?: IJobBoardCategoryClassification;
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
    companyWebsite: { type: String, default: '' },
    aggregatorPostingUrl: { type: String, default: '' },
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
    needsPaidPath: { type: Boolean, default: false },
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
    companyWebsite: { type: String, default: '' },
    aggregatorPostingUrl: { type: String, default: '' },
    status: {
      type: String,
      enum: ['queued', 'enriching', 'ready', 'partial', 'failed', 'expired', 'deferred'],
      default: 'queued',
      index: true,
    },
    priority: { type: Number, default: 0 },
    leaseUntil: { type: Date, default: null },
    claimedBy: { type: String, default: null },
    contentHash: { type: String, default: '' },
    frozenCategories: { type: [String], default: [] },
    categoryClassification: {
      method: { type: String, enum: ['rules', 'rules+ml'], default: 'rules' },
      rulesVersion: { type: String, default: '' },
      classifierVersion: { type: String, default: '' },
      classifiedAt: { type: Date, default: null },
      contentHash: { type: String, default: '' },
    },
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
// Multikey over frozenCategories — serves both the board `$in` filter and the
// facet unwind. frozenCategories is the only array in the key, so Mongo allows it.
JobBoardListingSchema.index(
  { ownerId: 1, status: 1, frozenCategories: 1 },
  { name: 'job_board_owner_status_frozen_category_idx' }
);
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
