/** Known Workday tenant slug → default external career site path segment. */
export const WORKDAY_TENANT_SITE_BY_TENANT: Record<string, string> = {
  broadcom: 'External_Career',
  nationwide: 'Nationwide',
};

export function workdayKnownSiteSlug(tenant: string): string | undefined {
  const key = String(tenant || '')
    .trim()
    .toLowerCase();
  return key ? WORKDAY_TENANT_SITE_BY_TENANT[key] : undefined;
}

const WORKDAY_LOCALE = 'en-US';

function workdayHostTenant(url: string): { host: string; tenant: string } | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const m = host.match(/^([a-z0-9-]+)\.wd\d+\.myworkdayjobs\.com$/i);
    if (!m) return null;
    return { host, tenant: m[1] };
  } catch {
    return null;
  }
}

function workdaySitePathSegments(pathname: string): string[] {
  const parts = String(pathname || '')
    .split('/')
    .filter(Boolean);
  const localeLike =
    /^(?:en|fr|de|es|pt|zh|ja|ko|it|nl|sv|da|fi|pl|tr|us|uk|ca|au|in|mx|br|cn|jp|kr)(?:-[a-z]{2})?$/i;
  const nonSite = /^(?:wday|cxs|job|jobs|details|search-results|search-jobs|job-search-results|home|careers|careers-home)$/i;
  return parts.filter((segment) => !localeLike.test(segment) && !nonSite.test(segment));
}

/** True when the URL is only the myworkdayjobs host (no career site path). */
export function isWorkdayHostOnlyUrl(url: string): boolean {
  try {
    if (!workdayHostTenant(url)) return false;
    return workdaySitePathSegments(new URL(url).pathname).length === 0;
  } catch {
    return false;
  }
}

/**
 * Upgrade hostname-only Workday boards to the public list shell
 * (`/en-US/{site}`) so CXS and Chromium land on rendered job cards.
 */
export function recommendedWorkdayListUrl(rawUrl: string): string | null {
  const hostTenant = workdayHostTenant(rawUrl);
  if (!hostTenant) return null;
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  if (workdaySitePathSegments(parsed.pathname).length > 0) return null;

  const site = workdayKnownSiteSlug(hostTenant.tenant) || 'External_Career';
  const dest = new URL(
    `${parsed.origin}/${WORKDAY_LOCALE}/${encodeURIComponent(site)}`
  );
  for (const [key, value] of parsed.searchParams.entries()) {
    if (!dest.searchParams.has(key)) dest.searchParams.append(key, value);
  }
  if (parsed.hash && !dest.hash) dest.hash = parsed.hash;
  return dest.toString();
}
