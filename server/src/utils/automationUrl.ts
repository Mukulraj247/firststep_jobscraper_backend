/**
 * Automation start URL normalization for storage + exact duplicate checks.
 * Does not rewrite career/ATS paths — extension filters (USA, category, etc.)
 * live on the saved URL and must be preserved when storing a robot.
 *
 * Separate helpers below support *lookup* reuse: a user may paste a career page
 * with query filters while ops already scrapes the company-wide board.
 */

export function normalizeAutomationUrl(value: string): string {
  const trimmedValue = String(value || '').trim();

  if (!trimmedValue) {
    throw new Error('startUrl is required');
  }

  const collapsedProtocolValue = trimmedValue.replace(/^(https?:\/\/)+/i, (match) =>
    match.toLowerCase().startsWith('https://') ? 'https://' : 'http://'
  );

  const normalizedCandidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(collapsedProtocolValue)
    ? collapsedProtocolValue
    : `https://${collapsedProtocolValue}`;

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(normalizedCandidate);
  } catch {
    throw new Error('Invalid startUrl');
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('startUrl must use http or https');
  }
  if (parsedUrl.username || parsedUrl.password) {
    throw new Error('startUrl must not contain embedded credentials');
  }

  return parsedUrl.toString();
}

function safeParseCareerUrl(value: string): URL | null {
  try {
    return new URL(normalizeAutomationUrl(value));
  } catch {
    try {
      return new URL(String(value || '').trim());
    } catch {
      return null;
    }
  }
}

/** Hostname without leading www. */
export function careerHostKey(value: string): string | null {
  const parsed = safeParseCareerUrl(value);
  if (!parsed?.hostname) return null;
  return parsed.hostname.replace(/^www\./i, '').toLowerCase();
}

/**
 * Host + pathname fingerprint (no query/hash). Trailing slashes collapsed.
 * Used to treat `…/jobs?dept=eng` as the same board root as `…/jobs`.
 */
export function careerUrlFingerprint(value: string): string | null {
  const parsed = safeParseCareerUrl(value);
  if (!parsed?.hostname) return null;
  const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
  let path = parsed.pathname || '/';
  if (path.length > 1) path = path.replace(/\/+$/, '');
  return `${host}${path.toLowerCase()}`;
}

/** True when the pasted career URL carries site-side filters (query or hash). */
export function hasCareerSiteFilters(value: string): boolean {
  const parsed = safeParseCareerUrl(value);
  if (!parsed) return false;
  return Boolean(parsed.search && parsed.search.length > 1) || Boolean(parsed.hash && parsed.hash.length > 1);
}

export type CareerRobotMatchKind = 'exact' | 'root' | 'host' | 'manual';

export type CareerRobotCandidate = {
  metaId?: string | null;
  url?: string | null;
  name?: string | null;
};

/**
 * Score how well a stored robot URL covers a requested career URL.
 * Higher is better. Prefer exact, then same path without query, then same host
 * with a broader (unfiltered / shorter) board URL.
 */
export function scoreCareerRobotCandidate(
  requestedUrl: string,
  robotUrl: string
): { score: number; matchKind: CareerRobotMatchKind | null } {
  let requestedNorm = '';
  let robotNorm = '';
  try {
    requestedNorm = normalizeAutomationUrl(requestedUrl);
  } catch {
    requestedNorm = String(requestedUrl || '').trim();
  }
  try {
    robotNorm = normalizeAutomationUrl(robotUrl);
  } catch {
    robotNorm = String(robotUrl || '').trim();
  }

  if (!requestedNorm || !robotNorm) return { score: -1, matchKind: null };

  if (requestedNorm === robotNorm) {
    return { score: 1000, matchKind: 'exact' };
  }

  const reqFp = careerUrlFingerprint(requestedNorm);
  const robFp = careerUrlFingerprint(robotNorm);
  const reqHost = careerHostKey(requestedNorm);
  const robHost = careerHostKey(robotNorm);
  if (!reqHost || !robHost || reqHost !== robHost) {
    return { score: -1, matchKind: null };
  }

  const robotFiltered = hasCareerSiteFilters(robotNorm);
  const requestedFiltered = hasCareerSiteFilters(requestedNorm);
  const pathLen = (robFp || '').length;

  if (reqFp && robFp && reqFp === robFp) {
    // Same board path. Prefer unfiltered robot when the paste carried site filters.
    if (requestedFiltered && !robotFiltered) {
      return { score: 900 - Math.min(pathLen, 100), matchKind: 'root' };
    }
    return {
      score: 800 - (robotFiltered ? 120 : 0) - Math.min(pathLen, 200),
      matchKind: 'root',
    };
  }

  // Same company host — strongly prefer an unfiltered board over a filtered sibling path.
  if (requestedFiltered && !robotFiltered) {
    return {
      score: 820 - Math.min(pathLen, 200),
      matchKind: 'host',
    };
  }
  return {
    score: 400 - (robotFiltered ? 80 : 0) - Math.min(pathLen, 200),
    matchKind: 'host',
  };
}

/**
 * Pick the best existing robot for a requested career URL among candidates.
 */
export function pickBestCareerRobot<T extends CareerRobotCandidate>(
  requestedUrl: string,
  candidates: T[]
): { robot: T; matchKind: CareerRobotMatchKind; score: number } | null {
  let best: { robot: T; matchKind: CareerRobotMatchKind; score: number } | null = null;
  for (const robot of candidates) {
    const url = String(robot?.url || '').trim();
    if (!url) continue;
    const { score, matchKind } = scoreCareerRobotCandidate(requestedUrl, url);
    if (!matchKind || score < 0) continue;
    if (!best || score > best.score) {
      best = { robot, matchKind, score };
    }
  }
  return best;
}

export function careerReuseMessage(opts: {
  matchKind: CareerRobotMatchKind;
  requestedHadSiteFilters: boolean;
  robotUrl: string;
}): string | null {
  if (opts.matchKind === 'exact') return null;
  if (opts.matchKind === 'manual') {
    return `Manually linked to automation at ${opts.robotUrl}.`;
  }
  if (opts.matchKind === 'root' && opts.requestedHadSiteFilters) {
    return `Reusing board automation at ${opts.robotUrl}. Career-page query filters on the pasted URL are ignored; cluster title/experience filters apply on the job board.`;
  }
  if (opts.matchKind === 'host') {
    return `Reusing company-wide automation at ${opts.robotUrl}. Pasted URL mapped by hostname; request filters (titles / YOE) narrow the feed — not a second scrape.`;
  }
  if (opts.matchKind === 'root') {
    return `Reusing automation at ${opts.robotUrl} (same career path).`;
  }
  return null;
}

/**
 * When creating a *new* robot from a pasted career URL that includes site filters,
 * store the board root (no query/hash) so later filtered pastes reuse this scrape.
 * Exact filtered storage is only for ops that deliberately need ATS-side filters.
 */
export function careerBoardUrlForStorage(value: string, opts?: { keepSiteFilters?: boolean }): string {
  const normalized = normalizeAutomationUrl(value);
  if (opts?.keepSiteFilters || !hasCareerSiteFilters(normalized)) return normalized;
  const parsed = new URL(normalized);
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
}
