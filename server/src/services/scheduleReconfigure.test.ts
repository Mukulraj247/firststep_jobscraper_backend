import { describe, expect, it } from 'vitest';
import { MIN_AUTOMATION_GAP_MS } from '../utils/schedule';
import {
  DAILY_INTERVAL_MS,
  classifyScheduleKind,
  placeOffsetsInHour,
  planDailyReconfigure,
  planReconfigureFromRobots,
} from './scheduleReconfigure';
import { istHourOf } from '../../../src/shared/opsTimezone';

const HOUR_MS = 60 * 60 * 1000;
const GAP = MIN_AUTOMATION_GAP_MS;

function dailyRobot(
  id: string,
  opts: { hour: number; minute?: number; name?: string; company?: string; currentNextRunAt?: Date } = {
    hour: 18,
  },
) {
  const minute = opts.minute ?? 0;
  return {
    automationId: id,
    name: opts.name ?? id,
    company: opts.company ?? id,
    currentHour: opts.hour,
    currentMinute: minute,
    currentNextRunAt: opts.currentNextRunAt,
  };
}

describe('classifyScheduleKind', () => {
  it('treats every-day interval and 0 0 * * * as daily', () => {
    expect(classifyScheduleKind({ enabled: true, every: DAILY_INTERVAL_MS, cron: '' })).toBe('daily');
    expect(classifyScheduleKind({ enabled: true, every: undefined, cron: '0 0 * * *' })).toBe(
      'daily',
    );
  });

  it('treats hourly, 6h, and custom calendar crons as immovable', () => {
    expect(classifyScheduleKind({ enabled: true, every: HOUR_MS, cron: '0 * * * *' })).toBe(
      'immovable',
    );
    expect(
      classifyScheduleKind({ enabled: true, every: 6 * HOUR_MS, cron: '0 */6 * * *' }),
    ).toBe('immovable');
    expect(classifyScheduleKind({ enabled: true, every: undefined, cron: '45 12 * * *' })).toBe(
      'immovable',
    );
  });

  it('skips disabled schedules', () => {
    expect(
      classifyScheduleKind({ enabled: false, every: DAILY_INTERVAL_MS, cron: '0 0 * * *' }),
    ).toBe('skip');
  });
});

describe('placeOffsetsInHour', () => {
  it('spaces jobs 90s apart and skips an occupied :00', () => {
    const offsets = placeOffsetsInHour(3, [0]);
    expect(offsets).toHaveLength(3);
    expect(offsets[0]).toBeGreaterThanOrEqual(GAP);
    for (let i = 1; i < offsets.length; i += 1) {
      expect(offsets[i] - offsets[i - 1]).toBeGreaterThanOrEqual(GAP);
    }
    for (const offset of offsets) {
      expect(Math.abs(offset - 0)).toBeGreaterThanOrEqual(GAP);
      expect(offset).toBeLessThan(HOUR_MS);
    }
  });
});

