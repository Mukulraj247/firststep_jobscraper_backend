export type RobotListType = 'extract' | 'scrape' | 'crawl' | 'search';

export interface RobotListSummary {
  id: string;
  name: string;
  type: RobotListType;
  url: string | null;
  updatedAt: string;
  params: string[];
  schedule: { enabled: boolean; label: string };
  lastRun: { status: string; startedAt: string | null; finishedAt: string | null } | null;
}

export interface RobotListResponse {
  robots: RobotListSummary[];
  total: number;
  page: number;
  limit: number;
}
