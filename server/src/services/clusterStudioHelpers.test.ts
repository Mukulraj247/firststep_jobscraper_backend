import { describe, expect, it } from 'vitest';
import {
  buildFiltersSummary,
  curatedHasFilters,
  customHasPendingUrls,
  customHasSources,
  normalizeFilter,
  requestToClusterFilter,
  resolveSourceMode,
} from './clusterStudioHelpers';

describe('normalizeFilter', () => {
  it('uppercases states and defaults excludeStudentEscape', () => {
    const f = normalizeFilter({
      frozenStates: ['ca', ' ny '],
      frozenIndustries: ['Tech'],
    });
    expect(f.frozenStates).toEqual(['CA', 'NY']);
    expect(f.frozenIndustries).toEqual(['Tech']);
    expect(f.excludeStudentEscape).toBe(true);
    expect(f.locationIsRemote).toBeNull();
  });
});

describe('buildFiltersSummary', () => {
  it('rebuilds chips from filter dimensions and marks custom', () => {
    const summary = buildFiltersSummary({
      kind: 'custom',
      filter: {
        frozenIndustries: ['Healthcare'],
        frozenCategories: [],
        frozenStates: ['TX'],
        frozenExperienceLevels: [],
        companyNames: [],
        locationIsRemote: true,
        h1bSponsorFriendly: true,
      },
    });
    expect(summary).toEqual(['Healthcare', 'TX', 'Remote', 'H-1B', 'Custom']);
  });
});

describe('curatedHasFilters', () => {
  it('rejects empty curated filters', () => {
    expect(curatedHasFilters(normalizeFilter({}))).toBe(false);
  });

  it('accepts remote-only or industry filters', () => {
    expect(curatedHasFilters(normalizeFilter({ locationIsRemote: true }))).toBe(true);
    expect(curatedHasFilters(normalizeFilter({ frozenIndustries: ['Finance'] }))).toBe(true);
  });
});

describe('customHasSources', () => {
  it('requires at least one bound robot (career URLs alone are not enough)', () => {
    expect(customHasSources({ sources: [], robotMetaIds: [] })).toBe(false);
    expect(customHasSources({ sources: ['https://example.com/careers'], robotMetaIds: [] })).toBe(
      false
    );
    expect(customHasSources({ sources: [], robotMetaIds: ['meta-1'] })).toBe(true);
    expect(
      customHasSources({ sources: ['https://example.com/careers'], robotMetaIds: ['meta-1'] })
    ).toBe(true);
  });

  it('detects pending URL-only drafts', () => {
    expect(customHasPendingUrls({ sources: ['https://a.com'], robotMetaIds: [] })).toBe(true);
    expect(customHasPendingUrls({ sources: ['https://a.com'], robotMetaIds: ['r1'] })).toBe(false);
  });
});

describe('resolveSourceMode', () => {
  it('maps kind to binding mode', () => {
    expect(resolveSourceMode('curated')).toBe('filter');
    expect(resolveSourceMode('custom')).toBe('source');
  });
});

describe('requestToClusterFilter', () => {
  it('maps titles, experience levels, and YOE range into frozen filters', () => {
    const filter = requestToClusterFilter({
      industries: ['Technology'],
      roles: ['Software Development', 'Level: Senior Level'],
      locations: ['ca', 'NY'],
      companies: ['google'],
      experienceLevels: ['Mid-Senior Level'],
      experienceMin: 3,
      experienceMax: 10,
    });
    expect(filter.frozenIndustries).toEqual(['Technology']);
    expect(filter.frozenCategories).toEqual(['Software Development']);
    expect(filter.frozenStates).toEqual(['CA', 'NY']);
    expect(filter.frozenExperienceLevels).toEqual(['Mid-Senior Level', 'Senior Level']);
    expect(filter.frozenExperienceYears).toEqual(['3-5', '5-7', '7-10']);
    expect(filter.companyNames).toEqual(['google']);
    expect(filter.excludeStudentEscape).toBe(true);
  });

  it('returns empty year bands when min/max omitted', () => {
    const filter = requestToClusterFilter({
      roles: ['Data Science'],
    });
    expect(filter.frozenCategories).toEqual(['Data Science']);
    expect(filter.frozenExperienceYears).toEqual([]);
  });
});
