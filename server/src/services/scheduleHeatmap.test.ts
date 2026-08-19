import { describe, expect, it } from 'vitest';
import { computeScheduleHeatmap } from './scheduleHeatmap';

describe('computeScheduleHeatmap', () => {
  it('puts every-6-hours fires into four IST hours on that day', () => {
    const result = computeScheduleHeatmap(
      [
        {
          recording_meta: {
            id: 'auto-google',
            name: 'Google jobs',
            companyName: 'Google',
          },
          schedule: {
            enabled: true,
            cron: '0 */6 * * *',
            every: 6 * 60 * 60 * 1000,
            timezone: 'UTC',
            nextRunAt: '2026-08-18T12:00:00.000Z',
          },
        },
      ],
      '2026-08-18',
    );

    expect(result.date).toBe('2026-08-18');
    expect(result.timezone).toBe('Asia/Kolkata');
    expect(result.hours).toHaveLength(24);
    expect(result.fires).toHaveLength(4);
    expect(result.fires.map((fire) => `${fire.hour}:${String(fire.minute).padStart(2, '0')}`)).toEqual([
      '5:30',
      '11:30',
      '17:30',
      '23:30',
    ]);
    expect(result.hours.filter((hour) => hour.count > 0).map((hour) => hour.hour)).toEqual([
      5, 11, 17, 23,
    ]);
    expect(result.fires[0]).toMatchObject({
      automationId: 'auto-google',
      name: 'Google jobs',
      company: 'Google',
    });
  });

  it('displays stored UTC cron ticks in IST hours', () => {
    const result = computeScheduleHeatmap(
      [
        {
          recording_meta: {
            id: 'wipro',
            name: 'Wipro careers',
            saasConfig: { companyName: 'Wipro' },
          },
          schedule: {
            enabled: true,
            cron: '45 12 * * *',
            timezone: 'UTC',
          },
        },
      ],
      '2026-08-18',
    );

    expect(result.fires).toEqual([
      expect.objectContaining({
        hour: 18,
        minute: 15,
        company: 'Wipro',
        name: 'Wipro careers',
      }),
    ]);
  });

  it('skips paused schedules', () => {
    const result = computeScheduleHeatmap(
      [
        {
          recording_meta: { id: 'paused', name: 'Paused', companyName: 'Acme' },
          schedule: { enabled: false, cron: '0 * * * *', timezone: 'UTC' },
        },
      ],
      '2026-08-18',
    );

    expect(result.fires).toEqual([]);
    expect(result.hours.every((hour) => hour.count === 0)).toBe(true);
  });
});
