/** Talent Brew (Radancy) career marketing hosts backed by public Workday CXS boards. */
export const TALENT_BREW_WORKDAY_BOARD_URL_BY_HOST: Record<string, string> = {
  'jobs.empower.com': 'https://empower.wd12.myworkdayjobs.com/empower',
};

export function talentBrewWorkdayBoardUrl(host: string): string | null {
  const normalized = String(host || '')
    .toLowerCase()
    .replace(/^www\./, '');
  return TALENT_BREW_WORKDAY_BOARD_URL_BY_HOST[normalized] || null;
}

export function isTalentBrewWorkdayHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return !!talentBrewWorkdayBoardUrl(host);
  } catch {
    return false;
  }
}
