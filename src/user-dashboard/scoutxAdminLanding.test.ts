import { describe, expect, it } from 'vitest';
import {
  hasScoutXAdmin,
  hasScoutXUser,
  landingPathForRoles,
  SCOUTX_ADMIN_ROLE,
  SCOUTX_USER_ROLE,
} from '../auth/scoutxAuth';

describe('ScoutX admin vs portal landing', () => {
  it('sends ScoutX_Admin to ops dashboard (not customer portal)', () => {
    expect(hasScoutXAdmin([SCOUTX_ADMIN_ROLE])).toBe(true);
    expect(hasScoutXUser([SCOUTX_ADMIN_ROLE])).toBe(true);
    expect(landingPathForRoles([SCOUTX_ADMIN_ROLE])).toBe('/dashboard');
    expect(landingPathForRoles([SCOUTX_ADMIN_ROLE, SCOUTX_USER_ROLE])).toBe('/dashboard');
  });

  it('keeps ScoutX_User on the customer portal', () => {
    expect(hasScoutXAdmin([SCOUTX_USER_ROLE])).toBe(false);
    expect(landingPathForRoles([SCOUTX_USER_ROLE])).toBe('/user');
  });
});
