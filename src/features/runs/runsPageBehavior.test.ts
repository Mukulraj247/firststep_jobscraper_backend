import { describe, expect, it } from 'vitest';
import {
  RUNS_DATE_LOOKBACK_DAYS,
  activeFilterPills,
  clampRunsDate,
  defaultRunsDate,
  hasActiveRunFilters,
  runsDatePickerBounds,
} from './runsPageBehavior';

const NOW = Date.parse('2026-08-18T10:00:00.000Z'); // 15:30 IST

describe('Runs date filter', () => {
  it('defaults to today IST, not all-time', () => {
    expect(defaultRunsDate(NOW)).toBe('2026-08-18');
  });

  it('limits the date picker to the last 7 IST days', () => {
    expect(RUNS_DATE_LOOKBACK_DAYS).toBe(7);
    expect(runsDatePickerBounds(NOW)).toEqual({
      min: '2026-08-12',
      max: '2026-08-18',
    });
  });

  it('clamps empty, invalid, and out-of-range dates back to today IST', () => {
    expect(clampRunsDate('', NOW)).toBe('2026-08-18');
    expect(clampRunsDate('not-a-date', NOW)).toBe('2026-08-18');
    expect(clampRunsDate('2026-08-11', NOW)).toBe('2026-08-18');
    expect(clampRunsDate('2026-08-19', NOW)).toBe('2026-08-18');
    expect(clampRunsDate('2026-08-12', NOW)).toBe('2026-08-12');
  });

  it('does not treat today IST as an extra filter', () => {
    expect(
      hasActiveRunFilters(
        { searchInput: '', date: '2026-08-18', status: '', jobsAdded: '', duration: '' },
        NOW,
      ),
    ).toBe(false);
    expect(
      hasActiveRunFilters(
        { searchInput: '', date: '2026-08-17', status: '', jobsAdded: '', duration: '' },
        NOW,
      ),
    ).toBe(true);
  });

  it('pills a non-default date only', () => {
    expect(
      activeFilterPills(
        { searchInput: '', date: '2026-08-18', status: '', jobsAdded: '', duration: '' },
        NOW,
      ),
    ).toEqual([]);
    expect(
      activeFilterPills(
        { searchInput: '', date: '2026-08-12', status: '', jobsAdded: '', duration: '' },
        NOW,
      ),
    ).toEqual([{ key: 'date', label: 'Date: 2026-08-12' }]);
  });
});
