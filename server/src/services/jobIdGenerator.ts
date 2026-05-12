import JobIdCounter from '../models/JobIdCounter';

/** Two-letter month codes (UTC), index = getUTCMonth(). */
export const JOB_ID_MONTH_CODES = ['JA', 'FE', 'MR', 'AP', 'MY', 'JN', 'JL', 'AU', 'SE', 'OC', 'NO', 'DE'] as const;

export const categoryCodeFromJobTitle = (title: string): string => {
  const t = (title || '').trim();
  if (!t) return 'XX';
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length >= 2 && words[0] && words[1]) {
    const a = words[0].charAt(0);
    const b = words[1].charAt(0);
    const ca = /[a-zA-Z]/.test(a) ? a : 'X';
    const cb = /[a-zA-Z]/.test(b) ? b : 'X';
    return (ca + cb).toUpperCase();
  }
  if (words.length === 1 && words[0]) {
    const w = words[0].replace(/[^a-zA-Z0-9]/g, '');
    if (w.length >= 2) return w.substring(0, 2).toUpperCase();
    if (w.length === 1) return (w + 'X').toUpperCase();
  }
  return 'XX';
};

export const baseKeyForJobId = (jobTitle: string, date: Date): string => {
  const category = categoryCodeFromJobTitle(jobTitle);
  const day = String(date.getUTCDate()).padStart(2, '0');
  const monthCode = JOB_ID_MONTH_CODES[date.getUTCMonth()] ?? 'XX';
  return `${category}${day}${monthCode}`;
};

export type JobIdRowInput = { jobTitle: string; date: Date };

/**
 * Atomically reserves sequential suffixes per base key (CC + DD + MM).
 * Each row may use its own `date` (e.g. document `createdAt`) for the key.
 */
export const reserveStructuredJobIdsForRows = async (rows: JobIdRowInput[]): Promise<string[]> => {
  if (rows.length === 0) return [];

  const indicesByBase = new Map<string, number[]>();
  rows.forEach((row, index) => {
    const base = baseKeyForJobId(row.jobTitle, row.date);
    const list = indicesByBase.get(base) ?? [];
    list.push(index);
    indicesByBase.set(base, list);
  });

  const assigned = new Array<string>(rows.length);

  for (const [baseKey, indices] of indicesByBase) {
    const count = indices.length;
    const updated = await JobIdCounter.findOneAndUpdate(
      { _id: baseKey },
      { $inc: { seq: count } },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
    ).lean();

    const newSeq = typeof updated?.seq === 'number' ? updated.seq : count;
    const start = newSeq - count + 1;
    indices.forEach((rowIndex, offset) => {
      const n = start + offset;
      const suffix = String(n).padStart(3, '0');
      assigned[rowIndex] = `${baseKey}${suffix}`;
    });
  }

  return assigned;
};

/** Same-date batch helper (e.g. one persistence run at `createdAt`). */
export const reserveStructuredJobIds = async (jobTitles: string[], date: Date): Promise<string[]> =>
  reserveStructuredJobIdsForRows(jobTitles.map((jobTitle) => ({ jobTitle, date })));
