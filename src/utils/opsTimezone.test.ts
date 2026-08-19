import { describe, expect, it } from 'vitest';
import {
  OPS_TIME_ZONE,
  endOfIstDay,
  formatIstYmd,
  isIstDateOnDayStrip,
  isIstDateWithinLastDays,
  istDayStripAroundToday,
  istHourOf,
  istMinuteOf,
  lastNIstDayYmds,
  startOfIstDay,
} from '../shared/opsTimezone';

describe('opsTimezone', () => {
  it('uses Asia/Kolkata as the ops clock', () => {
    expect(OPS_TIME_ZONE).toBe('Asia/Kolkata');
  });

  it('starts an IST calendar day at 00:00 IST (18:30 UTC the previous day)', () => {
    const start = startOfIstDay('2026-08-18');
    expect(start.toISOString()).toBe('2026-08-17T18:30:00.000Z');
  });

  it('ends an IST calendar day at 23:59:59.999 IST', () => {
    const end = endOfIstDay('2026-08-18');
    expect(end.toISOString()).toBe('2026-08-18T18:29:59.999Z');
  });

  it('formats an instant as YYYY-MM-DD in IST', () => {
    // 2026-08-18 00:30 IST == 2026-08-17 19:00 UTC
    expect(formatIstYmd(Date.parse('2026-08-17T19:00:00.000Z'))).toBe('2026-08-18');
    // 2026-08-17 23:30 IST == 2026-08-17 18:00 UTC
    expect(formatIstYmd(Date.parse('2026-08-17T18:00:00.000Z'))).toBe('2026-08-17');
  });

  it('lists the last 7 IST days ending at today, oldest first', () => {
    const now = Date.parse('2026-08-18T10:00:00.000Z'); // 15:30 IST
    expect(lastNIstDayYmds(now, 7)).toEqual([
      '2026-08-12',
      '2026-08-13',
      '2026-08-14',
      '2026-08-15',
      '2026-08-16',
      '2026-08-17',
      '2026-08-18',
    ]);
  });

  it('accepts only dates inside the last 7 IST days', () => {
    const now = Date.parse('2026-08-18T10:00:00.000Z');
    expect(isIstDateWithinLastDays('2026-08-18', now, 7)).toBe(true);
    expect(isIstDateWithinLastDays('2026-08-12', now, 7)).toBe(true);
    expect(isIstDateWithinLastDays('2026-08-11', now, 7)).toBe(false);
    expect(isIstDateWithinLastDays('2026-08-19', now, 7)).toBe(false);
    expect(isIstDateWithinLastDays('not-a-date', now, 7)).toBe(false);
  });

  it('lists last 3 IST days, today, and next 3', () => {
    const now = Date.parse('2026-08-18T10:00:00.000Z'); // 15:30 IST
    expect(istDayStripAroundToday(now)).toEqual([
      '2026-08-15',
      '2026-08-16',
      '2026-08-17',
      '2026-08-18',
      '2026-08-19',
      '2026-08-20',
      '2026-08-21',
    ]);
  });

  it('accepts only dates on the ±3 IST day strip', () => {
    const now = Date.parse('2026-08-18T10:00:00.000Z');
    expect(isIstDateOnDayStrip('2026-08-15', now)).toBe(true);
    expect(isIstDateOnDayStrip('2026-08-21', now)).toBe(true);
    expect(isIstDateOnDayStrip('2026-08-14', now)).toBe(false);
    expect(isIstDateOnDayStrip('2026-08-22', now)).toBe(false);
    expect(isIstDateOnDayStrip('not-a-date', now)).toBe(false);
  });

  it('reads hour and minute in IST from a UTC instant', () => {
    // 2026-08-18 18:12 IST == 12:42 UTC
    const ms = Date.parse('2026-08-18T12:42:00.000Z');
    expect(istHourOf(ms)).toBe(18);
    expect(istMinuteOf(ms)).toBe(12);
  });
});
