/**
 * Google Careers SPA emits path-relative links like `jobs/results/<id>-slug`.
 * Resolving them with `new URL(relative, base)` when `base` ends in `/jobs/results`
 * incorrectly drops the final segment and yields `/jobs/jobs/results/` (RFC 3986).
 * Collapse to the canonical `/jobs/results/` segment.
 *
 * @see https://www.google.com/about/careers/applications/jobs/results/...
 */
export function fixGoogleCareersJobsUrl(url: string): string {
  if (!url || typeof url !== 'string') return url;
  try {
    const u = new URL(url);
    if (!/^google\.com$/i.test(u.hostname) && !/\.google\.com$/i.test(u.hostname)) return url;
    if (!u.pathname.includes('/about/careers/applications/jobs/jobs/results')) return url;
    u.pathname = u.pathname.replace(
      /\/about\/careers\/applications\/jobs\/jobs\/results(\/|$)/i,
      '/about/careers/applications/jobs/results$1'
    );
    return u.href;
  } catch {
    return url;
  }
}
