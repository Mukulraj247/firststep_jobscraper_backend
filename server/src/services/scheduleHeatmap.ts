import cronParser from 'cron-parser';
import { resolveEffectiveScheduleState } from './automationScheduler';
import { intervalMsFromCron } from '../utils/schedule';
import {
  OPS_TIME_ZONE,
  endOfIstDay,
  istHourOf,
  istMinuteOf,
  startOfIstDay,
} from '../../../src/shared/opsTimezone';

const MAX_FIRES = 10_000;

export type ScheduleHeatmapFire = {
  hour: number;
  minute: number;
  at: string;
  automationId: string;
  name: string;
  company: string;
};

export type ScheduleHeatmapHour = {
  hour: number;
  count: number;
};

export type ScheduleHeatmapResult = {
  date: string;
  timezone: string;
  hours: ScheduleHeatmapHour[];
  fires: ScheduleHeatmapFire[];
};

function readScheduleTimestamps(robot: any) {
  const root = robot?.schedule;
  const saas = robot?.recording_meta?.saasConfig?.schedule;
  const lastRaw = root?.lastRunAt ?? saas?.lastRunAt ?? null;
  const nextRaw = root?.nextRunAt ?? saas?.nextRunAt ?? null;
  return {
    lastRunAt: lastRaw != null ? new Date(lastRaw) : null,
    nextRunAt: nextRaw != null ? new Date(nextRaw) : null,
  };
}

function getRobotName(robot: any): string {
  const name = robot?.recording_meta?.name;
  return typeof name === 'string' && name.trim() ? name.trim() : 'Untitled';
}

function getCompanyName(robot: any): string {
  const meta = robot?.recording_meta || {};
  const fromMeta = typeof meta.companyName === 'string' ? meta.companyName.trim() : '';
  if (fromMeta) return fromMeta;
  const fromSaas =
    typeof meta.saasConfig?.companyName === 'string' ? meta.saasConfig.companyName.trim() : '';
  return fromSaas || '';
}

function getAutomationId(robot: any): string {
  const id = robot?.recording_meta?.id;
  return typeof id === 'string' && id.trim() ? id.trim() : String(robot?.id || robot?._id || '');
}

function listIntervalFireTimes(
  everyMs: number,
  timestamps: { lastRunAt: Date | null; nextRunAt: Date | null },
  startMs: number,
  endMs: number,
): number[] {
  if (everyMs <= 0 || startMs > endMs) return [];

  const nextMs = timestamps.nextRunAt?.getTime();
  const lastMs = timestamps.lastRunAt?.getTime();
  let ref =
    nextMs != null && Number.isFinite(nextMs)
      ? nextMs
      : lastMs != null && Number.isFinite(lastMs)
        ? lastMs
        : startMs;

  if (ref > startMs) {
    const steps = Math.ceil((ref - startMs) / everyMs);
    ref -= steps * everyMs;
  }
  while (ref < startMs) ref += everyMs;

  const out: number[] = [];
  while (ref <= endMs && out.length < MAX_FIRES) {
    out.push(ref);
    ref += everyMs;
  }
  return out;
}

function listCronFireTimes(
  cron: string,
  timezone: string,
  startMs: number,
  endMs: number,
): number[] {
  try {
    const interval = cronParser.parseExpression(cron.trim(), {
      tz: timezone || 'UTC',
      currentDate: new Date(startMs - 1),
    });
    const out: number[] = [];
    while (out.length < MAX_FIRES) {
      const next = interval.next().toDate().getTime();
      if (next > endMs) break;
      if (next >= startMs) out.push(next);
    }
    return out;
  } catch {
    return [];
  }
}

function listAutomationFireTimes(robot: any, startMs: number, endMs: number): number[] {
  const schedule = resolveEffectiveScheduleState(robot);
  if (!schedule.enabled) return [];

  const cronExpr = (schedule.cron || '').trim();
  const everyMs =
    (typeof schedule.every === 'number' && schedule.every > 0 ? schedule.every : null) ??
    intervalMsFromCron(cronExpr);

  if (everyMs) {
    return listIntervalFireTimes(everyMs, readScheduleTimestamps(robot), startMs, endMs);
  }
  if (cronExpr) {
    return listCronFireTimes(cronExpr, schedule.timezone || 'UTC', startMs, endMs);
  }
  return [];
}

export function computeScheduleHeatmap(robots: any[], dateYmd: string): ScheduleHeatmapResult {
  const startMs = startOfIstDay(dateYmd).getTime();
  const endMs = endOfIstDay(dateYmd).getTime();
  const fires: ScheduleHeatmapFire[] = [];

  for (const robot of robots) {
    const times = listAutomationFireTimes(robot, startMs, endMs);
    if (!times.length) continue;

    const automationId = getAutomationId(robot);
    const name = getRobotName(robot);
    const company = getCompanyName(robot);

    for (const atMs of times) {
      fires.push({
        hour: istHourOf(atMs),
        minute: istMinuteOf(atMs),
        at: new Date(atMs).toISOString(),
        automationId,
        name,
        company,
      });
    }
  }

  fires.sort((a, b) => {
    if (a.hour !== b.hour) return a.hour - b.hour;
    if (a.minute !== b.minute) return a.minute - b.minute;
    return (a.company || a.name).localeCompare(b.company || b.name);
  });

  const counts = Array.from({ length: 24 }, () => 0);
  for (const fire of fires) counts[fire.hour] += 1;

  return {
    date: dateYmd,
    timezone: OPS_TIME_ZONE,
    hours: counts.map((count, hour) => ({ hour, count })),
    fires,
  };
}
