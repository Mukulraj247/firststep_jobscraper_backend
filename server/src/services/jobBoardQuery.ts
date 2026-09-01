function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const ADDED_MS: Record<string, number> = {
  '1h': 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
};

export function addedSinceFromPreset(preset: string, nowMs: number = Date.now()): Date | null {
  const ms = ADDED_MS[String(preset || '').trim()];
  if (!ms) return null;
  return new Date(nowMs - ms);
}

function looseFieldRegex(value: string): RegExp {
  const pattern = escapeRegex(value.trim())
    .replace(/[\s-]+/g, '[\\s-]*');
  return new RegExp(pattern, 'i');
}

function orField(field: string, snapshotField: string, re: RegExp): Record<string, unknown> {
  return { $or: [{ [field]: re }, { [snapshotField]: re }] };
}

export type JobBoardListFilterInput = {
  addedSince?: Date | null;
  location?: string;
  workMode?: string;
  jobType?: string;
  /** e.g. hiring_cafe — empty means all sources */
  source?: string;
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
