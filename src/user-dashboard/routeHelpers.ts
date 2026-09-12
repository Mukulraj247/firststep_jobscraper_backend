export const USER_DASHBOARD_PREFIX = '/user';

/** Legacy paths kept only so old bookmarks redirect to unified `/login`. */
export const PUBLIC_USER_ROUTES = ['/user/login', '/user/register'];

/** Single Auth0 entry for ops + portal (role decides landing after exchange). */
export const SCOUTX_LOGIN_PATH = '/login';

export function isUserDashboardPath(pathname: string): boolean {
  return pathname === USER_DASHBOARD_PREFIX || pathname.startsWith(`${USER_DASHBOARD_PREFIX}/`);
}

export function isPublicUserRoute(pathname: string): boolean {
  return PUBLIC_USER_ROUTES.includes(pathname);
}

export function userLoginRedirect(pathname: string): string | null {
  if (!isUserDashboardPath(pathname)) return null;
  if (isPublicUserRoute(pathname)) return null;
  return SCOUTX_LOGIN_PATH;
}
