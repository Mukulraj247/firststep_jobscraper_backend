export type DeliveryFrequency = '1h' | '2h' | '24h';

export type ClusterPlan = {
  id: string;
  name: string;
  priceMonthly: number;
  maxSubscriptions: number;
  deliveryOptions: readonly DeliveryFrequency[];
  features: string[];
};

export type Cluster = {
  id: string;
  slug: string;
  name: string;
  description: string;
  kind: 'curated' | 'custom';
  status: 'published';
  coverImage?: string;
  companyLogos?: string[];
  filtersSummary: string[];
  jobCountPreview: number;
  plans: ClusterPlan[];
};

export type ClusterSubscription = {
  id: string;
  clusterId: string;
  clusterName: string;
  planId: string;
  frequency: DeliveryFrequency;
  status: 'active' | 'paused' | 'pending';
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
  h1bEligible?: boolean;
  h1bFy2026Match?: boolean;
  saved?: boolean;
};

export type ClusterRequest = {
  id: string;
  title: string;
  industries: string[];
  locations: string[];
  roles: string[];
  experienceMin?: number;
  experienceMax?: number;
  companies?: string[];
  notes?: string;
  status: 'submitted' | 'in_review' | 'published' | 'rejected';
  submittedAt: string;
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
  '2h': 2 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
};

export const FREQUENCY_LABEL: Record<DeliveryFrequency, string> = {
  '1h': '1 hour',
  '2h': '2 hours',
  '24h': '24 hours',
};
