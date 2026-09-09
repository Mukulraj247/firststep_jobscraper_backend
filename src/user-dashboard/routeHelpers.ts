export const USER_DASHBOARD_PREFIX = '/user';

export const PUBLIC_USER_ROUTES = ['/user/login', '/user/register'];

export function isUserDashboardPath(pathname: string): boolean {
  return pathname === USER_DASHBOARD_PREFIX || pathname.startsWith(`${USER_DASHBOARD_PREFIX}/`);
}

export function isPublicUserRoute(pathname: string): boolean {
  return PUBLIC_USER_ROUTES.includes(pathname);
}

export function userLoginRedirect(pathname: string): string | null {
  if (!isUserDashboardPath(pathname)) return null;
  if (isPublicUserRoute(pathname)) return null;
  return '/user/login';
}
