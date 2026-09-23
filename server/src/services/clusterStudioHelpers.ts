/**
 * Shared Cluster Studio ops helpers — filters summary, normalize, publish guards.
 * Keep in sync with portal feed: patched filters must flow through applyFrozenClusterFilters.
 */

import {
  bandsOverlappingYearRange,
  normalizeExperienceLevelFilter,
} from '../../../src/shared/frozenExperience';

export type NormalizedClusterFilter = {
  frozenIndustries: string[];
  frozenCategories: string[];
  frozenExperienceLevels: string[];
  frozenExperienceYears: string[];
  frozenStates: string[];
  locationIsRemote: boolean | null;
  excludeStudentEscape: boolean;
  companyNames: string[];
  h1bSponsorFriendly: boolean;
};

export function normalizeFilter(raw: any): NormalizedClusterFilter {
  const arr = (v: unknown) =>
    Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : [];
  return {
    frozenIndustries: arr(raw?.frozenIndustries),
    frozenCategories: arr(raw?.frozenCategories),
    frozenExperienceLevels: arr(raw?.frozenExperienceLevels),
    frozenExperienceYears: arr(raw?.frozenExperienceYears),
    frozenStates: arr(raw?.frozenStates).map((s: string) => s.toUpperCase()),
    locationIsRemote:
      raw?.locationIsRemote === true ? true : raw?.locationIsRemote === false ? false : null,
    excludeStudentEscape: raw?.excludeStudentEscape !== false,
    companyNames: arr(raw?.companyNames),
    h1bSponsorFriendly: Boolean(raw?.h1bSponsorFriendly),
  };
}

export function buildFiltersSummary(body: {
  kind?: string;
  filter?: Partial<NormalizedClusterFilter> | null;
}): string[] {
  const parts: string[] = [];
  for (const list of [
    body?.filter?.frozenIndustries,
    body?.filter?.frozenCategories,
    body?.filter?.frozenStates,
    body?.filter?.frozenExperienceLevels,
    body?.filter?.companyNames,
  ]) {
    if (Array.isArray(list)) parts.push(...list.map((x: unknown) => String(x).trim()).filter(Boolean));
  }
  if (body?.filter?.locationIsRemote) parts.push('Remote');
  if (body?.filter?.h1bSponsorFriendly) parts.push('H-1B');
  if (body?.kind === 'custom') parts.push('Custom');
  return [...new Set(parts)].slice(0, 12);
}

/** Curated clusters must have at least one browse dimension before publish. */
export function curatedHasFilters(filter: NormalizedClusterFilter): boolean {
  return (
    filter.frozenIndustries.length > 0 ||
    filter.frozenCategories.length > 0 ||
    filter.frozenStates.length > 0 ||
    filter.frozenExperienceLevels.length > 0 ||
    filter.frozenExperienceYears.length > 0 ||
    filter.companyNames.length > 0 ||
    filter.locationIsRemote === true ||
    filter.h1bSponsorFriendly === true
  );
}

/** Custom clusters must have at least one bound robot before publish. */
export function customHasSources(sourceBinding: {
  sources?: string[] | null;
  robotMetaIds?: string[] | null;
} | null | undefined): boolean {
  return (sourceBinding?.robotMetaIds || []).filter(Boolean).length > 0;
}

/** True when a custom cluster has career URLs but no robots yet (draft OK, publish blocked). */
export function customHasPendingUrls(sourceBinding: {
  sources?: string[] | null;
  robotMetaIds?: string[] | null;
} | null | undefined): boolean {
  const urls = (sourceBinding?.sources || []).filter(Boolean).length;
  const robots = (sourceBinding?.robotMetaIds || []).filter(Boolean).length;
  return urls > 0 && robots === 0;
}

/** Invariants: curated → filter mode; custom → source mode. */
export function resolveSourceMode(kind: 'curated' | 'custom' | string): 'filter' | 'source' {
  return kind === 'custom' ? 'source' : 'filter';
}

/** Map a portal cluster request into a Cluster.filter seed. */
export function requestToClusterFilter(request: {
  industries?: string[] | null;
  roles?: string[] | null;
  locations?: string[] | null;
  companies?: string[] | null;
  experienceLevels?: string[] | null;
  experienceMin?: number | null;
  experienceMax?: number | null;
}): NormalizedClusterFilter {
  const roles = (request.roles || []).filter((r) => !String(r).startsWith('Level:'));
  const legacyLevels = (request.roles || [])
    .map((r) => {
      const m = /^Level:\s*(.+)$/i.exec(String(r));
      return m?.[1]?.trim() || '';
    })
    .filter(Boolean);
  const experienceLevels = normalizeExperienceLevelFilter([
    ...(request.experienceLevels || []),
    ...legacyLevels,
  ]);
  const frozenExperienceYears = bandsOverlappingYearRange(
    request.experienceMin ?? null,
    request.experienceMax ?? null
  );
  return normalizeFilter({
    frozenIndustries: request.industries || [],
    frozenCategories: roles,
    frozenStates: (request.locations || [])
      .map((l: string) => String(l).toUpperCase())
      .filter((l: string) => l.length === 2),
    frozenExperienceLevels: experienceLevels,
    frozenExperienceYears,
    companyNames: request.companies || [],
    excludeStudentEscape: true,
  });
}
