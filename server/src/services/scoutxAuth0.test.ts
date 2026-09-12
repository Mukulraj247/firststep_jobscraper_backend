import { describe, expect, it } from 'vitest';
import {
  extractScoutXRoles,
  resolveScoutXRoles,
  SCOUTX_ADMIN_ROLE,
  SCOUTX_USER_ROLE,
} from './scoutxAuth0';

describe('scoutxAuth0 roles', () => {
  it('reads namespaced claim', () => {
    const roles = extractScoutXRoles({
      'https://scoutx.app/roles': [SCOUTX_ADMIN_ROLE, SCOUTX_USER_ROLE],
    });
    expect(roles).toEqual([SCOUTX_ADMIN_ROLE, SCOUTX_USER_ROLE]);
  });

  it('does not grant admin from email allowlist anymore', () => {
    process.env.SCOUTX_OPS_ADMIN_EMAILS = 'mukulraj756@gmail.com';
    const roles = resolveScoutXRoles({}, 'mukulraj756@gmail.com');
    expect(roles).not.toContain(SCOUTX_ADMIN_ROLE);
    expect(roles).toContain(SCOUTX_USER_ROLE);
  });

  it('defaults any Auth0 user without roles to ScoutX_User', () => {
    const roles = resolveScoutXRoles({}, 'stranger@example.com');
    expect(roles).toContain(SCOUTX_USER_ROLE);
    expect(roles).not.toContain(SCOUTX_ADMIN_ROLE);
  });

  it('keeps ScoutX_Admin when present on the token claim', () => {
    const roles = resolveScoutXRoles(
      { 'https://scoutx.app/roles': [SCOUTX_ADMIN_ROLE] },
      'anyone@example.com'
    );
    expect(roles).toContain(SCOUTX_ADMIN_ROLE);
  });
});
