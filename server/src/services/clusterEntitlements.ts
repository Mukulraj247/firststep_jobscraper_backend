import type { FirstStepPlanSnapshot } from '../models/PortalUser';

/** Canonical delivery windows for cluster subscriptions. */
export const CLUSTER_WINDOWS = ['1h', '12h', '24h'] as const;
export type ClusterWindow = (typeof CLUSTER_WINDOWS)[number];

/** Hard cap for ops assigning clusters to a portal user (admin Portal users page). */
export const ADMIN_MAX_ASSIGNABLE_CLUSTERS = 50;

/** Windows available when ops has enabled subscription (any allotment). */
export const OPS_ALLOWED_WINDOWS: readonly ClusterWindow[] = CLUSTER_WINDOWS;

export const CLUSTER_WINDOW_MS: Record<ClusterWindow, number> = {
  '1h': 60 * 60 * 1000,
  '12h': 12 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
};

export type ClusterEntitlements = {
  subscriptionType: string | null;
  isActive: boolean;
  /** Plan-included slots (Premium Plus / Falcon = 2; everyone else = 0). */
  maxActiveClusters: number;
  allowedWindows: readonly ClusterWindow[];
  source: 'first_step' | 'inactive' | 'unknown' | 'default';
};

/**
 * First Step DB keys (must stay in sync with FIRSTSTEP front/back `PLAN_KEYS`):
 * Essentials, Elite, FalconLite, Falcon, Premium, PremiumPlus, Normal Plan
 *
 * Meeting rule: only Premium Plus (and Falcon alias) include 2 clusters.
 * Everyone else starts at 0; ops can allot 1–50 after verifying payment.
 */
const TIER_0 = { maxActiveClusters: 0, allowedWindows: [] as const };
const TIER_2_ALL = {
  maxActiveClusters: 2,
  allowedWindows: ['1h', '12h', '24h'] as const,
};

/**
 * Map First Step `subscription_type` → ScoutX plan-included entitlement.
 * Edit this table when First Step renames tiers.
 */
const ENTITLEMENT_BY_TYPE: Record<
  string,
  { maxActiveClusters: number; allowedWindows: readonly ClusterWindow[] }
> = {
  // Free / standard — no included clusters
  'Normal Plan': TIER_0,
  Normal: TIER_0,
  Free: TIER_0,
  Standard: TIER_0,
  'Standard User': TIER_0,

  // First Step paid tiers without ScoutX inclusion
  Essentials: TIER_0,
  Elite: TIER_0,
  FalconLite: TIER_0,
  'Falcon Lite': TIER_0,
  Premium: TIER_0,
  'Premium Plan': TIER_0,
  Enterprise: TIER_0,

  // Premium Plus / Falcon — 2 included clusters
  Falcon: TIER_2_ALL,
  'Premium Plus': TIER_2_ALL,
  'Premium+': TIER_2_ALL,
  PremiumPlus: TIER_2_ALL,
};

/** Human labels for Portal users / portal UI (aligned with First Step chips). */
const PLAN_DISPLAY_BY_COMPACT: Record<string, string> = {
  essentials: 'Essentials',
  elite: 'Elite',
  falconlite: 'Falcon Lite',
  falcon: 'Falcon',
  premium: 'Premium',
  premiumplan: 'Premium',
  premiumplus: 'Premium Plus',
  normalplan: 'Standard',
  normal: 'Standard',
  free: 'Standard',
  standard: 'Standard',
  standarduser: 'Standard',
  unknown: 'Unknown',
};

const ZERO: Omit<ClusterEntitlements, 'subscriptionType' | 'source'> = {
  isActive: false,
  maxActiveClusters: 0,
  allowedWindows: [],
};

