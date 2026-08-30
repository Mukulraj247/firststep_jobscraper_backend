/** Zwayam / REACH career SPAs (e.g. Persistent) → public.zwayam.com jobs/search. */
export type ZwayamCareerBoardConfig = {
  companyHint: string;
  /** Base64 company id as stored by the careers SPA (COMPANYID session key). */
  companyIdB64: string;
  domain: string;
  apiOrigin: string;
  /** Preferred list shell path on the career host. */
  jobsPath: string;
};

export const ZWAYAM_CAREER_BOARD_BY_HOST: Record<string, ZwayamCareerBoardConfig> = {
  'careers.persistent.com': {
    companyHint: 'Persistent',
    companyIdB64: 'MTYzNDQ=', // 16344
    domain: 'careers.persistent.com',
    apiOrigin: 'https://public.zwayam.com',
    jobsPath: '/explore-opportunities',
  },
};

export function zwayamCareerBoardConfig(url: string): ZwayamCareerBoardConfig | null {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return ZWAYAM_CAREER_BOARD_BY_HOST[host] || null;
  } catch {
    return null;
  }
}

export function isZwayamCareerHost(url: string): boolean {
  return zwayamCareerBoardConfig(url) !== null;
}

export function looksLikeZwayamBoard(url: string): boolean {
  return isZwayamCareerHost(url);
}
