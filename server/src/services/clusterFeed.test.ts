import { describe, expect, it } from 'vitest';
import { clusterFilterToFrozenInput } from './clusterFeed';
import { applyFrozenClusterFilters } from './jobBoardQuery';

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
