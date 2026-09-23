export const SIDEBAR_NAV_VALUES = [
  'dashboard',
  'automations',
  'clusters',
  'portal-users',
  'reports',
  'jobs',
  'scrapers',
  'runs',
  'failures',
  'enrichment',
  'category-qa',
  'h1b',
  'communication',
  'aggregators',
  'proxy',
] as const;

/** Always-visible primary items in the ops rail. */
export const SIDEBAR_PRIMARY_VALUES = [
  'dashboard',
  'automations',
  'clusters',
  'portal-users',
  'reports',
] as const;

/** Collapsed under “More” to keep the rail uncluttered. */
export const SIDEBAR_MORE_VALUES = [
  'jobs',
  'scrapers',
  'runs',
  'failures',
  'enrichment',
  'category-qa',
  'h1b',
  'communication',
  'aggregators',
  'proxy',
] as const;

export type SidebarNavValue = (typeof SIDEBAR_NAV_VALUES)[number];
