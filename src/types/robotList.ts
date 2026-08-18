export type RobotListType = 'extract' | 'scrape' | 'crawl' | 'search';

export interface RobotListSchedule {
  enabled: boolean;
  cron: string | null;
  label: string;
}

export interface RobotListSummary {
  id: string;
  name: string;
  type: RobotListType;
  url: string | null;
  updatedAt: string;
  params: string[];
  schedule: RobotListSchedule;
  lastRun: { status: string; startedAt: string | null; finishedAt: string | null } | null;
}

export interface RobotListResponse {
  robots: RobotListSummary[];
  total: number;
  page: number;
  limit: number;
}

export interface RecordingsSummary {
  total: number;
  succeeded: number;
  failed: number;
  scheduled: number;
  idle: number;
}
