import { describe, expect, it } from 'vitest';
import { isUserDashboardPath, userLoginRedirect } from './routeHelpers';

describe('user dashboard routes', () => {
  it('recognizes /user prefix paths', () => {
    expect(isUserDashboardPath('/user')).toBe(true);
    expect(isUserDashboardPath('/user/feed')).toBe(true);
    expect(isUserDashboardPath('/dashboard')).toBe(false);
  });

  it('allows login and register without redirect', () => {
    expect(userLoginRedirect('/user/login')).toBeNull();
    expect(userLoginRedirect('/user/register')).toBeNull();
  });

  it('redirects protected user routes to portal login not ops /login', () => {
    expect(userLoginRedirect('/user/feed')).toBe('/user/login');
    expect(userLoginRedirect('/user/feed')).not.toBe('/login');
  });
});
