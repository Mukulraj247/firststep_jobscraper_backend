import { resolveEffectiveScheduleState } from '../services/automationScheduler';

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

export function formatScheduleLabel(
  schedule: { enabled?: boolean; cron?: string; every?: number } | null | undefined
): string {
  if (!schedule?.enabled) return 'Off';
  if (schedule.cron && String(schedule.cron).trim()) return String(schedule.cron).trim();
  if (schedule.every) return `every ${schedule.every}ms`;
  return 'Off';
}

export function pickLatestRun(
  runs: Array<{ status: string; startedAt?: string | null; finishedAt?: string | null; _id?: any }>
): { status: string; startedAt: string | null; finishedAt: string | null } | null {
  if (!runs?.length) return null;
  const sorted = [...runs].sort((a, b) => {
    const ta = Date.parse(String(a.startedAt || '')) || 0;
    const tb = Date.parse(String(b.startedAt || '')) || 0;
    if (tb !== ta) return tb - ta;
    return String(b._id || '').localeCompare(String(a._id || ''));
  });
  const top = sorted[0];
  return {
    status: top.status,
    startedAt: top.startedAt ?? null,
    finishedAt: top.finishedAt ?? null,
  };
}

function normalizeType(raw: unknown): RobotListType {
  if (raw === 'scrape' || raw === 'crawl' || raw === 'search') return raw;
  return 'extract';
}

export function buildRobotListSummary(
  robot: any,
  latestRun: { status: string; startedAt?: string | null; finishedAt?: string | null } | null
): RobotListSummary {
  const meta = robot?.recording_meta || {};
  const effective = resolveEffectiveScheduleState(robot);
  const enabled = !!effective?.enabled && !!(effective.cron || effective.every);
  return {
    id: String(meta.id || ''),
    name: String(meta.name || ''),
    type: normalizeType(meta.type),
    url: typeof meta.url === 'string' ? meta.url : null,
    updatedAt: String(meta.updatedAt || meta.createdAt || ''),
    params: Array.isArray(meta.params) ? meta.params : [],
    schedule: {
      enabled,
      label: formatScheduleLabel(enabled ? effective : { enabled: false }),
    },
    lastRun: latestRun
      ? {
          status: latestRun.status,
          startedAt: latestRun.startedAt ?? null,
          finishedAt: latestRun.finishedAt ?? null,
        }
      : null,
  };
}
