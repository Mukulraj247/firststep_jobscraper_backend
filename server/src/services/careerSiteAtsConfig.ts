import { DIRECTORY_PHENOM_BOARD_HOSTS } from './phenomBoardHostsDirectory';
import {
  FINDLY_BOARD_HOSTS,
  FINDLY_RECOMMENDED_LIST_URL_BY_HOST,
} from './findlyBoardHostsDirectory';
import {
  looksLikeFindlyBoard,
  looksLikePhenomBoard,
  looksLikeTalentBrewBoard,
  looksLikeWorkdayBoard,
  isSmartRecruitersVanityHost,
  smartRecruitersVanityJobsPath,
  isHappyDanceBoardHost,
} from './atsAdapters';
import {
  isTalentBrewWorkdayHost,
  talentBrewWorkdayBoardUrl,
} from './talentBrewWorkdayHostsDirectory';
import { isWorkdayHostOnlyUrl, recommendedWorkdayListUrl } from './workdayBoardHostsDirectory';
import { jibeCareerBoardConfig } from './jibeBoardHostsDirectory';
import { zwayamCareerBoardConfig } from './zwayamBoardHostsDirectory';

/**
 * Phenom list shells from docs/career-ats-ready-start-urls.csv (mode=phenom_try).
 * Regenerate: node server/scripts/gen-phenom-list-urls.cjs
 */
export const PHENOM_RECOMMENDED_LIST_URL_BY_HOST: Record<string, string> = {
  'careers.jpmorgan.com': 'https://careers.jpmorgan.com/us/en/search-results',
  'jobs.citi.com': 'https://jobs.citi.com/us/en/search-results',
  'jobs.pnc.com': 'https://jobs.pnc.com/us/en/search-results',
  'careers.truist.com': 'https://careers.truist.com/us/en/search-results',
  'capitalonecareers.com': 'https://www.capitalonecareers.com/us/en/search-results',
  'jobs.bnymellon.com': 'https://jobs.bnymellon.com/us/en/search-results',
  'careers.statestreet.com': 'https://careers.statestreet.com/us/en/search-results',
  'jobs.truist.com': 'https://jobs.truist.com/us/en/search-results',
  'careers.key.com': 'https://careers.key.com/us/en/search-results',
  'careers.comerica.com': 'https://careers.comerica.com/us/en/search-results',
  'jobs.citizensbank.com': 'https://jobs.citizensbank.com/us/en/search-results',
  'jobs.libertymutualgroup.com': 'https://jobs.libertymutualgroup.com/us/en/search-results',
  'usaajobs.com': 'https://www.usaajobs.com/us/en/search-results',
  'jobs.farmersinsurance.com': 'https://jobs.farmersinsurance.com/us/en/search-results',
  'careers.amfam.com': 'https://careers.amfam.com/us/en/search-results',
  'careers.chubb.com': 'https://careers.chubb.com/us/en/search-results',
  'jobs.metlife.com': 'https://jobs.metlife.com/us/en/search-results',
  'jobs.cigna.com': 'https://jobs.cigna.com/us/en/search-results',
  'jobs.newyorklife.com': 'https://jobs.newyorklife.com/us/en/search-results',
  'jobs.assurant.com': 'https://jobs.assurant.com/us/en/search-results',
};

/** HappyDance PHB list shells (locale /en/jobs/). */
export const HAPPYDANCE_RECOMMENDED_LIST_URL_BY_HOST: Record<string, string> = {
  'wellsfargojobs.com': 'https://www.wellsfargojobs.com/en/jobs/',
  'careers.box.com': 'https://careers.box.com/en/jobs/',
  'careers.nutanix.com': 'https://careers.nutanix.com/en/jobs/',
};

