import { describe, expect, it } from 'vitest';
import { computeUpcomingScheduleMetrics } from './upcomingScheduleMetrics';

const now = new Date('2026-08-18T12:00:00.000Z');

describe('computeUpcomingScheduleMetrics', () => {
  it('counts interval fires and automations in the forward window', () => {
    const robots = [
      {
        schedule: {
          enabled: true,
          cron: '0 * * * *',
          timezone: 'UTC',
          nextRunAt: '2026-08-18T12:30:00.000Z',
        },
      },
      {
        recording_meta: {
          saasConfig: {
            schedule: {
              enabled: true,
              cron: '*/30 * * * *',
              timezone: 'UTC',
              nextRunAt: '2026-08-18T12:15:00.000Z',
            },
          },
        },
      },
      {
        schedule: { enabled: false, cron: '0 * * * *' },
      },
    ];

    const result = computeUpcomingScheduleMetrics(robots, 60 * 60 * 1000, now);

    expect(result.activeScheduledAutomations).toBe(2);
    expect(result.automationsWithRuns).toBe(2);
    expect(result.totalScheduledRuns).toBe(3);
  });

  it('returns zero when no schedules are active', () => {
    const result = computeUpcomingScheduleMetrics(
      [{ schedule: { enabled: false, cron: '0 * * * *' } }],
      6 * 60 * 60 * 1000,
      now,
    );

    expect(result).toEqual({
      automationsWithRuns: 0,
      totalScheduledRuns: 0,
      activeScheduledAutomations: 0,
      forecastFrom: now.toISOString(),
      forecastUntil: new Date(now.getTime() + 6 * 60 * 60 * 1000).toISOString(),
    });
  });
});
