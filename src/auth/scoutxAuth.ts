import axios from 'axios';
import { apiUrl } from '../apiConfig';

export const SCOUTX_ADMIN_ROLE = 'ScoutX_Admin';
export const SCOUTX_USER_ROLE = 'ScoutX_User';

export type ScoutXRole = typeof SCOUTX_ADMIN_ROLE | typeof SCOUTX_USER_ROLE;

export type FirstStepPlanSession = {
  subscriptionType: string | null;
  isActive: boolean | null;
  status: string | null;
};

export type Auth0ExchangeResult = {
  id: string;
  email: string;
  name?: string;
  auth0Sub?: string | null;
  /** Pinned ops Mongo owner email (ownership); UI email is the Auth0 actor. */
  opsOwnerEmail?: string | null;
  scoutxRoles: ScoutXRole[];
  authSource: 'auth0';
  landing: '/dashboard' | '/user';
  firstStepPlan?: FirstStepPlanSession | null;
  firstStepRole?: string | null;
};

export function hasScoutXAdmin(roles: string[] | undefined | null): boolean {
  return Array.isArray(roles) && roles.includes(SCOUTX_ADMIN_ROLE);
}

export function hasScoutXUser(roles: string[] | undefined | null): boolean {
  return (
    Array.isArray(roles) &&
    (roles.includes(SCOUTX_USER_ROLE) || roles.includes(SCOUTX_ADMIN_ROLE))
  );
}

export function landingPathForRoles(
  roles: string[] | undefined | null
): '/dashboard' | '/user' | '/no-access' {
  if (hasScoutXAdmin(roles)) return '/dashboard';
  if (hasScoutXUser(roles)) return '/user';
  return '/no-access';
}

/**
 * Trade Auth0 access token (+ ID-token email) for ScoutX session.
 * Admin → httpOnly cookie with Mongo ops id. User → portal identity JSON.
 */
export async function exchangeAuth0Token(opts: {
  accessToken: string;
  email?: string | null;
  name?: string | null;
  firstStepRole?: string | null;
}): Promise<Auth0ExchangeResult> {
  const { data } = await axios.post(
    `${apiUrl}/auth/auth0/exchange`,
    {
      email: opts.email || undefined,
      name: opts.name || undefined,
      firstStepRole: opts.firstStepRole || undefined,
    },
    {
      withCredentials: true,
      headers: {
        Authorization: `Bearer ${opts.accessToken}`,
      },
    }
  );
  return data as Auth0ExchangeResult;
}
