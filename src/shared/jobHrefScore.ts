/**
 * Rank candidate hrefs from a job-list card.
 * `/jobs` (board index) must never outrank `/job/{slug}` (a posting).
 */
export function scoreJobHrefPath(pathname: string, absLower: string = ''): number {
  const p = (pathname || '').toLowerCase().replace(/\/+$/, '') || '/';
  let score = 12 + Math.min(pathname.length, 120) / 40;

  const listingOnly =
    p === '/jobs' ||
    p === '/job' ||
    p === '/careers' ||
    p === '/career' ||
    p === '/search' ||
    (p.endsWith('/jobs') && !/\/jobs\/.+/i.test(p));

  const posting =
    /\/job\/[^/]+/i.test(p) ||
    /\/jobs\/\d+/i.test(p) ||
    /\/jobs\/listing\/[^/]+/i.test(p) ||
    /\/jobs\/[^/]{6,}/i.test(p);

  if (listingOnly) score -= 120;
  if (posting) score += 220;
  else {
    if (p.includes('job-detail') || p.includes('jobdetail')) score += 75;
    if (p.includes('/career')) score += 38;
  }
  if (absLower.includes('amazon.jobs') && p.length > 15) score += 15;
  return score;
}
