/** Talent Brew (Radancy) career marketing hosts backed by public Workday CXS boards. */
export const TALENT_BREW_WORKDAY_BOARD_URL_BY_HOST: Record<string, string> = {
  'jobs.empower.com': 'https://empower.wd12.myworkdayjobs.com/empower',
};

/**
 * Marketing / AEM career hosts that still resolve to public Workday CXS.
 * Same rewrite path as Talent Brew → Workday (skips CAPTCHA browser shells).
 */
export const MARKETING_WORKDAY_BOARD_URL_BY_HOST: Record<string, string> = {
  'accenture.com': 'https://accenture.wd103.myworkdayjobs.com/AccentureCareers',
};

export function talentBrewWorkdayBoardUrl(host: string): string | null {
  const normalized = String(host || '')
    .toLowerCase()
    .replace(/^www\./, '');
  return (
    TALENT_BREW_WORKDAY_BOARD_URL_BY_HOST[normalized] ||
    MARKETING_WORKDAY_BOARD_URL_BY_HOST[normalized] ||
    null
  );
}

export function isTalentBrewWorkdayHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return !!talentBrewWorkdayBoardUrl(host);
  } catch {
    return false;
  }
}
