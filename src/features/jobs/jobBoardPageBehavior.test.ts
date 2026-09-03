import { describe, expect, it } from 'vitest';
import {
  ADDED_DATE_PRESETS,
  JOB_BOARD_FILTER_CONTROLS,
  JOB_BOARD_SOURCE_OPTIONS,
  addedSinceMs,
  formatFacetOptionLabel,
  formatJobBoardDate,
  formatRunJobAddedAt,
  hasActiveJobBoardFilters,
  jobBoardHidesScrollbar,
  jobBoardPageRootOverflow,
  jobBoardScrollSx,
  JOB_BOARD_HERO_LAYOUT,
  orderFrozenCategories,
  resolveJobDisplayInstant,
} from './jobBoardPageBehavior';

const NOW = Date.parse('2026-08-18T12:00:00.000Z');

describe('job board filters', () => {
  it('exposes search, added date, category, frozen category, location, work mode, and job type — not company', () => {
    expect([...JOB_BOARD_FILTER_CONTROLS]).toEqual([
      'search',
      'added',
      'category',
      'frozenCategory',
      'location',
      'workMode',
      'jobType',
    ]);
    expect(JOB_BOARD_FILTER_CONTROLS).not.toContain('company');
  });

  it('offers added-date presets last 1h / 6h / 24h / 7d / all', () => {
    expect(ADDED_DATE_PRESETS.map((preset) => preset.value)).toEqual([
      '1h',
      '6h',
      '24h',
      '7d',
      'all',
    ]);
  });

  it('source chips are All and Aggregator only — Hiring Cafe and Accel stay under Aggregator', () => {
    expect(JOB_BOARD_SOURCE_OPTIONS.map((option) => option.value)).toEqual(['all', 'aggregator']);
    expect(JOB_BOARD_SOURCE_OPTIONS.map((option) => option.value)).not.toContain('hiring_cafe');
    expect(JOB_BOARD_SOURCE_OPTIONS.map((option) => option.value)).not.toContain('accel');
    expect(JOB_BOARD_SOURCE_OPTIONS.map((option) => option.value)).not.toContain('linkedin');
  });

  it('maps added-date presets to createdAt lookback windows', () => {
    expect(addedSinceMs('1h', NOW)).toBe(NOW - 60 * 60 * 1000);
    expect(addedSinceMs('6h', NOW)).toBe(NOW - 6 * 60 * 60 * 1000);
    expect(addedSinceMs('24h', NOW)).toBe(NOW - 24 * 60 * 60 * 1000);
    expect(addedSinceMs('7d', NOW)).toBe(NOW - 7 * 24 * 60 * 60 * 1000);
    expect(addedSinceMs('all', NOW)).toBeNull();
  });

  it('treats default all-time as inactive extra filters', () => {
    expect(
      hasActiveJobBoardFilters({
        q: '',
        added: 'all',
        category: '',
        location: '',
        workMode: '',
        jobType: '',
      }),
    ).toBe(false);
    expect(
      hasActiveJobBoardFilters({
        q: 'google',
        added: 'all',
        category: '',
        location: '',
        workMode: '',
        jobType: '',
      }),
    ).toBe(true);
  });

  it('counts a frozen category selection as an active filter', () => {
    const base = {
      q: '',
      added: 'all' as const,
      category: '',
      location: '',
      workMode: '',
      jobType: '',
    };
    expect(hasActiveJobBoardFilters({ ...base, frozenCategories: [] })).toBe(false);
    expect(hasActiveJobBoardFilters({ ...base, frozenCategories: ['DevOps'] })).toBe(true);
  });
});

describe('orderFrozenCategories', () => {
  const FACET = ['Backend Development', 'Data Engineering', 'DevOps'];

  it('sorts by facet order rather than click order', () => {
    expect(orderFrozenCategories(['DevOps', 'Backend Development'], FACET)).toEqual([
      'Backend Development',
      'DevOps',
    ]);
  });

  it('produces the same selection regardless of the order the user clicked', () => {
    const a = orderFrozenCategories(['DevOps', 'Data Engineering'], FACET);
    const b = orderFrozenCategories(['Data Engineering', 'DevOps'], FACET);
    expect(a).toEqual(b);
  });

  it('keeps names the facet no longer offers at the end instead of dropping them', () => {
    expect(orderFrozenCategories(['Retired Category', 'DevOps'], FACET)).toEqual([
      'DevOps',
      'Retired Category',
    ]);
  });

  it('trims, and drops blanks and duplicates', () => {
    expect(orderFrozenCategories(['  DevOps ', 'DevOps', '', '   '], FACET)).toEqual(['DevOps']);
  });

  it('lets the whole job board (header + filters + cards) scroll as one section', () => {
    expect(jobBoardPageRootOverflow()).toBe('visible');
  });

  it('splits the hero into title + filters and hides the job board scrollbar', () => {
    expect(JOB_BOARD_HERO_LAYOUT).toBe('split');
    expect(jobBoardHidesScrollbar()).toBe(true);
    expect(jobBoardScrollSx().overflow).toBe('auto');
    expect(jobBoardScrollSx().scrollbarWidth).toBe('none');
  });

  it('shortens long location facet labels for the typeahead', () => {
    expect(formatFacetOptionLabel('Bengaluru')).toBe('Bengaluru');
    expect(
      formatFacetOptionLabel(
        'Hyderabad, Telangana, India, Multiple cities across the metro region',
      ),
    ).toBe('Hyderabad, Telangana, India, Multiple cit…');
  });
});

describe('job board dates', () => {
  it('falls back to createdAt when posted date is invalid or in the future', () => {
    const created = Date.parse('2026-08-10T08:00:00.000Z');
    expect(resolveJobDisplayInstant('not-a-date', created, NOW)).toBe(created);
    expect(resolveJobDisplayInstant('2026-12-01T00:00:00.000Z', created, NOW)).toBe(created);
    expect(resolveJobDisplayInstant('2026-08-12T00:00:00.000Z', created, NOW)).toBe(
      Date.parse('2026-08-12T00:00:00.000Z'),
    );
  });

  it('formats display dates as DD MMM YYYY in IST', () => {
    // 2026-08-18 00:30 IST == 2026-08-17 19:00 UTC
    expect(formatJobBoardDate('2026-08-17T19:00:00.000Z')).toBe('18 Aug 2026');
    // US-ambiguous 10-8-2026 must not become October
    expect(formatJobBoardDate('2026-08-10T06:00:00.000Z')).toBe('10 Aug 2026');
  });

  it('formats View jobs added timestamps as DD MMM YYYY, h:mm AM/PM IST', () => {
    expect(formatRunJobAddedAt('2026-08-19T00:44:00.000Z')).toBe('19 Aug 2026, 6:14 AM IST');
    expect(formatRunJobAddedAt(null)).toBe('');
  });
});
