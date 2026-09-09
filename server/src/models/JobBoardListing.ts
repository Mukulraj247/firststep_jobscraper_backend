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
  /** HC max YOE when present. */
  jobExperienceMax?: number;
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
  /** US-looking job eligible for H-1B DOL lookup. */
  h1bEligible: boolean;
  h1bCompanyScore: 'high' | 'medium' | 'low' | 'unknown';
  h1bRoleScore: 'high' | 'medium' | 'low' | 'unknown';
  h1bCompanyConfidence: number;
  h1bRoleConfidence: number;
  h1bFilingCount: number;
  h1bLastFilingYear: number;
  h1bMatchedGovEmployer: string;
  h1bCapExempt: boolean;
  h1bDataAsOf: Date | null;
  h1bMappingStatus: 'auto' | 'approved' | 'rejected' | 'none';
  /** FY2026-only: board title matches employer certified filed title (≥0.70 Jaccard). */
  h1bFy2026Match: boolean;
  h1bFy2026TitleConfidence: number;
  h1bFy2026MatchedTitle: string;
  h1bFy2026CertifiedCount: number;
  h1bFy2026DataAsOf: Date | null;
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
  /** Controlled industry labels (career rowContext + aggregator classify). */
  frozenIndustries: string[];
  industryClassification?: {
    method: 'row_context' | 'scrape_alias' | 'aggregator_hint' | 'none';
    rulesVersion: string;
    classifiedAt?: Date | null;
    contentHash?: string;
  };
  /** Career level tags (at most one). */
  frozenExperienceLevels: string[];
  /** Year-band tags (0–2). */
  frozenExperienceYears: string[];
  experienceClassification?: {
    method: 'hc_structured' | 'scrape_badge' | 'rules' | 'title_only' | 'none';
    rulesVersion: string;
    classifiedAt?: Date | null;
    contentHash?: string;
    matchedSignals?: string[];
  };
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
    jobExperienceMax: { type: Number, default: 0 },
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
    h1bEligible: { type: Boolean, default: false, index: true },
    h1bCompanyScore: {
      type: String,
      enum: ['high', 'medium', 'low', 'unknown'],
      default: 'unknown',
      index: true,
    },
    h1bRoleScore: {
      type: String,
      enum: ['high', 'medium', 'low', 'unknown'],
      default: 'unknown',
    },
    h1bCompanyConfidence: { type: Number, default: 0 },
    h1bRoleConfidence: { type: Number, default: 0 },
    h1bFilingCount: { type: Number, default: 0 },
    h1bLastFilingYear: { type: Number, default: 0 },
    h1bMatchedGovEmployer: { type: String, default: '' },
    h1bCapExempt: { type: Boolean, default: false },
    h1bDataAsOf: { type: Date, default: null },
    h1bMappingStatus: {
      type: String,
      enum: ['auto', 'approved', 'rejected', 'none'],
      default: 'none',
    },
    h1bFy2026Match: { type: Boolean, default: false, index: true },
    h1bFy2026TitleConfidence: { type: Number, default: 0 },
    h1bFy2026MatchedTitle: { type: String, default: '' },
    h1bFy2026CertifiedCount: { type: Number, default: 0 },
    h1bFy2026DataAsOf: { type: Date, default: null },
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
    frozenIndustries: { type: [String], default: [] },
    industryClassification: {
      method: {
        type: String,
        enum: ['row_context', 'scrape_alias', 'aggregator_hint', 'none'],
        default: 'none',
      },
      rulesVersion: { type: String, default: '' },
      classifiedAt: { type: Date, default: null },
      contentHash: { type: String, default: '' },
    },
    frozenExperienceLevels: { type: [String], default: [] },
    frozenExperienceYears: { type: [String], default: [] },
    experienceClassification: {
      method: {
        type: String,
        enum: ['hc_structured', 'scrape_badge', 'rules', 'title_only', 'none'],
        default: 'none',
      },
      rulesVersion: { type: String, default: '' },
      classifiedAt: { type: Date, default: null },
      contentHash: { type: String, default: '' },
      matchedSignals: { type: [String], default: [] },
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
JobBoardListingSchema.index(
  { ownerId: 1, status: 1, frozenIndustries: 1 },
  { name: 'job_board_owner_status_frozen_industry_idx' }
);
JobBoardListingSchema.index(
  { frozenExperienceLevels: 1, lastSeenAt: -1 },
  { name: 'job_board_exp_level_last_seen_idx' }
);
JobBoardListingSchema.index(
  { frozenExperienceYears: 1, lastSeenAt: -1 },
  { name: 'job_board_exp_years_last_seen_idx' }
);
JobBoardListingSchema.index({ ownerId: 1, source: 1, date: -1 }, { name: 'job_board_owner_source_date_idx' });
JobBoardListingSchema.index(
  { ownerId: 1, status: 1, h1bEligible: 1, h1bCompanyScore: 1 },
  { name: 'job_board_owner_status_h1b_idx' }
);
JobBoardListingSchema.index(
  { ownerId: 1, status: 1, h1bFy2026Match: 1 },
  { name: 'job_board_owner_status_h1b_fy2026_idx' }
);
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
