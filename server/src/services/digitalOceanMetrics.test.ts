import { describe, expect, it } from 'vitest';
import {
  CPU_MODE_BUCKET_SEC,
  cpuPercentFromModes,
  type PromResult,
} from './digitalOceanMetrics';

/** Build a Prom-style CPU mode series from aligned samples. */
function modeSeries(
  mode: string,
  samples: Array<[number, number]>
): PromResult {
  return {
    metric: { mode, host_id: '1' },
    values: samples.map(([t, v]) => [t, String(v)]),
  };
}

describe('cpuPercentFromModes', () => {
  it('computes busy % from aligned cumulative counters (DO docs-style)', () => {
    // 120s apart; ~0.2% busy (almost all idle), matching DO public example shape.
    const t0 = 1_635_386_880;
    const t1 = t0 + 120;
    const series: PromResult[] = [
      modeSeries('idle', [
        [t0, 122_901.18],
        [t1, 123_020.92],
      ]),
      modeSeries('user', [
        [t0, 278.57],
        [t1, 278.65],
      ]),
      modeSeries('system', [
        [t0, 140.09],
        [t1, 140.2],
      ]),
      modeSeries('iowait', [
        [t0, 14.99],
        [t1, 15.01],
      ]),
      modeSeries('irq', [
        [t0, 0],
        [t1, 0],
      ]),
      modeSeries('nice', [
        [t0, 66.35],
        [t1, 66.35],
      ]),
      modeSeries('softirq', [
        [t0, 2.13],
        [t1, 2.13],
      ]),
      modeSeries('steal', [
        [t0, 7.89],
        [t1, 7.9],
      ]),
    ];

    const points = cpuPercentFromModes(series, 60);
    expect(points.length).toBeGreaterThanOrEqual(1);
    const last = points[points.length - 1];
    expect(last.v).toBeGreaterThan(0);
    expect(last.v).toBeLessThan(2);
  });

  it('recovers a busy window when mode timestamps are slightly misaligned', () => {
    // Old exact-key grouping would under-read or emit almost nothing when
    // idle/user land 1–2s apart. Bucketing + forward-fill should still see ~50% busy.
    const base = 1_700_000_000;
    const series: PromResult[] = [
      modeSeries('idle', [
        [base + 0, 1000],
        [base + 61, 1030], // +30 idle over ~60s
        [base + 121, 1060],
      ]),
      modeSeries('user', [
        [base + 1, 200], // +1s skew
        [base + 62, 230], // +30 user
        [base + 122, 260],
      ]),
      modeSeries('system', [
        [base + 2, 50],
        [base + 63, 50],
        [base + 123, 50],
      ]),
    ];

    const points = cpuPercentFromModes(series, CPU_MODE_BUCKET_SEC);
    expect(points.length).toBeGreaterThanOrEqual(1);
    // idleΔ 30, userΔ 30 → busy ≈ 50%
    const busyish = points.filter((p) => p.v >= 40 && p.v <= 60);
    expect(busyish.length).toBeGreaterThanOrEqual(1);
  });

  it('time-weighted style: sustained high busy is not flattened to a tiny latest%', () => {
    const base = 1_800_000_000;
    // Three intervals: idle-heavy, then two busy (~80%), then idle-heavy again.
    const idle = [
      [base, 0],
      [base + 60, 50], // +50 idle / ~10 busy → ~16.7% if user +10
      [base + 120, 60], // +10 idle / +40 user → ~80%
      [base + 180, 70], // +10 idle / +40 user → ~80%
      [base + 240, 120], // +50 idle / +10 user → ~16.7%
    ] as Array<[number, number]>;
    const user = [
      [base, 0],
      [base + 60, 10],
      [base + 120, 50],
      [base + 180, 90],
      [base + 240, 100],
    ] as Array<[number, number]>;

    const points = cpuPercentFromModes(
      [modeSeries('idle', idle), modeSeries('user', user)],
      60
    );
    expect(points.length).toBeGreaterThanOrEqual(3);
    const max = Math.max(...points.map((p) => p.v));
    expect(max).toBeGreaterThan(70);

    // Simple mean of points would still be decent; ensure we didn't collapse to one sample.
    expect(points.length).toBeGreaterThan(1);
  });
});
