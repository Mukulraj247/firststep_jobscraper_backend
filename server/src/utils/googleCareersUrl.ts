/**
 * Google Careers SPA emits path-relative links like `jobs/results/<id>-slug`.
 * Resolving them with `new URL(relative, base)` when `base` ends in `/jobs/results`
 * incorrectly drops the final segment and yields `/jobs/jobs/results/` (RFC 3986).
 * When `base` already ends with a trailing slash (`.../jobs/results/`), the same
 * relative path produces `/jobs/results/jobs/results/` instead.
 * Collapse both to the canonical `/jobs/results/` segment.
 *
 * @see https://www.google.com/about/careers/applications/jobs/results/...
 */
export function fixGoogleCareersJobsUrl(url: string): string {
  if (!url || typeof url !== 'string') return url;
  try {
    const u = new URL(url);
    if (!/^google\.com$/i.test(u.hostname) && !/\.google\.com$/i.test(u.hostname)) return url;
    if (!/\/about\/careers\/applications\/jobs\//i.test(u.pathname)) return url;

    // Collapse any repeated `jobs/results` join mistakes (and the older jobs/jobs/results form).
    let prev = '';
    while (prev !== u.pathname) {
      prev = u.pathname;
      u.pathname = u.pathname
        .replace(
          /\/about\/careers\/applications\/jobs\/jobs\/results(\/|$)/i,
          '/about/careers/applications/jobs/results$1'
        )
        .replace(
          /\/about\/careers\/applications\/jobs\/results\/jobs\/results(\/|$)/i,
          '/about/careers/applications/jobs/results$1'
        );
    }
    return u.href;
  } catch {
    return url;
  }
}
