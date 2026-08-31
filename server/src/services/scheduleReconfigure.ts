import logger from '../logger';
import Robot from '../models/Robot';
import { updateScheduledTriggerNextRunAt } from '../queue/scraperQueue';
import { intervalMsFromCron, MIN_AUTOMATION_GAP_MS } from '../utils/schedule';
import { ownerIdFilter } from '../utils/ownerId';
import {
  formatIstYmd,
  istHourOf,
  istMinuteOf,
  startOfIstDay,
} from '../../../src/shared/opsTimezone';
import {
  resolveEffectiveScheduleState,
  readRobotScheduleTimestamps,
} from './automationScheduler';
import { computeScheduleHeatmap } from './scheduleHeatmap';

export const DAILY_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const MAX_FIRES_PER_HOUR = 40;
export const MAX_HOUR_SPREAD = 10;

const HOUR_MS = 60 * 60 * 1000;
const GAP_MS = MIN_AUTOMATION_GAP_MS;

export type ScheduleKind = 'daily' | 'immovable' | 'skip';

export function classifyScheduleKind(schedule: {
  enabled?: boolean;
  every?: number | null;
  cron?: string | null;
}): ScheduleKind {
  if (!schedule.enabled) return 'skip';
  const cron = (schedule.cron || '').trim();
  const everyMs =
    (typeof schedule.every === 'number' && schedule.every > 0 ? schedule.every : null) ??
    intervalMsFromCron(cron);
  if (!everyMs && !cron) return 'skip';
  if (everyMs === DAILY_INTERVAL_MS) return 'daily';
  return 'immovable';
}

export type DailyRobotInput = {
  automationId: string;
  name: string;
  company: string;
  currentHour: number | null;
  currentMinute: number | null;
  currentNextRunAt?: Date | null;
};

export type ImmovableSlot = {
  hour: number;
  minute: number;
  second?: number;
};

export type DailyAssignment = {
  automationId: string;
  name: string;
  company: string;
  hour: number;
  minute: number;
  second: number;
  nextRunAt: Date;
  lastRunAt: Date;
};

export type DailyMove = {
  automationId: string;
  name: string;
  company: string;
  fromAt: string;
  toAt: string;
};

export type DailyReconfigurePlan = {
  assignments: DailyAssignment[];
  moves: DailyMove[];
  hourCounts: Array<{ hour: number; count: number }>;
};

export function placeOffsetsInHour(count: number, occupiedMs: number[]): number[] {
  const hourLen = HOUR_MS;
  const occupied = [...occupiedMs];
  const out: number[] = [];

  for (let i = 0; i < count; i += 1) {
    let placed = -1;
    for (let t = 0; t < hourLen; t += GAP_MS) {
      if (occupied.every((offset) => Math.abs(offset - t) >= GAP_MS)) {
        placed = t;
        break;
      }
    }
    if (placed < 0) {
      for (let t = 0; t < hourLen; t += 1000) {
        if (occupied.every((offset) => Math.abs(offset - t) >= GAP_MS)) {
          placed = t;
          break;
        }
      }
    }
    if (placed < 0) placed = Math.max(0, hourLen - GAP_MS);
    out.push(placed);
    occupied.push(placed);
  }

  return out;
}

function lowestOpenHours(counts: number[]): number[] {
  let min = Infinity;
  for (let hour = 0; hour < 24; hour += 1) {
    if (counts[hour] < MAX_FIRES_PER_HOUR && counts[hour] < min) min = counts[hour];
  }
  if (min === Infinity) {
    min = Math.min(...counts);
  }
  const hours: number[] = [];
  for (let hour = 0; hour < 24; hour += 1) {
    if (counts[hour] === min && (counts[hour] < MAX_FIRES_PER_HOUR || min >= MAX_FIRES_PER_HOUR)) {
      hours.push(hour);
    }
  }
  return hours.length ? hours : [0];
}

function pickHour(currentHour: number | null, counts: number[]): number {
  const candidates = lowestOpenHours(counts);
  if (currentHour != null && candidates.includes(currentHour)) return currentHour;
  return candidates[0];
}

