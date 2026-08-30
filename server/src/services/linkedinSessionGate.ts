import { hostnameFromUrl } from './scrapeBackpressure';

export const LINKEDIN_NO_SESSION_HINT =
  'LinkedIn requires a saved session (cookies) for cloud extraction. The Chrome extension works because it uses your logged-in tab. Add Automation cookies / enable reuseSession, or use an employer ATS careers URL instead.';

/** True for linkedin.com and www.linkedin.com (and other *.linkedin.com hosts). */
export function isLinkedInHost(hostname: string | null | undefined): boolean {
  if (!hostname) return false;
  const h = hostname.toLowerCase().replace(/^www\./, '');
  return h === 'linkedin.com' || h.endsWith('.linkedin.com');
}

/**
 * Cloud LinkedIn list runs without cookies/storageState hit a login wall and
 * burn ~2 minutes for 0 rows. Fail fast so the user gets a clear hint.
 */
export function shouldFailFastLinkedInWithoutSession(opts: {
  url?: string | null;
  cookies?: unknown;
  hasReusableStorageState?: boolean;
}): boolean {
  const host = hostnameFromUrl(opts.url);
  if (!isLinkedInHost(host)) return false;
  const hasCookies = Array.isArray(opts.cookies) && opts.cookies.length > 0;
  if (hasCookies) return false;
  if (opts.hasReusableStorageState) return false;
  return true;
}
