/**
 * Lightweight company label guess from a career/job page URL.
 * Used for instant extension UI pre-fill when the backend lookup is slow or unavailable.
 * Shared ATS hosts return '' so the server resolver can supply the real tenant name.
 */

const CAREER_SUBDOMAIN_NOISE = new Set([
  'www',
  'jobs',
  'job',
  'careers',
  'career',
  'hiring',
  'apply',
  'recruiting',
  'talent',
]);

const VENDOR_ATS_MARKERS = [
  'myworkdayjobs.com',
  'myworkdaysite.com',
  'icims.com',
  'greenhouse.io',
  'lever.co',
  'ashbyhq.com',
  'applicantpro.com',
  'jobvite.com',
  'bamboohr.com',
  'breezy.hr',
  'applytojob.com',
  'pinpointhq.com',
  'taleo.net',
  'smartrecruiters.com',
  'workable.com',
  'eightfold.ai',
  'dayforcehcm.com',
];

function titleCase(token: string): string {
  const t = String(token || '').trim();
  if (!t) return '';
  if (t.length <= 3) return t.toUpperCase();
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}

/** True when host is a multi-tenant ATS vendor (needs server-side tenant parse). */
export function isVendorAtsHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, '');
  return VENDOR_ATS_MARKERS.some((m) => h === m || h.endsWith(`.${m}`));
}

/**
 * Guess a display company name from a page URL.
 * e.g. jobs.apple.com → "Apple", careers.jpmorganchase.com → "Jpmorganchase"
 */
export function guessCompanyLabelFromUrl(raw: string): string {
  const input = String(raw || '').trim();
  if (!input || !/^https?:\/\//i.test(input)) return '';

  let host = '';
  try {
    host = new URL(input).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
  if (!host) return '';
  if (isVendorAtsHost(host)) return '';

  const parts = host.split('.').filter(Boolean);
  if (parts.length < 2) return '';

  // jobs.apple.com → apple ; careers.jpmorganchase.com → jpmorganchase
  let brand = parts[0];
  if (CAREER_SUBDOMAIN_NOISE.has(brand) && parts.length >= 3) {
    brand = parts[1];
  }

  if (!brand || CAREER_SUBDOMAIN_NOISE.has(brand) || brand.length < 2) return '';
  return titleCase(brand.replace(/-/g, ' '));
}

/** Resolve the page URL to use for company lookup (preview → active tab). */
export async function resolveExtensionPageUrl(previewUrl?: string | null): Promise<string> {
  const preview = String(previewUrl || '').trim();
  if (preview && /^https?:\/\//i.test(preview)) return preview;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const tabUrl = String(tab?.url || '').trim();
    if (tabUrl && /^https?:\/\//i.test(tabUrl)) return tabUrl;
  } catch {
    /* ignore */
  }
  return '';
}
