/**
 * First Step Auth0 / Mongo role keys ↔ display labels.
 * Keep in sync with FIRSTSTEP front `firstStepUserInfoService` ROLE_MAPPING.
 */

const ROLE_DISPLAY: Record<string, string> = {
  user: 'User',
  job_collector: 'Job Collector',
  application_incharge: 'Application Incharge',
  super_admin: 'Super Admin',
  // Already-display / spaced forms
  'job collector': 'Job Collector',
  'application incharge': 'Application Incharge',
  'super admin': 'Super Admin',
};

const STAFF_COMPACT = new Set([
  'jobcollector',
  'applicationincharge',
  'superadmin',
]);

function compactRole(raw: string): string {
  return raw.toLowerCase().replace(/[\s_-]+/g, '');
}

function normalizeRoleKey(raw: string | null | undefined): string {
  return String(raw || '')
    .trim()
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ');
}

/** Auth0/Mongo role → UI label (Application_Incharge → Application Incharge). */
export function displayFirstStepRole(role: string | null | undefined): string | null {
  const key = normalizeRoleKey(role);
  if (!key) return null;
  const lower = key.toLowerCase();
  if (ROLE_DISPLAY[lower]) return ROLE_DISPLAY[lower];
  const underscored = key.replace(/\s+/g, '_').toLowerCase();
  if (ROLE_DISPLAY[underscored.replace(/_/g, ' ')]) {
    return ROLE_DISPLAY[underscored.replace(/_/g, ' ')];
  }
  // Application_Incharge / Job_Collector / Super_Admin
  const fromUnderscore = ROLE_DISPLAY[key.replace(/_/g, ' ').toLowerCase()];
  if (fromUnderscore) return fromUnderscore;
  return key;
}

/** Staff roles have no customer subscription plan on First Step. */
export function isFirstStepStaffRole(role: string | null | undefined): boolean {
  if (!role) return false;
  return STAFF_COMPACT.has(compactRole(role));
}

/**
 * Plan column label: staff → role name; else empty (caller uses displayPlanType).
 * Avoids showing Unknown when we know they are AIC / JC / Super Admin.
 */
export function staffRoleDisplayOverride(
  subscriptionType: string | null | undefined,
  firstStepRole: string | null | undefined
): string | null {
  if (isFirstStepStaffRole(firstStepRole)) {
    return displayFirstStepRole(firstStepRole);
  }
  const planKey = String(subscriptionType || '').trim().toLowerCase();
  if (!planKey || planKey === 'unknown') {
    const roleLabel = displayFirstStepRole(firstStepRole);
    if (roleLabel && roleLabel !== 'User') return roleLabel;
  }
  return null;
}
