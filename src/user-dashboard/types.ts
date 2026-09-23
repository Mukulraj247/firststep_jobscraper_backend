export type DeliveryFrequency = '1h' | '12h' | '24h';

export type ClusterPlan = {
  id: string;
  name: string;
  priceMonthly: number;
  maxSubscriptions: number;
  deliveryOptions: readonly DeliveryFrequency[];
  features: string[];
};

export type ClusterFilter = {
  frozenIndustries?: string[];
  frozenCategories?: string[];
  frozenExperienceLevels?: string[];
  frozenExperienceYears?: string[];
  frozenStates?: string[];
  locationIsRemote?: boolean | null;
  excludeStudentEscape?: boolean;
  companyNames?: string[];
  h1bSponsorFriendly?: boolean;
};

export type Cluster = {
  id: string;
  slug: string;
  name: string;
  description: string;
  kind: 'curated' | 'custom';
  status: 'published' | 'draft' | 'archived';
  coverImage?: string;
  companyLogos?: string[];
  /** Employers included in this cluster (for cards + search). */
  includedCompanies?: string[];
  /** Bound career-page URLs from sourceBinding.sources (preferred on browse cards). */
  careerPageUrls?: string[];
  filtersSummary: string[];
  jobCountPreview: number;
  plans: ClusterPlan[];
  filter?: ClusterFilter;
};

export type ClusterSubscription = {
  id: string;
  clusterId: string;
  clusterName: string;
  planId: string;
  frequency: DeliveryFrequency;
  status: 'active' | 'paused' | 'pending';
  source?: 'self_serve' | 'request_fulfillment' | 'admin_assigned';
  subscribedAt: string;
  nextRefreshAt: string;
};

export type FeedJob = {
  id: string;
  clusterId: string;
  clusterName: string;
  title: string;
  company: string;
  location: string;
  jobType?: string;
  workMode?: 'Remote' | 'Hybrid' | 'Onsite';
  experience?: string;
  salary?: string;
  postedAt: string;
  lastSeenAt: string;
  applyUrl: string;
  description: string;
  logoUrl?: string;
  sectorIndustry?: string;
  jobCategory?: string;
  skills?: string[];
  h1bEligible?: boolean;
  h1bFy2026Match?: boolean;
  saved?: boolean;
  /** True once assigned to Application Incharge OD Jobs. */
  assigned?: boolean;
  jobUrlKey?: string;
};

export type FeedInsightBucket = {
  label: string;
  count: number;
};

export type FeedInsights = {
  asOf: string;
  sampleSize: number;
  companies: FeedInsightBucket[];
  categories: FeedInsightBucket[];
  skills: FeedInsightBucket[];
};

/** Home date-range control (drives insights + jobs chart). */
export type HomeAnalyticsRange = '24h' | '3d' | '7d' | '14d' | '30d' | 'plan';

export const HOME_ANALYTICS_RANGE_OPTIONS: { value: HomeAnalyticsRange; label: string }[] = [
  { value: '24h', label: 'Last 24 hours' },
  { value: '3d', label: 'Last 3 days' },
  { value: '7d', label: 'Last 7 days' },
  { value: '14d', label: 'Last 14 days' },
  { value: '30d', label: 'Last 1 month' },
  { value: 'plan', label: 'Since plan start' },
];

export type JobSeriesCluster = {
  subscriptionId: string;
  name: string;
  values: number[];
};

export type JobSeries = {
  dates: string[];
  total: number[];
  byCluster: JobSeriesCluster[];
  granularity: 'hour' | 'day' | 'week';
};

export type HomeAnalytics = {
  range: HomeAnalyticsRange;
  rangeStart: string;
  rangeEnd: string;
  feedInsights: FeedInsights;
  jobSeries: JobSeries;
};

export type ClusterRequest = {
  id: string;
  type?: 'predefined' | 'custom_urls';
  title: string;
  industries: string[];
  locations: string[];
  roles: string[];
  experienceLevels?: string[];
  experienceMin?: number;
  experienceMax?: number;
  companies?: string[];
  urls?: string[];
  notes?: string;
  status: 'submitted' | 'in_review' | 'published' | 'rejected';
  submittedAt: string;
  resultClusterId?: string;
};

export type PortalEntitlements = {
  subscriptionType: string | null;
  subscriptionTypeDisplay?: string | null;
  isActive: boolean;
  /** Effective allotment (ops or plan) used for gates. */
  maxActiveClusters: number;
  allowedWindows: DeliveryFrequency[];
  activeClusterCount: number;
  availableSlots: number;
  /** Plan-included slots (Premium Plus = 2). */
  includedSlots?: number;
  planIncludedSlots?: number;
  /** Ops allotment or plan default — UI denominator. */
  subscribedSlots?: number;
  includedActiveCount?: number;
  extraActiveCount?: number;
  source?: string;
  clusterServiceStarted?: boolean;
  clusterServiceStartedAt?: string | null;
  clusterServiceOptOut?: boolean;
  planError?: string | null;
  planFetchedAt?: string | null;
};

export type PortalUser = {
  id: string;
  name: string;
  email: string;
  persona: 'priya' | 'marcus' | 'guest';
  auth0Sub?: string;
  scoutxRoles?: string[];
  firstStepPlan?: {
    subscriptionType: string | null;
    isActive: boolean | null;
    status: string | null;
  } | null;
  firstStepRole?: string | null;
};

export type FeedFilters = {
  q?: string;
  company?: string;
  location?: string;
  role?: string;
  workMode?: string;
  experience?: string;
  h1bSponsorFriendly?: boolean;
  h1bFy2026Match?: boolean;
  sort?: 'newest';
};

export type PortalState = {
  user: PortalUser | null;
  subscriptions: ClusterSubscription[];
  savedJobIds: string[];
  requests: ClusterRequest[];
};

export const PORTAL_STORAGE_KEY = 'scouttext.portal';

export const FREQUENCY_MS: Record<DeliveryFrequency, number> = {
  '1h': 60 * 60 * 1000,
  '12h': 12 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
};

export const FREQUENCY_LABEL: Record<DeliveryFrequency, string> = {
  '1h': '1 hour',
  '12h': '12 hours',
  '24h': '24 hours',
};