function normalizeTypeKey(raw: string | null | undefined): string {
  return String(raw || '')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Collapse spaces and "+" so PremiumPlus ≡ Premium Plus ≡ Premium+. */
function compactTypeKey(raw: string): string {
  return raw.toLowerCase().replace(/[\s+]+/g, '');
}

function lookupTier(subscriptionType: string | null | undefined) {
  const key = normalizeTypeKey(subscriptionType);
  if (!key || key.toLowerCase() === 'unknown') return null;

  if (ENTITLEMENT_BY_TYPE[key]) return ENTITLEMENT_BY_TYPE[key];

  const lower = key.toLowerCase();
  for (const [name, value] of Object.entries(ENTITLEMENT_BY_TYPE)) {
    if (name.toLowerCase() === lower) return value;
  }

  const compact = compactTypeKey(key);
  for (const [name, value] of Object.entries(ENTITLEMENT_BY_TYPE)) {
    if (compactTypeKey(name) === compact) return value;
  }
  return null;
}

/**
 * Human-facing plan label for UI.
 * Matches First Step: PremiumPlus → Premium Plus, Normal Plan → Standard, etc.
 */
export function displayPlanType(subscriptionType: string | null | undefined): string | null {
  const key = normalizeTypeKey(subscriptionType);
  if (!key) return 'Standard';
  const mapped = PLAN_DISPLAY_BY_COMPACT[compactTypeKey(key)];
  return mapped || key;
}

/**
 * Resolve how many clusters + which delivery windows a portal user may activate
 * from their First Step plan alone (before ops allotment).
 * Never throws — unknown/inactive plans get zero entitlement.
 */
export function getEntitlements(
  plan: FirstStepPlanSnapshot | null | undefined
): ClusterEntitlements {
  const subscriptionType = plan?.subscriptionType ?? null;
  const status = String(plan?.status || '').toLowerCase();
  const explicitlyInactive =
    plan?.isActive === false ||
    status === 'cancelled' ||
    status === 'canceled' ||
    status === 'expired' ||
    status === 'inactive';

  if (explicitlyInactive) {
    return {
      subscriptionType,
      ...ZERO,
      source: 'inactive',
    };
  }

  const tier = lookupTier(subscriptionType);
  if (!tier) {
    // Missing plan snapshot or unrecognized type → no clusters until First Step resolves.
    return {
      subscriptionType,
      ...ZERO,
      source:
        !subscriptionType || String(subscriptionType).toLowerCase() === 'unknown'
          ? 'unknown'
          : 'default',
    };
  }

  return {
    subscriptionType,
    isActive: true,
    maxActiveClusters: tier.maxActiveClusters,
    allowedWindows: tier.allowedWindows,
    source: 'first_step',
  };
}

/** Plan-included slots only (Premium Plus / Falcon = 2; else 0). */
export function planIncludedSlots(plan: FirstStepPlanSnapshot | null | undefined): number {
  return getEntitlements(plan).maxActiveClusters;
}

export type SubscribedSlotsInput = {
  plan: FirstStepPlanSnapshot | null | undefined;
  adminClusterLimit?: number | null;
  clusterServiceOptOut?: boolean | null;
  clusterServiceStartedAt?: Date | string | null;
};

export type SubscribedSlotsResult = {
  subscriptionOn: boolean;
  planIncludedSlots: number;
  /** How many clusters this user may hold (ops allotment or plan default). Clamped 0–50. */
  subscribedSlots: number;
  allowedWindows: readonly ClusterWindow[];
};

function clampSlots(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(ADMIN_MAX_ASSIGNABLE_CLUSTERS, Math.max(0, Math.floor(n)));
}

/**
 * Resolve subscription-on state and subscribed slot allotment.
 *
 * Subscription on when:
 * - clusterServiceOptOut is not true, AND
 * - clusterServiceStartedAt is set, OR plan includes 2 slots (Premium Plus / Falcon)
 *
 * subscribedSlots = adminClusterLimit if set, else planIncludedSlots. Clamped 0–50.
 */
export function resolveSubscribedSlots(input: SubscribedSlotsInput): SubscribedSlotsResult {
  const planIncluded = planIncludedSlots(input.plan);
  const optedOut = input.clusterServiceOptOut === true;
  const hasStarted = Boolean(input.clusterServiceStartedAt);

  let subscriptionOn = false;
  if (!optedOut) {
    if (hasStarted) subscriptionOn = true;
    else if (planIncluded >= 2) subscriptionOn = true;
  }

  let subscribedSlots = 0;
  if (subscriptionOn) {
    if (typeof input.adminClusterLimit === 'number' && Number.isFinite(input.adminClusterLimit)) {
      subscribedSlots = clampSlots(input.adminClusterLimit);
    } else {
      subscribedSlots = clampSlots(planIncluded);
    }
  }

  const allowedWindows: readonly ClusterWindow[] =
    subscriptionOn && subscribedSlots > 0 ? OPS_ALLOWED_WINDOWS : [];

  return {
    subscriptionOn,
    planIncludedSlots: planIncluded,
    subscribedSlots,
    allowedWindows,
  };
}

export function isAllowedWindow(
  entitlements: { allowedWindows: readonly ClusterWindow[] },
  window: string
): window is ClusterWindow {
  return (
    (CLUSTER_WINDOWS as readonly string[]).includes(window) &&
    entitlements.allowedWindows.includes(window as ClusterWindow)
  );
}

export function parseClusterWindow(raw: unknown, fallback: ClusterWindow = '24h'): ClusterWindow {
  const value = String(raw || '').trim();
  if ((CLUSTER_WINDOWS as readonly string[]).includes(value)) {
    return value as ClusterWindow;
  }
  return fallback;
}

export function windowCutoff(window: ClusterWindow, nowMs = Date.now()): Date {
  return new Date(nowMs - CLUSTER_WINDOW_MS[window]);
}
