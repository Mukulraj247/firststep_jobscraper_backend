/**
 * AppTrss / SmashFly-style HTML job boards (server-rendered list with a.job_link).
 * Prefer HTML parse over mis-tagged Phenom rewrites.
 */
export type ApptrssCareerBoardConfig = {
  companyHint: string;
};

export const APPTRSS_CAREER_BOARD_BY_HOST: Record<string, ApptrssCareerBoardConfig> = {
  'careers.zionsbank.com': { companyHint: 'Zions Bank' },
};

export function apptrssCareerBoardConfig(url: string): ApptrssCareerBoardConfig | null {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return APPTRSS_CAREER_BOARD_BY_HOST[host] || null;
  } catch {
    return null;
  }
}

export function looksLikeApptrssBoard(url: string): boolean {
  if (!apptrssCareerBoardConfig(url)) return false;
  try {
    const path = new URL(url).pathname.replace(/\/+$/, '') || '/';
    return /\/jobs\/search\/\d+$/i.test(path) || /\/jobs\/[a-z0-9-]+-\d+$/i.test(path);
  } catch {
    return false;
  }
}
