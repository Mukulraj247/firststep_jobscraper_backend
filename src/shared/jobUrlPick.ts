import { scoreJobHrefPath } from './jobHrefScore';

/** Score an href for job-posting likelihood (higher = better posting URL). */
export function scoreHrefCandidate(href: string, baseUrl?: string): number {
  const raw = String(href || '').trim();
  if (!raw || raw.startsWith('#') || /^javascript:/i.test(raw)) return -999;
  try {
    const abs = new URL(raw, baseUrl || 'https://example.invalid').href;
    const path = new URL(abs).pathname;
    return scoreJobHrefPath(path, abs.toLowerCase());
  } catch {
    return -999;
  }
}

/** Pick the best job posting href from candidates (e.g. anchors inside a list card). */
export function pickBestJobHref(candidates: string[], baseUrl?: string): string | null {
  let best: { href: string; score: number } | null = null;
  for (const candidate of candidates) {
    const score = scoreHrefCandidate(candidate, baseUrl);
    if (score <= -900) continue;
    if (!best || score > best.score) {
      best = { href: candidate.trim(), score };
    }
  }
  return best?.href || null;
}
