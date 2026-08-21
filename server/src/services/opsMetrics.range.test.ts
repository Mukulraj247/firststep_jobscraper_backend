import { describe, expect, it } from 'vitest';
import { resolveOpsMetricsBounds } from './opsMetrics';

describe('resolveOpsMetricsBounds', () => {
  it('aligns a 6h window to IST hours so ticks are :00', () => {
    const nowMs = Date.parse('2026-08-17T22:23:00.000Z'); // 03:53 IST on 18 Aug
    const bounds = resolveOpsMetricsBounds({ window: '6h', nowMs });

    expect(bounds.isCalendarDay).toBe(false);
    expect(bounds.bucketStarts).toHaveLength(6);
    expect(bounds.bucketStarts.map((t) => new Date(t).toISOString())).toEqual([
      '2026-08-17T16:30:00.000Z', // 22:00 IST
      '2026-08-17T17:30:00.000Z',
      '2026-08-17T18:30:00.000Z',
      '2026-08-17T19:30:00.000Z',
      '2026-08-17T20:30:00.000Z',
      '2026-08-17T21:30:00.000Z', // 03:00 IST
    ]);
    expect(bounds.untilMs).toBe(nowMs);
  });

  it('uses 00:00–24:00 IST for a picked past calendar day', () => {
    const bounds = resolveOpsMetricsBounds({
      window: '6h',
      date: '2026-08-11',
      nowMs: Date.parse('2026-08-18T10:00:00.000Z'),
    });

    expect(bounds.isCalendarDay).toBe(true);
    expect(bounds.sinceMs).toBe(Date.parse('2026-08-10T18:30:00.000Z'));
    expect(bounds.untilMs).toBe(Date.parse('2026-08-11T18:29:59.999Z'));
    expect(bounds.bucketStarts).toHaveLength(8);
    expect(bounds.bucketStarts[0]).toBe(bounds.sinceMs);
    expect(bounds.bucketStarts[1] - bounds.bucketStarts[0]).toBe(3 * 60 * 60 * 1000);
  });

  it('treats today YMD like an empty date (rolling window, may cross midnight)', () => {
    const nowMs = Date.parse('2026-08-17T22:23:00.000Z'); // 03:53 IST on 18 Aug
    const withoutDate = resolveOpsMetricsBounds({ window: '6h', nowMs });
    const withToday = resolveOpsMetricsBounds({
      window: '6h',
      date: '2026-08-18',
      nowMs,
    });

    expect(withToday.isCalendarDay).toBe(false);
    expect(withToday).toEqual(withoutDate);
    expect(withToday.bucketStarts.map((t) => new Date(t).toISOString())).toEqual([
      '2026-08-17T16:30:00.000Z', // 22:00 IST previous evening
      '2026-08-17T17:30:00.000Z',
      '2026-08-17T18:30:00.000Z',
      '2026-08-17T19:30:00.000Z',
      '2026-08-17T20:30:00.000Z',
      '2026-08-17T21:30:00.000Z', // 03:00 IST
    ]);
  });
});
