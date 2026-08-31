import { describe, expect, it } from 'vitest';
import {
  automationScheduleNeedsRepack,
  resolveScheduleEveryMs,
} from './automationScheduler';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

describe('resolveScheduleEveryMs', () => {
  it('prefers explicit every over cron', () => {
    expect(resolveScheduleEveryMs({ cron: '0 * * * *', every: DAY_MS })).toBe(DAY_MS);
  });

  it('derives interval from preset cron', () => {
    expect(resolveScheduleEveryMs({ cron: '0 * * * *' })).toBe(HOUR_MS);
  });
});

describe('automationScheduleNeedsRepack', () => {
  it('returns true when cron changes', () => {
    const robot = {
      schedule: { enabled: true, cron: '0 0 * * *', every: DAY_MS, timezone: 'UTC' },
      recording_meta: {
        saasConfig: { schedule: { enabled: true, cron: '0 0 * * *', every: DAY_MS, timezone: 'UTC' } },
      },
    };
    expect(
      automationScheduleNeedsRepack(robot, { enabled: true, cron: '0 * * * *', timezone: 'UTC' })
    ).toBe(true);
  });

  it('returns true when cron unchanged but nextRunAt is too far for hourly interval', () => {
    const staleNext = new Date(Date.now() + 11 * HOUR_MS);
    const robot = {
      schedule: {
        enabled: true,
        cron: '0 * * * *',
        every: HOUR_MS,
        nextRunAt: staleNext,
        timezone: 'UTC',
      },
      recording_meta: {
        saasConfig: {
          schedule: {
            enabled: true,
            cron: '0 * * * *',
            every: HOUR_MS,
            nextRunAt: staleNext,
            timezone: 'UTC',
          },
        },
      },
    };
    expect(
      automationScheduleNeedsRepack(robot, { enabled: true, cron: '0 * * * *', timezone: 'UTC' })
    ).toBe(true);
  });

  it('returns false when hourly nextRunAt is within the interval window', () => {
    const soonNext = new Date(Date.now() + 20 * 60 * 1000);
    const robot = {
      schedule: {
        enabled: true,
        cron: '0 * * * *',
        every: HOUR_MS,
        nextRunAt: soonNext,
        timezone: 'UTC',
      },
      recording_meta: {
        saasConfig: {
          schedule: {
            enabled: true,
            cron: '0 * * * *',
            every: HOUR_MS,
            timezone: 'UTC',
          },
        },
      },
    };
    expect(
      automationScheduleNeedsRepack(robot, { enabled: true, cron: '0 * * * *', timezone: 'UTC' })
    ).toBe(false);
  });

  it('returns true when root cron drifted from saas config', () => {
    const robot = {
      schedule: { enabled: true, cron: '0 0 * * *', every: DAY_MS, timezone: 'UTC' },
      recording_meta: {
        saasConfig: {
          schedule: { enabled: true, cron: '0 * * * *', every: HOUR_MS, timezone: 'UTC' },
        },
      },
    };
    expect(
      automationScheduleNeedsRepack(robot, { enabled: true, cron: '0 * * * *', timezone: 'UTC' })
    ).toBe(true);
  });
});
