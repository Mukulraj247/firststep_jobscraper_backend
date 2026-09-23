function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const ADDED_MS: Record<string, number> = {
  '1h': 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '12h': 12 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
};

export function addedSinceFromPreset(preset: string, nowMs: number = Date.now()): Date | null {
  const ms = ADDED_MS[String(preset || '').trim()];
  if (!ms) return null;
  return new Date(nowMs - ms);
}

function looseFieldRegex(value: string): RegExp {
  const pattern = escapeRegex(value.trim()).replace(/[\s-]+/g, '[\\s-]*');
  return new RegExp(pattern, 'i');
}

function orField(field: string, snapshotField: string, re: RegExp): Record<string, unknown> {
  return { $or: [{ [field]: re }, { [snapshotField]: re }] };
}

export type JobBoardListFilterInput = {
  /** Filter on createdAt (legacy job-board `added` param). */
  addedSince?: Date | null;
  /** Filter on lastSeenAt (cluster feed freshness window). */
  lastSeenSince?: Date | null;
  location?: string;
  workMode?: string;
  jobType?: string;
  /** e.g. hiring_cafe — empty means all sources */
  source?: string;
};

export type JobBoardFrozenFilterInput = {
  frozenIndustries?: string[];
  frozenCategories?: string[];
  frozenExperienceLevels?: string[];
  frozenExperienceYears?: string[];
  frozenStates?: string[];
  locationIsRemote?: boolean | null;
  excludeStudentEscape?: boolean;
  companyNames?: string[];
  companyIds?: string[];
  h1bSponsorFriendly?: boolean;
  robotMetaIds?: string[];
  sources?: string[];
};

export function applyJobBoardListFilters(
  match: Record<string, any>,
  filters: JobBoardListFilterInput,
): Record<string, any> {
  const next = { ...match };
  const and: Record<string, unknown>[] = [...(Array.isArray(next.$and) ? next.$and : [])];

  if (filters.addedSince) {
    next.createdAt = { $gte: filters.addedSince };
  }

  if (filters.lastSeenSince) {
    next.lastSeenAt = { $gte: filters.lastSeenSince };
  }

  const source = String(filters.source || '').trim();
  if (source === 'aggregator') {
    and.push({
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
    });
  } else if (source) {
    next.source = source;
  }

  const location = String(filters.location || '').trim();
  if (location) {
    and.push(orField('location', 'listSnapshot.location', looseFieldRegex(location)));
  }

  const workMode = String(filters.workMode || '').trim();
  if (workMode) {
    and.push(orField('remoteType', 'listSnapshot.remoteType', looseFieldRegex(workMode)));
  }

  const jobType = String(filters.jobType || '').trim();
  if (jobType) {
    and.push(orField('employmentType', 'listSnapshot.employmentType', looseFieldRegex(jobType)));
  }

  if (and.length) next.$and = and;
  return next;
}

/**
 * Apply frozen taxonomy / cluster-definition filters onto a board match.
 * Indexed `$in` only — no regex on frozen fields.
 */
export function applyFrozenClusterFilters(
  match: Record<string, any>,
  filters: JobBoardFrozenFilterInput,
): Record<string, any> {
  const next = { ...match };
  const and: Record<string, unknown>[] = [...(Array.isArray(next.$and) ? next.$and : [])];

  const pushIn = (field: string, values?: string[]) => {
    const cleaned = (values || []).map((v) => String(v || '').trim()).filter(Boolean);
    if (cleaned.length) and.push({ [field]: { $in: cleaned } });
  };

  pushIn('frozenIndustries', filters.frozenIndustries);
  pushIn('frozenCategories', filters.frozenCategories);
  pushIn('frozenExperienceLevels', filters.frozenExperienceLevels);
  pushIn('frozenExperienceYears', filters.frozenExperienceYears);
  pushIn('frozenStates', filters.frozenStates);

  if (filters.locationIsRemote === true) {
    and.push({ locationIsRemote: true });
  } else if (filters.locationIsRemote === false) {
    and.push({ locationIsRemote: { $ne: true } });
  }

  if (filters.excludeStudentEscape !== false) {
    and.push({ studentEscape: { $ne: true } });
  }

  const companyNames = (filters.companyNames || [])
    .map((c) => String(c || '').trim())
    .filter(Boolean);
  if (companyNames.length) {
    const companyOr = companyNames.flatMap((name) => {
      const re = new RegExp(`^${escapeRegex(name)}$`, 'i');
      return [
        { companyName: re },
        { 'listSnapshot.companyName': re },
        { companyResolvedName: re },
      ];
    });
    and.push({ $or: companyOr });
  }

  const companyIds = (filters.companyIds || [])
    .map((id) => String(id || '').trim())
    .filter(Boolean);
  if (companyIds.length) {
    and.push({ companyId: { $in: companyIds } });
  }

  if (filters.h1bSponsorFriendly) {
    and.push({
      h1bEligible: true,
      h1bCompanyScore: 'high',
      h1bMappingStatus: { $in: ['auto', 'approved'] },
    });
  }

  const robotMetaIds = (filters.robotMetaIds || [])
    .map((id) => String(id || '').trim())
    .filter(Boolean);
  if (robotMetaIds.length) {
    and.push({ robotMetaIds: { $in: robotMetaIds } });
  }

  const sources = (filters.sources || []).map((s) => String(s || '').trim()).filter(Boolean);
  if (sources.length === 1) {
    next.source = sources[0];
  } else if (sources.length > 1) {
    and.push({ source: { $in: sources } });
  }

  if (and.length) next.$and = and;
  return next;
}
