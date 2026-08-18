import { resolveEffectiveScheduleState } from '../services/automationScheduler';

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

export interface RecordingsSummary {
  total: number;
  succeeded: number;
  failed: number;
  scheduled: number;
  idle: number;
}

const CRON_LABELS: Record<string, string> = {
  '*/15 * * * *': 'Every 15 minutes',
  '*/30 * * * *': 'Every 30 minutes',
  '0 * * * *': 'Every hour',
  '0 */6 * * *': 'Every 6 hours',
  '0 */12 * * *': 'Every 12 hours',
  '0 0 * * *': 'Every day',
  '0 0 */2 * *': 'Every 2 days',
  '0 0 */3 * *': 'Every 3 days',
  '0 0 * * 1': 'Every week',
  '0 0 1 * *': 'Every month',
};

export function humanizeCronLabel(cron: string | null | undefined): string {
  const normalized = String(cron || '').trim().replace(/\s+/g, ' ');
  if (!normalized) return 'Off';
  return CRON_LABELS[normalized] || normalized;
}

export function formatScheduleLabel(
  schedule: { enabled?: boolean; cron?: string | null; every?: number } | null | undefined
): string {
  if (!schedule?.enabled) {
    if (schedule?.cron && String(schedule.cron).trim()) return humanizeCronLabel(schedule.cron);
    return 'Off';
  }
  if (schedule.cron && String(schedule.cron).trim()) {
    return humanizeCronLabel(schedule.cron);
  }
  if (schedule.every) return `every ${schedule.every}ms`;
  return 'Off';
}

export function classifyLastRunStatus(status: string | null | undefined): 'succeeded' | 'failed' | 'active' | 'idle' {
  const s = String(status || '').toLowerCase();
  if (s === 'success' || s === 'completed' || s === 'done') return 'succeeded';
  if (s === 'failed' || s === 'error' || s === 'aborted' || s === 'dead') return 'failed';
  if (s === 'running' || s === 'queued' || s === 'scheduled' || s === 'pending') return 'active';
  return 'idle';
}

export function buildRecordingsSummary(
  robots: Array<{ schedule?: RobotListSchedule; lastRun?: RobotListSummary['lastRun'] | null }>,
  total: number
): RecordingsSummary {
  let succeeded = 0;
  let failed = 0;
  let scheduled = 0;
  let idle = 0;

  for (const robot of robots) {
    if (robot.schedule?.enabled) scheduled += 1;
    const bucket = classifyLastRunStatus(robot.lastRun?.status);
    if (bucket === 'succeeded') succeeded += 1;
    else if (bucket === 'failed') failed += 1;
    else if (bucket === 'idle') idle += 1;
  }

  return { total, succeeded, failed, scheduled, idle };
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

function resolveScheduleFields(
  robot: any,
  effective: ReturnType<typeof resolveEffectiveScheduleState>
): RobotListSchedule {
  const enabled = !!effective?.enabled && !!(effective.cron || effective.every);
  const cron =
    effective?.cron && String(effective.cron).trim()
      ? String(effective.cron).trim()
      : null;
  return {
    enabled,
    cron,
    label: formatScheduleLabel(
      enabled ? effective : cron ? { enabled: false, cron } : { enabled: false }
    ),
  };
}

export function buildRobotListSummary(
  robot: any,
  latestRun: { status: string; startedAt?: string | null; finishedAt?: string | null } | null
): RobotListSummary {
  const meta = robot?.recording_meta || {};
  const effective = resolveEffectiveScheduleState(robot);
  return {
    id: String(meta.id || ''),
    name: String(meta.name || ''),
    type: normalizeType(meta.type),
    url: typeof meta.url === 'string' ? meta.url : null,
    updatedAt: String(meta.updatedAt || meta.createdAt || ''),
    params: Array.isArray(meta.params) ? meta.params : [],
    schedule: resolveScheduleFields(robot, effective),
    lastRun: latestRun
      ? {
          status: latestRun.status,
          startedAt: latestRun.startedAt ?? null,
          finishedAt: latestRun.finishedAt ?? null,
        }
      : null,
  };
}
