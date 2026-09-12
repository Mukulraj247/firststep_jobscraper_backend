/**
 * Load modal frozenStates from recent US jobs for the same company name.
 * Used as a soft signal for ambiguous city disambiguation.
 */
import JobBoardListing from '../models/JobBoardListing';

export async function loadCompanyHistoricalStates(
  companyName: string,
  limit = 25
): Promise<string[]> {
  const name = String(companyName || '').trim();
  if (!name || name.length < 2) return [];

  try {
    const rows = await JobBoardListing.find({
      companyName: name,
      locationIsUs: true,
      frozenStates: { $exists: true, $not: { $size: 0 } },
    })
      .select('frozenStates')
      .sort({ lastSeenAt: -1 })
      .limit(limit)
      .lean();

    const counts = new Map<string, number>();
    for (const row of rows) {
      const states = Array.isArray((row as any).frozenStates)
        ? (row as any).frozenStates
        : [];
      for (const s of states) {
        const code = String(s || '')
          .trim()
          .toUpperCase();
        if (code.length !== 2) continue;
        counts.set(code, (counts.get(code) || 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([code]) => code);
  } catch {
    return [];
  }
}
