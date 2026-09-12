/**
 * ScoutX Auth0 role helpers.
 *
 * First Step keeps `user_metadata.role` for its own packages.
 * ScoutX uses Auth0 RBAC roles on the access token (namespaced claim).
 * Ops access: ScoutX_Admin from token claim ONLY (no email allowlist).
 * Portal: any Auth0 user defaults to ScoutX_User.
 */

export const SCOUTX_ROLES_CLAIM = 'https://scoutx.app/roles';
export const SCOUTX_ADMIN_ROLE = 'ScoutX_Admin';
export const SCOUTX_USER_ROLE = 'ScoutX_User';

export type ScoutXRole = typeof SCOUTX_ADMIN_ROLE | typeof SCOUTX_USER_ROLE;

const DEFAULT_OPS_USER_ID = '6a8cfcda6a727b0780e05692';

/** Pinned ops Mongo owner — all robots / job board / runs use this string id. */
export function getScoutXOpsUserId(): string {
  const fromEnv = String(process.env.SCOUTX_OPS_USER_ID || '').trim();
  return fromEnv || DEFAULT_OPS_USER_ID;
}

function asStringArray(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((v) => String(v)).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

/**
 * Pull ScoutX roles from common Auth0 claim shapes:
 * - custom Action: https://scoutx.app/roles
 * - Auth0 RBAC (namespaced): https://…/roles
 * - Authorization Extension: roles
 */
export function extractScoutXRoles(payload: Record<string, unknown> | null | undefined): ScoutXRole[] {
  if (!payload || typeof payload !== 'object') return [];

  const candidates: string[] = [
    ...asStringArray(payload[SCOUTX_ROLES_CLAIM]),
    ...asStringArray(payload['https://scoutx.app/roles']),
    ...asStringArray(payload.roles),
    ...asStringArray(
      (payload as { 'https://schemas.auth0.com/roles'?: unknown })['https://schemas.auth0.com/roles']
    ),
  ];

  for (const [key, value] of Object.entries(payload)) {
    if (/\/roles$/i.test(key)) {
      candidates.push(...asStringArray(value));
    }
  }

  const found = new Set<ScoutXRole>();
  for (const role of candidates) {
    if (role === SCOUTX_ADMIN_ROLE || role === 'scoutx_admin' || role === 'ScoutX Admin') {
      found.add(SCOUTX_ADMIN_ROLE);
    }
    if (role === SCOUTX_USER_ROLE || role === 'scoutx_user' || role === 'ScoutX User') {
      found.add(SCOUTX_USER_ROLE);
    }
  }
  return [...found];
}

/**
 * Admin only from Auth0 RBAC claim. Everyone else defaults to ScoutX_User (portal).
 * Does not write First Step user_metadata.role. Does not grant admin by email.
 */
export function resolveScoutXRoles(
  payload: Record<string, unknown> | null | undefined,
  _email?: string | null
): ScoutXRole[] {
  const fromToken = extractScoutXRoles(payload);
  const roles = new Set<ScoutXRole>(fromToken);

  if (!roles.has(SCOUTX_ADMIN_ROLE) && !roles.has(SCOUTX_USER_ROLE)) {
    roles.add(SCOUTX_USER_ROLE);
  }

  return [...roles];
}

export function extractEmailFromAuth0Payload(
  payload: Record<string, unknown> | null | undefined
): string | null {
  if (!payload) return null;
  const direct = payload.email;
  if (typeof direct === 'string' && direct.includes('@')) {
    return direct.trim().toLowerCase();
  }
  const namespaced = payload['https://scoutx.app/email'];
  if (typeof namespaced === 'string' && namespaced.includes('@')) {
    return namespaced.trim().toLowerCase();
  }
  return null;
}

export function extractSubFromAuth0Payload(
  payload: Record<string, unknown> | null | undefined
): string | null {
  if (!payload || typeof payload.sub !== 'string') return null;
  return payload.sub.trim() || null;
}

/** First Step staff/customer role from user_metadata (display only — never grants ScoutX ops). */
export function extractFirstStepRole(
  payload: Record<string, unknown> | null | undefined,
  bodyRole?: string | null
): string | null {
  if (typeof bodyRole === 'string' && bodyRole.trim()) {
    return bodyRole.trim();
  }
  if (!payload) return null;
  const meta = payload['https://scoutx.app/first_step_role'];
  if (typeof meta === 'string' && meta.trim()) return meta.trim();
  const um = payload.user_metadata;
  if (um && typeof um === 'object' && typeof (um as { role?: unknown }).role === 'string') {
    return String((um as { role: string }).role).trim();
  }
  return null;
}

export function hasScoutXAdmin(roles: ScoutXRole[]): boolean {
  return roles.includes(SCOUTX_ADMIN_ROLE);
}

export function hasScoutXUser(roles: ScoutXRole[]): boolean {
  return roles.includes(SCOUTX_USER_ROLE) || roles.includes(SCOUTX_ADMIN_ROLE);
}
