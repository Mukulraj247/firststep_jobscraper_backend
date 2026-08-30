/** Findly / CWS (m-cloud) boards where the list shell is `/job-search-results`. */
export const FINDLY_BOARD_HOSTS = new Set<string>(['careers.dxc.com']);

export const FINDLY_RECOMMENDED_LIST_URL_BY_HOST: Record<string, string> = {
  'careers.dxc.com': 'https://careers.dxc.com/job-search-results/',
};
