import { describe, expect, it } from 'vitest';
import {
  computeRunDurationMs,
  isCanonicalRunTimestamp,
  resolveRunDurationMs,
  MAX_SANE_RUN_DURATION_MS,
} from './automation';

describe('resolveRunDurationMs', () => {
  it('computes duration from ISO timestamps', () => {
    const ms = computeRunDurationMs('2026-08-16T10:00:00.000Z', '2026-08-16T10:28:00.000Z');
    expect(ms).toBe(28 * 60 * 1000);
  });

  it('returns null for absurd multi-day durations', () => {
    const ms = computeRunDurationMs('2026-01-01T00:00:00.000Z', '2026-08-16T00:00:00.000Z');
    expect(ms).toBeNull();
  });

  it('ignores stored duration above sane max', () => {
    expect(
      resolveRunDurationMs({
        status: 'success',
        duration: MAX_SANE_RUN_DURATION_MS + 1,
        startedAt: null,
        finishedAt: null,
      })
    ).toBeNull();
  });

  it('returns null while run is still active', () => {
    expect(
      resolveRunDurationMs({
        status: 'running',
        duration: 5_000,
        startedAt: '2026-08-16T10:00:00.000Z',
        finishedAt: '',
      })
    ).toBeNull();
  });

  it('prefers timestamp delta over stored duration', () => {
    expect(
      resolveRunDurationMs({
        status: 'success',
        duration: 999_999_999,
        startedAt: '2026-08-16T10:00:00.000Z',
        finishedAt: '2026-08-16T10:05:00.000Z',
      })
    ).toBe(5 * 60 * 1000);
  });

  it('resolves DMY locale finishedAt against ISO startedAt (not MDY Nov swap)', () => {
    // Legacy writers used toLocaleString() on en-IN hosts → "11/8/2024" means 11 Aug.
    // Date.parse treats that as US MDY → 8 Nov → ~2000h. Prefer the sane DMY reading.
    const ms = computeRunDurationMs(
      '2024-08-11T13:55:51.380Z',
      '11/8/2024, 7:40:02 pm'
    );
    expect(ms).not.toBeNull();
    expect(ms!).toBeGreaterThan(0);
    expect(ms!).toBeLessThan(12 * 60 * 60 * 1000); // same-day / few hours, never ~2141h
  });

  it('does not invent multi-month duration from ambiguous locale finishedAt', () => {
    const ms = computeRunDurationMs(
      '2024-08-11T13:59:22.187Z',
      '11/8/2024, 7:39:57 pm'
    );
    expect(ms).not.toBeNull();
    expect(ms!).toBeLessThan(MAX_SANE_RUN_DURATION_MS);
    expect(ms! / (60 * 60 * 1000)).toBeLessThan(24); // not ~2141h
  });

  it('ignores absurd stored duration when locale finishedAt can be read as DMY', () => {
    const ms = resolveRunDurationMs({
      status: 'dead',
      duration: 2141 * 60 * 60 * 1000,
      startedAt: '2024-08-11T13:55:51.380Z',
      finishedAt: '11/8/2024, 7:40:02 pm',
    });
    expect(ms).not.toBeNull();
    expect(ms!).toBeLessThan(12 * 60 * 60 * 1000);
  });
});

describe('isCanonicalRunTimestamp', () => {
  it('accepts ISO timestamps but rejects ambiguous legacy locale strings', () => {
    expect(isCanonicalRunTimestamp('2026-08-17T06:20:30.066Z')).toBe(true);
    expect(isCanonicalRunTimestamp('11/8/2026, 7:40:02 pm')).toBe(false);
  });
});
