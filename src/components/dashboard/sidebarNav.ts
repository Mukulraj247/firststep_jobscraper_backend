export const SIDEBAR_NAV_VALUES = [
  'dashboard',
  'automations',
  'jobs',
  'scrapers',
  'runs',
  'failures',
  'communication',
  'aggregators',
  'proxy',
] as const;

export type SidebarNavValue = (typeof SIDEBAR_NAV_VALUES)[number];