function nextIstOccurrence(hour: number, minute: number, second: number, now: Date): Date {
  const ymd = formatIstYmd(now.getTime());
  const todayMs =
    startOfIstDay(ymd).getTime() + hour * HOUR_MS + minute * 60_000 + second * 1000;
  if (todayMs > now.getTime()) return new Date(todayMs);
  return new Date(todayMs + DAILY_INTERVAL_MS);
}

function slotOffsetMs(slot: ImmovableSlot): number {
  return (slot.minute * 60 + (slot.second ?? 0)) * 1000;
}

export function planDailyReconfigure(opts: {
  daily: DailyRobotInput[];
  immovableSlots: ImmovableSlot[];
  now: Date;
}): DailyReconfigurePlan {
  const reserved = Array.from({ length: 24 }, () => 0);
  const occupiedByHour: number[][] = Array.from({ length: 24 }, () => []);

  for (const slot of opts.immovableSlots) {
    const hour = ((slot.hour % 24) + 24) % 24;
    reserved[hour] += 1;
    occupiedByHour[hour].push(slotOffsetMs(slot));
  }

  const counts = reserved.slice();
  const hourOf = new Map<string, number>();
  const robots = [...opts.daily].sort((a, b) => {
    const hourA = a.currentHour ?? 99;
    const hourB = b.currentHour ?? 99;
    if (hourA !== hourB) return hourA - hourB;
    return a.automationId.localeCompare(b.automationId);
  });

  for (const robot of robots) {
    const hour = pickHour(robot.currentHour, counts);
    hourOf.set(robot.automationId, hour);
    counts[hour] += 1;
  }

  const dailyById = new Map(robots.map((robot) => [robot.automationId, robot]));

  for (let guard = 0; guard < 10_000; guard += 1) {
    let maxHour = 0;
    let minHour = 0;
    for (let hour = 0; hour < 24; hour += 1) {
      if (counts[hour] > counts[maxHour]) maxHour = hour;
      if (counts[hour] < counts[minHour]) minHour = hour;
    }
    if (counts[maxHour] - counts[minHour] <= MAX_HOUR_SPREAD) break;
    if (counts[minHour] >= MAX_FIRES_PER_HOUR) break;
    const movable = robots.filter((robot) => hourOf.get(robot.automationId) === maxHour);
    if (!movable.length) break;
    const victim = movable[movable.length - 1];
    hourOf.set(victim.automationId, minHour);
    counts[maxHour] -= 1;
    counts[minHour] += 1;
  }

  const assignedIdsByHour: string[][] = Array.from({ length: 24 }, () => []);
  for (const robot of robots) {
    assignedIdsByHour[hourOf.get(robot.automationId) ?? 0].push(robot.automationId);
  }

  const assignments: DailyAssignment[] = [];
  const moves: DailyMove[] = [];

  for (let hour = 0; hour < 24; hour += 1) {
    const ids = assignedIdsByHour[hour];
    const offsets = placeOffsetsInHour(ids.length, occupiedByHour[hour]);
    ids.forEach((automationId, index) => {
      const robot = dailyById.get(automationId);
      if (!robot) return;
      const offset = offsets[index] ?? 0;
      const minute = Math.floor(offset / 60_000);
      const second = Math.floor((offset % 60_000) / 1000);
      const nextRunAt = nextIstOccurrence(hour, minute, second, opts.now);
      const lastRunAt = new Date(nextRunAt.getTime() - DAILY_INTERVAL_MS);
      assignments.push({
        automationId: robot.automationId,
        name: robot.name,
        company: robot.company,
        hour,
        minute,
        second,
        nextRunAt,
        lastRunAt,
      });

      const fromAt = robot.currentNextRunAt ? robot.currentNextRunAt.toISOString() : null;
      const toAt = nextRunAt.toISOString();
      if (fromAt !== toAt) {
        moves.push({
          automationId: robot.automationId,
          name: robot.name,
          company: robot.company,
          fromAt: fromAt ?? '',
          toAt,
        });
      }
    });
  }

  return {
    assignments,
    moves,
    hourCounts: counts.map((count, hour) => ({ hour, count })),
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

export function planReconfigureFromRobots(robots: any[], now: Date): DailyReconfigurePlan {
  const todayYmd = formatIstYmd(now.getTime());
  const daily: DailyRobotInput[] = [];
  const immovableIds = new Set<string>();

  for (const robot of robots) {
    const schedule = resolveEffectiveScheduleState(robot);
    const kind = classifyScheduleKind(schedule);
    const automationId = getAutomationId(robot);
    if (kind === 'daily') {
      const timestamps = readRobotScheduleTimestamps(robot, schedule);
      const next = timestamps.nextRunAt;
      daily.push({
        automationId,
        name: getRobotName(robot),
        company: getCompanyName(robot),
        currentHour: next && !Number.isNaN(next.getTime()) ? istHourOf(next.getTime()) : null,
        currentMinute: next && !Number.isNaN(next.getTime()) ? istMinuteOf(next.getTime()) : null,
        currentNextRunAt: next && !Number.isNaN(next.getTime()) ? next : null,
      });
    } else if (kind === 'immovable') {
      immovableIds.add(automationId);
    }
  }

  const heatmap = computeScheduleHeatmap(robots, todayYmd);
  const immovableSlots: ImmovableSlot[] = heatmap.fires
    .filter((fire) => immovableIds.has(fire.automationId))
    .map((fire) => ({ hour: fire.hour, minute: fire.minute }));

  return planDailyReconfigure({ daily, immovableSlots, now });
}

export type ReconfigureDailyResult = {
  movedCount: number;
  skippedCount: number;
  hourCounts: Array<{ hour: number; count: number }>;
  moves: DailyMove[];
};

async function persistDailyTimestamps(input: {
  robotId: unknown;
  automationId: string;
  lastRunAt: Date;
  nextRunAt: Date;
}): Promise<void> {
  await Robot.updateOne(
    { _id: input.robotId },
    {
      $set: {
        'schedule.lastRunAt': input.lastRunAt,
        'schedule.nextRunAt': input.nextRunAt,
        'schedule.cron': '0 0 * * *',
        'schedule.every': DAILY_INTERVAL_MS,
        'schedule.updatedAt': new Date().toISOString(),
        'recording_meta.saasConfig.schedule.lastRunAt': input.lastRunAt,
        'recording_meta.saasConfig.schedule.nextRunAt': input.nextRunAt,
        'recording_meta.saasConfig.schedule.cron': '0 0 * * *',
        'recording_meta.saasConfig.schedule.every': DAILY_INTERVAL_MS,
      },
    },
  );
  await updateScheduledTriggerNextRunAt(input.automationId, input.nextRunAt);
}

export async function reconfigureDailySchedulesForOwner(
  ownerId: number | string,
): Promise<ReconfigureDailyResult> {
  const robots = await Robot.find(ownerIdFilter(ownerId));
  const jsonRobots = robots.map((robot) => robot.toJSON());
  const now = new Date();
  const plan = planReconfigureFromRobots(jsonRobots, now);

  const byId = new Map(robots.map((robot) => [getAutomationId(robot.toJSON()), robot]));
  let skippedCount = 0;
  for (const robot of jsonRobots) {
    const kind = classifyScheduleKind(resolveEffectiveScheduleState(robot));
    if (kind !== 'daily') skippedCount += 1;
  }

  const moveIds = new Set(plan.moves.map((move) => move.automationId));
  for (const assignment of plan.assignments) {
    if (!moveIds.has(assignment.automationId)) continue;
    const robot = byId.get(assignment.automationId);
    if (!robot) continue;
    await persistDailyTimestamps({
      robotId: robot._id,
      automationId: assignment.automationId,
      lastRunAt: assignment.lastRunAt,
      nextRunAt: assignment.nextRunAt,
    });
    logger.log(
      'info',
      `Reconfigured daily schedule ${assignment.automationId}: ${assignment.company || assignment.name} -> ${assignment.nextRunAt.toISOString()}`,
    );
  }

  return {
    movedCount: plan.moves.length,
    skippedCount,
    hourCounts: plan.hourCounts,
    moves: plan.moves,
  };
}
