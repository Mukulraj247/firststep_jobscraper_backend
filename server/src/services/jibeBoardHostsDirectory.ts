/** Jibe-powered career marketing hosts → public jobs API (jibeapply.com). */
export type JibeCareerBoardConfig = {
  companyHint: string;
  apiOrigin: string;
  /** Path prefix on the career host for job detail pages, e.g. /careers-home/jobs */
  jobsPath: string;
};

export const JIBE_CAREER_BOARD_BY_HOST: Record<string, JibeCareerBoardConfig> = {
  'github.careers': {
    companyHint: 'GitHub',
    apiOrigin: 'https://githubinc.jibeapply.com',
    jobsPath: '/careers-home/jobs',
  },
  'jobs.uhsinc.com': {
    companyHint: 'UHS',
    apiOrigin: 'https://uhs.jibeapply.com',
    jobsPath: '/careers/jobs',
  },
};

export function jibeCareerBoardConfig(url: string): JibeCareerBoardConfig | null {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return JIBE_CAREER_BOARD_BY_HOST[host] || null;
  } catch {
    return null;
  }
}

export function isJibeCareerHost(url: string): boolean {
  return jibeCareerBoardConfig(url) !== null;
}
