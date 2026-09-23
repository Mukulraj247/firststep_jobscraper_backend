import { describe, expect, it } from 'vitest';
import {
  applyFrozenClusterFilters,
  applyJobBoardListFilters,
  addedSinceFromPreset,
} from './jobBoardQuery';
import { clusterFilterToFrozenInput, clusterToJobQuery } from './clusterFeed';

describe('applyJobBoardListFilters', () => {
  it('filters added date on createdAt, not scraped date', () => {
    const since = new Date('2026-08-18T11:00:00.000Z');
    const match = applyJobBoardListFilters({ ownerId: 'u1' }, { addedSince: since });
    expect(match.createdAt).toEqual({ $gte: since });
    expect(JSON.stringify(match)).not.toContain('"date":');
  });

  it('filters lastSeenAt for cluster feed windows', () => {
    const since = new Date('2026-08-18T11:00:00.000Z');
    const match = applyJobBoardListFilters({ ownerId: 'u1' }, { lastSeenSince: since });
    expect(match.lastSeenAt).toEqual({ $gte: since });
    expect(match.createdAt).toBeUndefined();
  });

  it('parses 12h preset', () => {
    const now = Date.parse('2026-01-15T12:00:00.000Z');
    expect(addedSinceFromPreset('12h', now)?.toISOString()).toBe('2026-01-15T00:00:00.000Z');
  });

  it('matches location, work mode, and job type on listing and snapshot fields', () => {
    const match = applyJobBoardListFilters(
      { ownerId: 'u1' },
      { location: 'Bengaluru', workMode: 'Remote', jobType: 'Full time' },
    );
    const and = match.$and as Record<string, unknown>[];
    expect(and.length).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(and)).toContain('location');
    expect(JSON.stringify(and)).toMatch(/remoteType/i);
    expect(JSON.stringify(and)).toMatch(/employmentType/i);
  });

  it('filters combined aggregator sources', () => {
    const match = applyJobBoardListFilters({ ownerId: 'u1' }, { source: 'aggregator' });
    const and = match.$and as Record<string, unknown>[];
    expect(and).toEqual([
      {
        source: {
          $in: [
            'hiring_cafe',
            'linkedin',
            'accel',
            'sequoia',
            'capitalg',
            'choppingblock',
            'aidevboard',
            'startups_gallery',
          ],
        },
      },
    ]);
  });
});

describe('applyFrozenClusterFilters', () => {
  it('applies frozen $in filters and excludes studentEscape by default', () => {
    const match = applyFrozenClusterFilters(
      { ownerId: 'u1', status: 'ready' },
      {
        frozenIndustries: ['Banking'],
        frozenCategories: ['Software Engineering'],
        frozenStates: ['NJ'],
      },
    );
    const and = match.$and as Record<string, unknown>[];
    expect(and).toEqual(
      expect.arrayContaining([
        { frozenIndustries: { $in: ['Banking'] } },
        { frozenCategories: { $in: ['Software Engineering'] } },
        { frozenStates: { $in: ['NJ'] } },
        { studentEscape: { $ne: true } },
      ]),
    );
  });

  it('binds source-mode robotMetaIds', () => {
    const match = applyFrozenClusterFilters(
      { ownerId: 'u1' },
      { robotMetaIds: ['meta-1', 'meta-2'] },
    );
    expect(match.$and).toEqual(
      expect.arrayContaining([
        { robotMetaIds: { $in: ['meta-1', 'meta-2'] } },
        { studentEscape: { $ne: true } },
      ]),
    );
  });
});

describe('clusterToJobQuery', () => {
  it('translates cluster filter into board match', () => {
    const match = clusterToJobQuery(
      {
        filter: {
          frozenIndustries: ['Big Tech'],
          frozenCategories: ['Software Engineering'],
          frozenExperienceLevels: [],
          frozenExperienceYears: [],
          frozenStates: ['CA'],
          excludeStudentEscape: true,
        },
        sourceBinding: { mode: 'filter', sources: [], companyNames: [], robotMetaIds: [] },
      },
      'ops-owner',
    );
    expect(match.ownerId).toBe('ops-owner');
    expect(match.status).toBe('ready');
    expect(JSON.stringify(match)).toContain('Big Tech');
    expect(JSON.stringify(match)).toContain('Software Engineering');
  });

  it('merges source binding companies for custom clusters', () => {
    const frozen = clusterFilterToFrozenInput(
      {
        frozenIndustries: [],
        frozenCategories: ['Software Engineering'],
        frozenExperienceLevels: ['Entry Level'],
        frozenExperienceYears: [],
        frozenStates: [],
      },
      {
        mode: 'source',
        sources: [],
        companyNames: ['TCS', 'Infosys'],
        robotMetaIds: ['r1'],
      },
    );
    expect(frozen.companyNames).toEqual(['TCS', 'Infosys']);
    expect(frozen.robotMetaIds).toEqual(['r1']);
  });
});
