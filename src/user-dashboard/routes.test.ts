import { describe, expect, it } from 'vitest';
import {
  isUserDashboardPath,
  SCOUTX_LOGIN_PATH,
  userLoginRedirect,
} from './routeHelpers';

describe('user dashboard routes', () => {
  it('recognizes /user prefix paths', () => {
    expect(isUserDashboardPath('/user')).toBe(true);
    expect(isUserDashboardPath('/user/feed')).toBe(true);
    expect(isUserDashboardPath('/dashboard')).toBe(false);
  });

  it('allows legacy login/register paths without forcing another redirect helper', () => {
    expect(userLoginRedirect('/user/login')).toBeNull();
    expect(userLoginRedirect('/user/register')).toBeNull();
  });

  it('sends unauthenticated portal routes to unified /login', () => {
    expect(userLoginRedirect('/user/feed')).toBe(SCOUTX_LOGIN_PATH);
    expect(userLoginRedirect('/user/feed')).toBe('/login');
  });
});
