/** Findly / CWS (m-cloud) boards where the list shell is `/job-search-results`. */
export const FINDLY_BOARD_HOSTS = new Set<string>([
  'careers.dxc.com',
  'careers.edwardjones.com',
  'careers.travelers.com',
]);

export const FINDLY_RECOMMENDED_LIST_URL_BY_HOST: Record<string, string> = {
  'careers.dxc.com': 'https://careers.dxc.com/job-search-results/',
  'careers.edwardjones.com': 'https://careers.edwardjones.com/job-search-results/',
  'careers.travelers.com': 'https://careers.travelers.com/job-search-results/',
};
