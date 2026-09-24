import { describe, expect, it } from 'vitest';
import {
  clusterFilterToFrozenInput,
  FEED_NEWEST_SORT,
} from './clusterFeed';
import { applyFrozenClusterFilters } from './jobBoardQuery';

describe('FEED_NEWEST_SORT', () => {
  it('orders by posting date first so UI "Newest first" matches card timestamps', () => {
    expect(Object.keys(FEED_NEWEST_SORT)[0]).toBe('date');
    expect(FEED_NEWEST_SORT.date).toBe(-1);
  });

  it('ranks newer postedAt ahead of recently re-scraped older postings', () => {
    const rows = [
      { id: 'old-but-rescraped', date: new Date('2026-03-01'), lastSeenAt: new Date('2026-03-23T12:00:00Z') },
      { id: 'genuinely-new', date: new Date('2026-03-22T17:00:00Z'), lastSeenAt: new Date('2026-03-22T18:00:00Z') },
      { id: 'mid', date: new Date('2026-03-10'), lastSeenAt: new Date('2026-03-23T11:00:00Z') },
    ];
    const sorted = [...rows].sort((a, b) => {
      const d = b.date.getTime() - a.date.getTime();
      if (d !== 0) return d;
      return b.lastSeenAt.getTime() - a.lastSeenAt.getTime();
    });
    expect(sorted.map((r) => r.id)).toEqual(['genuinely-new', 'mid', 'old-but-rescraped']);
  });
});

describe('clusterFilterToFrozenInput', () => {
  it('does not forward career-page URLs into the job source field', () => {
    const input = clusterFilterToFrozenInput(
      {
        frozenIndustries: [],
        frozenCategories: ['Software Development'],
        frozenExperienceLevels: [],
        frozenExperienceYears: [],
        frozenStates: [],
        locationIsRemote: null,
        excludeStudentEscape: true,
        companyNames: [],
        h1bSponsorFriendly: false,
      },
      {
        mode: 'source',
        sources: [
          'https://careers.google.com',
          'https://www.amazon.jobs',
          'hiring_cafe',
        ],
        companyNames: ['google', 'amazon'],
        robotMetaIds: ['robot-google', 'robot-amazon'],
      }
    );

    expect(input.sources).toEqual(['hiring_cafe']);
    expect(input.robotMetaIds).toEqual(['robot-google', 'robot-amazon']);
    expect(input.frozenCategories).toEqual(['Software Development']);
    expect(input.companyNames).toEqual(['google', 'amazon']);
  });

  it('builds an intersection query of robots + category tags', () => {
    const frozen = clusterFilterToFrozenInput(
      {
        frozenIndustries: [],
        frozenCategories: ['Software Development'],
        frozenExperienceLevels: ['Senior Level'],
        frozenExperienceYears: ['5-7'],
        frozenStates: [],
        locationIsRemote: null,
        excludeStudentEscape: true,
        companyNames: [],
        h1bSponsorFriendly: false,
      },
      {
        mode: 'source',
        sources: ['https://careers.meta.com'],
        companyNames: [],
        robotMetaIds: ['meta-robot'],
      }
    );

    const match = applyFrozenClusterFilters({ ownerId: 'ops', status: 'ready' }, frozen);
    const and = (match.$and || []) as Record<string, unknown>[];

    expect(and).toEqual(
      expect.arrayContaining([
        { robotMetaIds: { $in: ['meta-robot'] } },
        { frozenCategories: { $in: ['Software Development'] } },
        { frozenExperienceLevels: { $in: ['Senior Level'] } },
        { frozenExperienceYears: { $in: ['5-7'] } },
      ])
    );
    expect(match.source).toBeUndefined();
  });
});
