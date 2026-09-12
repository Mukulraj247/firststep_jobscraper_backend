import type { FirstStepPlanSnapshot } from '../models/PortalUser';

export function getFirstStepApiBaseUrl(): string {
  return String(process.env.FIRSTSTEP_API_BASE_URL || 'http://localhost:5000').replace(/\/$/, '');
}

/**
 * Fetch First Step subscription for an Auth0 sub.
 * Never throws — returns a snapshot with error filled on failure so login still succeeds.
 */
export async function fetchFirstStepPlanSnapshot(
  auth0Sub: string | null | undefined
): Promise<FirstStepPlanSnapshot> {
  const fetchedAt = new Date();
  if (!auth0Sub) {
    return {
      subscriptionType: null,
      isActive: null,
      status: null,
      fetchedAt,
      error: 'missing_auth0_sub',
    };
  }

  const base = getFirstStepApiBaseUrl();
  const url = `${base}/firstStep/subscription/getByUserId?user_id=${encodeURIComponent(auth0Sub)}`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      return {
        subscriptionType: 'unknown',
        isActive: null,
        status: null,
        fetchedAt,
        error: `http_${res.status}`,
      };
    }

    const body = (await res.json()) as {
      data?: {
        subscription_details?: {
          subscription_type?: string;
          is_active?: boolean;
          subscription_status?: string;
          user_role?: string;
        } | null;
      };
      subscription_details?: {
        subscription_type?: string;
        is_active?: boolean;
        subscription_status?: string;
        user_role?: string;
      } | null;
    };

    // First Step wrappers vary: { data: { subscription_details } } or flat.
    const details =
      body?.data?.subscription_details ?? body?.subscription_details ?? null;

    if (!details) {
      return {
        subscriptionType: 'Normal Plan',
        isActive: true,
        status: 'active',
        fetchedAt,
        error: null,
      };
    }

    return {
      subscriptionType: details.subscription_type ?? 'Normal Plan',
      isActive: typeof details.is_active === 'boolean' ? details.is_active : null,
      status: details.subscription_status ?? null,
      fetchedAt,
      error: null,
    };
  } catch (err: any) {
    return {
      subscriptionType: 'unknown',
      isActive: null,
      status: null,
      fetchedAt,
      error: err?.name === 'AbortError' ? 'timeout' : String(err?.message || 'fetch_failed'),
    };
  }
}