describe('planDailyReconfigure', () => {
  it('spreads clustered daily robots so hour counts differ by at most 10', () => {
    const daily = Array.from({ length: 37 }, (_, i) => dailyRobot(`d-${i}`, { hour: 18 }));
    const plan = planDailyReconfigure({
      daily,
      immovableSlots: [],
      now: new Date('2026-08-19T00:00:00.000Z'),
    });

    const counts = plan.hourCounts.map((row) => row.count);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(10);
    expect(Math.max(...counts)).toBeLessThanOrEqual(40);
    expect(plan.assignments).toHaveLength(37);
  });

  it('never assigns more than 40 fires into one hour', () => {
    const daily = Array.from({ length: 48 }, (_, i) => dailyRobot(`d-${i}`, { hour: 6 }));
    const immovableSlots = Array.from({ length: 30 }, (_, i) => ({
      hour: 6,
      minute: i,
    }));
    const plan = planDailyReconfigure({
      daily,
      immovableSlots,
      now: new Date('2026-08-19T00:00:00.000Z'),
    });
    expect(Math.max(...plan.hourCounts.map((row) => row.count))).toBeLessThanOrEqual(40);
  });

  it('keeps 90s gaps inside a packed hour around an occupied :00', () => {
    const immovableSlots: Array<{ hour: number; minute: number }> = [];
    for (let hour = 0; hour < 24; hour += 1) {
      if (hour === 9) {
        immovableSlots.push({ hour: 9, minute: 0 });
        continue;
      }
      for (let i = 0; i < 39; i += 1) {
        immovableSlots.push({ hour, minute: i });
      }
    }

    const plan = planDailyReconfigure({
      daily: [
        dailyRobot('a', { hour: 9 }),
        dailyRobot('b', { hour: 9 }),
        dailyRobot('c', { hour: 9 }),
      ],
      immovableSlots,
      now: new Date('2026-08-18T18:00:00.000Z'),
    });

    const inHour9 = plan.assignments.filter((row) => istHourOf(row.nextRunAt.getTime()) === 9);
    expect(inHour9).toHaveLength(3);
    const times = inHour9.map((row) => row.nextRunAt.getTime()).sort((a, b) => a - b);
    for (let i = 1; i < times.length; i += 1) {
      expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(GAP);
    }
    const occupied = Date.parse('2026-08-19T03:30:00.000Z');
    for (const t of times) {
      expect(Math.abs(t - occupied)).toBeGreaterThanOrEqual(GAP);
    }
  });

  it('sets lastRunAt to 24h before nextRunAt and pushes past clock times to tomorrow', () => {
    const now = new Date('2026-08-19T05:30:00.000Z');
    const plan = planDailyReconfigure({
      daily: [dailyRobot('jpm', { hour: 6, company: 'JP Morgan Chase', name: 'JP data engineer' })],
      immovableSlots: [],
      now,
    });

    const row = plan.assignments[0];
    expect(row.lastRunAt.getTime()).toBe(row.nextRunAt.getTime() - DAILY_INTERVAL_MS);
    expect(row.nextRunAt.getTime()).toBeGreaterThan(now.getTime());
    expect(istHourOf(row.nextRunAt.getTime())).toBe(row.hour);
  });

  it('omits robots whose nextRunAt did not change', () => {
    const now = new Date('2026-08-18T18:00:00.000Z');
    const currentNext = new Date('2026-08-19T03:30:00.000Z');
    const immovableSlots: Array<{ hour: number; minute: number }> = [];
    for (let hour = 0; hour < 24; hour += 1) {
      if (hour === 9) continue;
      immovableSlots.push({ hour, minute: 0 });
    }

    const plan = planDailyReconfigure({
      daily: [
        dailyRobot('stay', {
          hour: 9,
          minute: 0,
          name: 'Stay',
          company: 'Stay Co',
          currentNextRunAt: currentNext,
        }),
      ],
      immovableSlots,
      now,
    });

    expect(plan.assignments[0].nextRunAt.getTime()).toBe(currentNext.getTime());
    expect(plan.moves).toEqual([]);
  });
});

describe('planReconfigureFromRobots', () => {
  it('does not move hourly or 6-hour robots', () => {
    const now = new Date('2026-08-19T00:00:00.000Z');
    const plan = planReconfigureFromRobots(
      [
        {
          recording_meta: { id: 'amz', name: 'Amazon jobs', companyName: 'Amazon' },
          schedule: {
            enabled: true,
            cron: '0 * * * *',
            every: HOUR_MS,
            nextRunAt: '2026-08-19T01:00:00.000Z',
          },
        },
        {
          recording_meta: { id: 'six', name: 'Six hour', companyName: 'Six' },
          schedule: {
            enabled: true,
            cron: '0 */6 * * *',
            every: 6 * HOUR_MS,
            nextRunAt: '2026-08-19T00:00:00.000Z',
          },
        },
        {
          recording_meta: { id: 'jpm', name: 'JP data engineer', companyName: 'JP Morgan Chase' },
          schedule: {
            enabled: true,
            cron: '0 0 * * *',
            every: DAILY_INTERVAL_MS,
            nextRunAt: '2026-08-19T00:30:00.000Z',
          },
        },
      ],
      now,
    );

    expect(plan.assignments.map((row) => row.automationId)).toEqual(['jpm']);
    expect(plan.moves.every((move) => move.automationId === 'jpm')).toBe(true);
  });
});