function normalizedHost(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** True when pathname is already a Phenom job-list shell (not homepage/marketing). */
export function isPhenomListShellPath(pathname: string): boolean {
  const path = String(pathname || '').replace(/\/+$/, '') || '/';
  if (/\/(?:[a-z]{2}(?:-[a-z]{2})?\/)*search-results$/i.test(path)) return true;
  if (/\/search-jobs$/i.test(path)) return true;
  if (/\/(?:[a-z]{2}(?:-[a-z]{2})?\/)+c\/[a-z0-9-]+$/i.test(path)) return true;
  // Widgets list shells: /jobs, /global-en/jobs, /us/en/jobs (Cognizant, etc.)
  if (/\/(?:[a-z]{2}(?:-[a-z]{2})?\/)*jobs$/i.test(path)) return true;
  // Qualcomm / NVIDIA-style PCS list at /careers
  if (/^\/careers$/i.test(path)) return true;
  return false;
}

function defaultPhenomListUrl(origin: string, host: string): string {
  return `${origin}/us/en/search-results`;
}

function recommendedPhenomListBase(rawUrl: string): string | null {
  const host = normalizedHost(rawUrl);
  if (!host) return null;
  let origin: string;
  try {
    origin = new URL(rawUrl).origin;
  } catch {
    return null;
  }
  return PHENOM_RECOMMENDED_LIST_URL_BY_HOST[host] || defaultPhenomListUrl(origin, host);
}

function isFindlyListShellPath(pathname: string): boolean {
  return /\/job-search-results\/?$/i.test(String(pathname || '').replace(/\/+$/, '') || '/');
}

function recommendedFindlyListBase(rawUrl: string): string | null {
  const host = normalizedHost(rawUrl);
  if (!host) return null;
  if (FINDLY_RECOMMENDED_LIST_URL_BY_HOST[host]) return FINDLY_RECOMMENDED_LIST_URL_BY_HOST[host];
  try {
    return `${new URL(rawUrl).origin}/job-search-results/`;
  } catch {
    return null;
  }
}

/**
 * Upgrade career start URLs to public ATS list shells (Workday, Findly, Phenom).
 * Query filters on the recorded URL are preserved. Stored robot URLs are not changed.
 */
export function resolveAtsBoardStartUrl(rawUrl: string): {
  url: string;
  adjusted: boolean;
  reason?: string;
} {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) return { url: trimmed, adjusted: false };

  const host = normalizedHost(trimmed);
  if (!host) return { url: trimmed, adjusted: false };

  const talentBrewWorkday = talentBrewWorkdayBoardUrl(host);
  if (talentBrewWorkday) {
    try {
      const parsed = new URL(trimmed);
      const workday = new URL(talentBrewWorkday);
      if (
        parsed.origin === workday.origin &&
        parsed.pathname.replace(/\/+$/, '') === workday.pathname.replace(/\/+$/, '')
      ) {
        return { url: trimmed, adjusted: false };
      }
    } catch {
      return { url: trimmed, adjusted: false };
    }
    return {
      url: talentBrewWorkday,
      adjusted: true,
      reason:
        'Marketing career site resolved to public Workday CXS board (skips reCAPTCHA browser shell)',
    };
  }

  const jibeBoard = jibeCareerBoardConfig(trimmed);
  if (jibeBoard) {
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      return { url: trimmed, adjusted: false };
    }
    const path = parsed.pathname.replace(/\/+$/, '') || '/';
    const jobsPath = jibeBoard.jobsPath.replace(/\/+$/, '') || '/jobs';
    if (path === jobsPath || path.startsWith(`${jobsPath}/`)) {
      return { url: trimmed, adjusted: false };
    }
    // Bare host / marketing shell → public Jibe list path for browser fallback.
    if (path === '/' || path === '/careers' || path === '/careers-home') {
      const dest = new URL(`${parsed.origin}${jobsPath}`);
      for (const [key, value] of parsed.searchParams.entries()) {
        if (!dest.searchParams.has(key)) dest.searchParams.append(key, value);
      }
      if (parsed.hash && !dest.hash) dest.hash = parsed.hash;
      return {
        url: dest.toString(),
        adjusted: true,
        reason: 'Jibe career homepage upgraded to public jobs list shell',
      };
    }
    return { url: trimmed, adjusted: false };
  }

  const zwayamBoard = zwayamCareerBoardConfig(trimmed);
  if (zwayamBoard) {
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      return { url: trimmed, adjusted: false };
    }
    const path = parsed.pathname.replace(/\/+$/, '') || '/';
    const jobsPath = zwayamBoard.jobsPath.replace(/\/+$/, '') || '/explore-opportunities';
    if (
      path === jobsPath ||
      path.startsWith(`${jobsPath}/`) ||
      path === '/jobslist' ||
      path.startsWith('/jobslist/') ||
      path.startsWith('/jobview/')
    ) {
      return { url: trimmed, adjusted: false };
    }
    if (path === '/' || path === '/careers') {
      const dest = new URL(`${parsed.origin}${jobsPath}`);
      for (const [key, value] of parsed.searchParams.entries()) {
        if (!dest.searchParams.has(key)) dest.searchParams.append(key, value);
      }
      if (parsed.hash && !dest.hash) dest.hash = parsed.hash;
      return {
        url: dest.toString(),
        adjusted: true,
        reason: 'Zwayam career homepage upgraded to explore-opportunities list shell',
      };
    }
    return { url: trimmed, adjusted: false };
  }

  if (isSmartRecruitersVanityHost(trimmed)) {
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      return { url: trimmed, adjusted: false };
    }
    const jobsPath = smartRecruitersVanityJobsPath(trimmed) || '/careers-home/jobs';
    const path = parsed.pathname.replace(/\/+$/, '') || '/';
    const normalizedJobsPath = jobsPath.replace(/\/+$/, '') || '/careers-home/jobs';
    if (path === normalizedJobsPath || path.startsWith(`${normalizedJobsPath}/`)) {
      return { url: trimmed, adjusted: false };
    }
    if (path === '/' || path === '/careers' || path === '/careers-home') {
      const dest = new URL(`${parsed.origin}${jobsPath}`);
      for (const [key, value] of parsed.searchParams.entries()) {
        if (!dest.searchParams.has(key)) dest.searchParams.append(key, value);
      }
      if (parsed.hash && !dest.hash) dest.hash = parsed.hash;
      return {
        url: dest.toString(),
        adjusted: true,
        reason: 'SmartRecruiters connected career site upgraded to public jobs list shell',
      };
    }
    return { url: trimmed, adjusted: false };
  }

  if (looksLikeWorkdayBoard(trimmed)) {
    let parsedWorkday: URL;
    try {
      parsedWorkday = new URL(trimmed);
    } catch {
      return { url: trimmed, adjusted: false };
    }
    const workdayPath = parsedWorkday.pathname.replace(/\/+$/, '') || '/';
    const phenomShapedOnWorkday =
      /\/(?:[a-z]{2}(?:-[a-z]{2})?\/)*search-results$/i.test(workdayPath) ||
      /\/search-jobs$/i.test(workdayPath) ||
      /\/job-search-results$/i.test(workdayPath);
    if (isWorkdayHostOnlyUrl(trimmed) || phenomShapedOnWorkday) {
      const listBase = recommendedWorkdayListUrl(
        phenomShapedOnWorkday
          ? `${parsedWorkday.origin}/${parsedWorkday.search}${parsedWorkday.hash}`
          : trimmed
      );
      if (listBase) {
        let dest: URL;
        try {
          dest = new URL(listBase);
        } catch {
          return { url: trimmed, adjusted: false };
        }
        for (const [key, value] of parsedWorkday.searchParams.entries()) {
          if (!dest.searchParams.has(key)) dest.searchParams.append(key, value);
        }
        if (parsedWorkday.hash && !dest.hash) dest.hash = parsedWorkday.hash;
        const normalized = dest.toString();
        if (normalized === trimmed) return { url: trimmed, adjusted: false };
        return {
          url: normalized,
          adjusted: true,
          reason: phenomShapedOnWorkday
            ? 'Workday host with Phenom-shaped path rewritten to public career site list shell'
            : 'Workday hostname-only URL upgraded to public career site list shell',
        };
      }
    }
  }

  const isFindlyHost = FINDLY_BOARD_HOSTS.has(host) || looksLikeFindlyBoard(trimmed);
  if (isFindlyHost) {
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      return { url: trimmed, adjusted: false };
    }
    if (isFindlyListShellPath(parsed.pathname) && parsed.pathname.endsWith('/')) {
      return { url: trimmed, adjusted: false };
    }
    const listBase = recommendedFindlyListBase(trimmed);
    if (!listBase) return { url: trimmed, adjusted: false };
    let dest: URL;
    try {
      dest = new URL(listBase);
    } catch {
      return { url: trimmed, adjusted: false };
    }
    for (const [key, value] of parsed.searchParams.entries()) {
      if (!dest.searchParams.has(key)) dest.searchParams.append(key, value);
    }
    if (parsed.hash && !dest.hash) dest.hash = parsed.hash;
    const normalized = dest.toString();
    if (normalized === trimmed) return { url: trimmed, adjusted: false };
    return {
      url: normalized,
      adjusted: true,
      reason: isFindlyListShellPath(parsed.pathname)
        ? 'Findly list URL normalized (trailing slash) for m-cloud HTML config fetch'
        : 'Findly career homepage upgraded to /job-search-results/ list shell',
    };
  }

  // HappyDance PHB (Box, Wells Fargo, …): homepage / stale Phenom paths → /en/jobs/
  if (isHappyDanceBoardHost(host)) {
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      return { url: trimmed, adjusted: false };
    }
    const path = parsed.pathname.replace(/\/+$/, '') || '/';
    const alreadyList =
      /^\/[a-z]{2}(?:-[a-z]{2})?\/jobs(?:\/xml)?$/i.test(path) ||
      /^\/jobs(?:\/xml)?$/i.test(path);
    if (alreadyList) return { url: trimmed, adjusted: false };

    const listBase = HAPPYDANCE_RECOMMENDED_LIST_URL_BY_HOST[host] || `${parsed.origin}/en/jobs/`;
    let dest: URL;
    try {
      dest = new URL(listBase);
    } catch {
      return { url: trimmed, adjusted: false };
    }
    for (const [key, value] of parsed.searchParams.entries()) {
      if (!dest.searchParams.has(key)) dest.searchParams.append(key, value);
    }
    if (parsed.hash && !dest.hash) dest.hash = parsed.hash;
    const normalized = dest.toString();
    if (normalized === trimmed) return { url: trimmed, adjusted: false };
    const phenomShaped =
      /\/(?:[a-z]{2}(?:-[a-z]{2})?\/)*search-results$/i.test(path) ||
      /\/search-jobs$/i.test(path) ||
      /\/job-search-results$/i.test(path);
    return {
      url: normalized,
      adjusted: true,
      reason: phenomShaped
        ? 'HappyDance host with Phenom-shaped path rewritten to /en/jobs/ list shell'
        : 'HappyDance career homepage upgraded to /en/jobs/ list shell',
    };
  }

  // Talent Brew SEO shells on mis-tagged Phenom hosts (e.g. usaajobs.com) must not
  // be rewritten to /us/en/search-results — that breaks the AJAX results endpoint.
  if (looksLikeTalentBrewBoard(trimmed)) {
    return { url: trimmed, adjusted: false };
  }

  const isPhenomHost =
    !/^[a-z0-9-]+\.wd\d+\.myworkdayjobs\.com$/i.test(host) &&
    (DIRECTORY_PHENOM_BOARD_HOSTS.has(host) || looksLikePhenomBoard(trimmed));
  if (!isPhenomHost) return { url: trimmed, adjusted: false };

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { url: trimmed, adjusted: false };
  }

  if (isPhenomListShellPath(parsed.pathname)) {
    return { url: trimmed, adjusted: false };
  }

  const listBase = recommendedPhenomListBase(trimmed);
  if (!listBase) return { url: trimmed, adjusted: false };

  let dest: URL;
  try {
    dest = new URL(listBase);
  } catch {
    return { url: trimmed, adjusted: false };
  }

  for (const [key, value] of parsed.searchParams.entries()) {
    if (!dest.searchParams.has(key)) dest.searchParams.append(key, value);
  }
  if (parsed.hash && !dest.hash) dest.hash = parsed.hash;

  const path = parsed.pathname.toLowerCase();
  const reason = path.includes('/job-search-results')
    ? 'Recorded /job-search-results on a Phenom host (not Findly m-cloud); using Phenom search-results list URL'
    : path.includes('/home')
      ? 'Phenom marketing/home URL upgraded to search-results list shell'
      : 'Phenom career homepage upgraded to search-results list shell';

  return { url: dest.toString(), adjusted: true, reason };
}
