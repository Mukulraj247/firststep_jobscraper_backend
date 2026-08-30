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
  'careers.ulta.com': {
    companyHint: 'Ulta Beauty',
    apiOrigin: 'https://ulta.jibeapply.com',
    jobsPath: '/careers/jobs',
  },
  'careers.spglobal.com': {
    companyHint: 'S&P Global',
    apiOrigin: 'https://spglobal.jibeapply.com',
    jobsPath: '/jobs',
  },
  'careers.principal.com': {
    companyHint: 'Principal',
    apiOrigin: 'https://principal.jibeapply.com',
    jobsPath: '/careers-home/jobs',
  },
  // Public SR postings API is empty; careers site exposes Jibe /api/jobs on the same host.
  'careers.docusign.com': {
    companyHint: 'DocuSign',
    apiOrigin: 'https://careers.docusign.com',
    jobsPath: '/careers-home/jobs',
  },
  'careers.icims.com': {
    companyHint: 'iCIMS',
    apiOrigin: 'https://careers.icims.com',
    jobsPath: '/careers-home/jobs',
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
