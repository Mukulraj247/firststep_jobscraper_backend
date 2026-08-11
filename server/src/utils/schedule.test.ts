import { describe, it, expect } from 'vitest';
import {
  validateCron,
  validateAutomationScheduleCron,
  computeNextRun,
  intervalMsFromCron,
  computeNextRunFromInterval,
  isScheduleOverdue,
} from './schedule';

describe('validateCron', () => {
  it('accepts common 5-field expressions', () => {
    for (const cron of ['*/10 * * * *', '*/15 * * * *', '0 * * * *', '0 0 * * *', '0 0 1 * *']) {
      const result = validateCron(cron, 'UTC');
      expect(result.ok, `expected "${cron}" to be valid`).toBe(true);
    }
  });

  it('rejects empty expressions', () => {
    const result = validateCron('', 'UTC');
    expect(result.ok).toBe(false);
  });

  it('rejects malformed cron strings', () => {
    for (const cron of ['not-a-cron', '*/ * * * *', '60 * * * *']) {
      const result = validateCron(cron, 'UTC');
      expect(result.ok, `expected "${cron}" to be rejected`).toBe(false);
    }
  });

  it('rejects invalid timezones', () => {
    const result = validateCron('*/10 * * * *', 'Not/A_Zone');
    expect(result.ok).toBe(false);
  });

  it('accepts valid tz like America/New_York and Asia/Kolkata', () => {
    expect(validateCron('0 9 * * *', 'America/New_York').ok).toBe(true);
    expect(validateCron('0 9 * * *', 'Asia/Kolkata').ok).toBe(true);
  });
});

describe('validateAutomationScheduleCron', () => {
  it('rejects intervals shorter than 15 minutes', () => {
    expect(validateAutomationScheduleCron('*/10 * * * *', 'UTC').ok).toBe(false);
    expect(validateAutomationScheduleCron('*/5 * * * *', 'UTC').ok).toBe(false);
    expect(validateAutomationScheduleCron('* * * * *', 'UTC').ok).toBe(false);
  });

  it('accepts */15 and hourly or slower', () => {
    expect(validateAutomationScheduleCron('*/15 * * * *', 'UTC').ok).toBe(true);
    expect(validateAutomationScheduleCron('0 * * * *', 'UTC').ok).toBe(true);
    expect(validateAutomationScheduleCron('0 0 * * *', 'UTC').ok).toBe(true);
  });
});

describe('computeNextRun', () => {
  it('returns a future Date for a valid expression', () => {
    const next = computeNextRun('*/10 * * * *', 'UTC');
    expect(next).toBeInstanceOf(Date);
    expect((next as Date).getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it('returns null for invalid input', () => {
    expect(computeNextRun('bogus', 'UTC')).toBeNull();
  });
});

describe('intervalMsFromCron', () => {
  it('maps short presets to interval ms', () => {
    expect(intervalMsFromCron('*/15 * * * *')).toBe(15 * 60 * 1000);
    expect(intervalMsFromCron('*/30 * * * *')).toBe(30 * 60 * 1000);
    expect(intervalMsFromCron('0 * * * *')).toBe(60 * 60 * 1000);
  });

  it('maps daily/weekly calendar presets to intervals for hash stagger', () => {
    expect(intervalMsFromCron('0 0 * * *')).toBe(24 * 60 * 60 * 1000);
    expect(intervalMsFromCron('0 0 */2 * *')).toBe(2 * 24 * 60 * 60 * 1000);
    expect(intervalMsFromCron('0 0 */3 * *')).toBe(3 * 24 * 60 * 60 * 1000);
    expect(intervalMsFromCron('0 0 * * 1')).toBe(7 * 24 * 60 * 60 * 1000);
    expect(intervalMsFromCron('0 0 1 * *')).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it('returns null for free-form calendar crons', () => {
    expect(intervalMsFromCron('0 9 * * *')).toBeNull();
    expect(intervalMsFromCron('30 14 * * 5')).toBeNull();
  });
});

describe('computeNextRunFromInterval', () => {
  it('adds everyMs from the given anchor', () => {
    const from = new Date('2026-07-31T10:00:00.000Z');
    const next = computeNextRunFromInterval(15 * 60 * 1000, from);
    expect(next.toISOString()).toBe('2026-07-31T10:15:00.000Z');
  });
});

describe('isScheduleOverdue', () => {
  const graceMs = 120_000;
  const everyMs = 15 * 60_000;
  const lastRunAt = new Date('2026-08-08T10:00:00.000Z');
  // dueAt = 10:15; with grace overdue at 10:17

  it('keeps a fresh interval schedule', () => {
    expect(
      isScheduleOverdue({
        lastRunAt,
        everyMs,
        graceMs,
        now: new Date('2026-08-08T10:10:00.000Z'),
      })
    ).toBe(false);
  });

  it('is not overdue within grace after dueAt', () => {
    expect(
      isScheduleOverdue({
        lastRunAt,
        everyMs,
        graceMs,
        now: new Date('2026-08-08T10:16:00.000Z'),
      })
    ).toBe(false);
  });

  it('is overdue past dueAt + grace', () => {
    expect(
      isScheduleOverdue({
        lastRunAt,
        everyMs,
        graceMs,
        now: new Date('2026-08-08T10:17:00.000Z'),
      })
    ).toBe(true);
  });

  it('uses past nextRunAt when lastRunAt is missing', () => {
    expect(
      isScheduleOverdue({
        lastRunAt: null,
        nextRunAt: new Date('2026-08-08T09:00:00.000Z'),
        everyMs,
        graceMs,
        now: new Date('2026-08-08T09:05:00.000Z'),
      })
    ).toBe(true);
  });

  it('is not overdue with no timestamps', () => {
    expect(
      isScheduleOverdue({
        lastRunAt: null,
        nextRunAt: null,
        everyMs,
        graceMs,
        now: new Date('2026-08-08T12:00:00.000Z'),
      })
    ).toBe(false);
  });

  it('calendar cron uses nextRunAt when past + grace', () => {
    expect(
      isScheduleOverdue({
        nextRunAt: new Date('2026-08-08T08:00:00.000Z'),
        everyMs: null,
        graceMs,
        now: new Date('2026-08-08T08:03:00.000Z'),
      })
    ).toBe(true);
    expect(
      isScheduleOverdue({
        nextRunAt: new Date('2026-08-08T08:00:00.000Z'),
        everyMs: null,
        graceMs,
        now: new Date('2026-08-08T08:01:00.000Z'),
      })
    ).toBe(false);
  });
});
