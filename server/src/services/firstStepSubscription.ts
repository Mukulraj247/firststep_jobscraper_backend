import type { FirstStepPlanSnapshot } from '../models/PortalUser';
import { displayFirstStepRole, isFirstStepStaffRole } from './firstStepRoles';
import logger from '../logger';

export function getFirstStepApiBaseUrl(): string {
  return String(process.env.FIRSTSTEP_API_BASE_URL || 'http://localhost:5000').replace(/\/$/, '');
}

type SubscriptionDetails = {
  subscription_type?: string;
  is_active?: boolean;
  subscription_status?: string;
  user_role?: string;
  user_id?: string;
  user_email?: string;
} | null;

export type FirstStepAccountSnapshot = {
  plan: FirstStepPlanSnapshot;
  /** Auth0/Mongo role e.g. Application_Incharge, Job_Collector, Super_Admin, user */
  role: string | null;
};

async function fetchJson(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; body: any }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      ...init,
      headers: { Accept: 'application/json', ...(init?.headers || {}) },
      signal: controller.signal,
    });
    clearTimeout(timer);
    let body: any = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { ok: res.ok, status: res.status, body };
  } catch (err: any) {
    clearTimeout(timer);
    throw err;
  }
}

function snapshotFromDetails(
  details: SubscriptionDetails,
  fetchedAt: Date,
  error: string | null = null
): FirstStepPlanSnapshot {
  if (!details) {
    return {
      subscriptionType: 'Normal Plan',
      isActive: true,
      status: 'active',
      fetchedAt,
      error,
    };
  }
  return {
    subscriptionType: details.subscription_type ?? 'Normal Plan',
    isActive: typeof details.is_active === 'boolean' ? details.is_active : null,
    status: details.subscription_status ?? null,
    fetchedAt,
    error,
  };
}

function extractDetails(body: any): SubscriptionDetails {
  return body?.data?.subscription_details ?? body?.subscription_details ?? null;
}

function roleFromDetails(details: SubscriptionDetails): string | null {
  const raw = details?.user_role;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

async function getSubscriptionByUserId(userId: string): Promise<{
  ok: boolean;
  status: number;
  details: SubscriptionDetails;
  error?: string;
}> {
  const base = getFirstStepApiBaseUrl();
  const url = `${base}/firstStep/subscription/getByUserId?user_id=${encodeURIComponent(userId)}`;
  const { ok, status, body } = await fetchJson(url, { method: 'GET' });
  if (!ok) {
    return { ok: false, status, details: null, error: `http_${status}` };
  }
  return { ok: true, status, details: extractDetails(body) };
}

/**
 * Fetch First Step plan + role for a portal user.
 * Never throws — plan.error is set on failure so login still succeeds.
 */
export async function fetchFirstStepAccount(
  auth0Sub: string | null | undefined,
  email?: string | null
): Promise<FirstStepAccountSnapshot> {
  const fetchedAt = new Date();
  if (!auth0Sub && !email) {
    return {
      plan: {
        subscriptionType: null,
        isActive: null,
        status: null,
        fetchedAt,
        error: 'missing_auth0_sub',
      },
      role: null,
    };
  }

  const triedIds: string[] = [];
  const candidates: string[] = [];
  if (auth0Sub) candidates.push(auth0Sub);
  if (email && email !== auth0Sub) candidates.push(email);

  let lastError: string | null = null;
  let role: string | null = null;

  try {
    for (const id of candidates) {
      triedIds.push(id);
      const result = await getSubscriptionByUserId(id);
      if (!result.ok) {
        lastError = result.error || `http_${result.status}`;
        continue;
      }
      if (result.details) {
        role = roleFromDetails(result.details) || role;
        const plan = snapshotFromDetails(result.details, fetchedAt, null);
        if (isFirstStepStaffRole(role)) {
          // Staff have no customer plan — keep type null so UI shows role, not Standard/Unknown.
          return {
            plan: {
              ...plan,
              subscriptionType: null,
              isActive: false,
              status: 'staff',
            },
            role,
          };
        }
        return { plan, role };
      }
    }

    if (email) {
      const resolved = await resolveFirstStepUserByEmail(email);
      if (resolved.role) role = resolved.role;
      if (resolved.userId && !triedIds.includes(resolved.userId)) {
        const result = await getSubscriptionByUserId(resolved.userId);
        if (result.ok && result.details) {
          role = roleFromDetails(result.details) || role;
          const plan = snapshotFromDetails(result.details, fetchedAt, null);
          if (isFirstStepStaffRole(role)) {
            return {
              plan: {
                ...plan,
                subscriptionType: null,
                isActive: false,
                status: 'staff',
              },
              role,
            };
          }
          return { plan, role };
        }
        if (!result.ok) lastError = result.error || `http_${result.status}`;
      }

      // No subscription row but we know the First Step user (common for staff).
      if (resolved.userId || role) {
        if (isFirstStepStaffRole(role)) {
          return {
            plan: {
              subscriptionType: null,
              isActive: false,
              status: 'staff',
              fetchedAt,
              error: null,
            },
            role,
          };
        }
        return {
          plan: snapshotFromDetails(null, fetchedAt, null),
          role,
        };
      }
    }

    if (!lastError) {
      return { plan: snapshotFromDetails(null, fetchedAt, null), role };
    }

    return {
      plan: {
        subscriptionType: 'unknown',
        isActive: null,
        status: null,
        fetchedAt,
        error: lastError,
      },
      role,
    };
  } catch (err: any) {
    return {
      plan: {
        subscriptionType: 'unknown',
        isActive: null,
        status: null,
        fetchedAt,
        error: err?.name === 'AbortError' ? 'timeout' : String(err?.message || 'fetch_failed'),
      },
      role,
    };
  }
}

/** @deprecated Prefer fetchFirstStepAccount — kept for call sites that only need the plan. */
export async function fetchFirstStepPlanSnapshot(
  auth0Sub: string | null | undefined,
  email?: string | null
): Promise<FirstStepPlanSnapshot> {
  const { plan } = await fetchFirstStepAccount(auth0Sub, email);
  return plan;
}

/** First Step AIC category enum — keep aligned with deployed First Step JOB_CATEGORIES. */
const FIRSTSTEP_JOB_CATEGORIES = [
  'Full Stack Developer',
  'Software Developer',
  'Data Scientist',
  'Data Analyst',
  'Data Engineer',
  'Network Security Engineer',
  'Application Security Engineer',
  'Cloud Security Engineer',
  'Cyber Security Analyst',
  'DevOps Engineer',
  'Product Management',
  'Mechanical Engineer',
  'Business Analyst',
  'AI ML Engineer',
  'Salesforce Developer',
  'QA',
  'Health Care',
  'SAP',
  'Electrical',
  'Service Now',
  'Finance',
  'Other 1',
  'Other 2',
  'Other 3',
  'Other 4',
  'Other 5',
] as const;

export type FirstStepJobCategory = (typeof FIRSTSTEP_JOB_CATEGORIES)[number];

/**
 * Map ScoutX listing category / frozen roles / title → First Step JOB_CATEGORIES.
 * Always returns a value present in the deployed First Step dropdown so Activate never rejects.
 */
export function mapScoutXCategoryToFirstStep(opts: {
  jobCategory?: string | null;
  frozenCategories?: string[] | null;
  title?: string | null;
}): FirstStepJobCategory {
  const tokens = [
    opts.jobCategory,
    ...(Array.isArray(opts.frozenCategories) ? opts.frozenCategories : []),
    opts.title,
  ]
    .map((t) => String(t || '').trim())
    .filter(Boolean);

  for (const token of tokens) {
    const exact = FIRSTSTEP_JOB_CATEGORIES.find((c) => c.toLowerCase() === token.toLowerCase());
    if (exact) return exact;
    // Legacy ScoutX / First Step alias
    if (/^others?$/i.test(token)) return 'Other 1';
  }

  const blob = tokens.join(' ').toLowerCase();

  if (/salesforce/.test(blob)) return 'Salesforce Developer';
  if (/full[\s-]?stack/.test(blob)) return 'Full Stack Developer';
  if (/\b(ai|ml|machine learning|llm)\b/.test(blob)) return 'AI ML Engineer';
  if (/data scientist|data science/.test(blob)) return 'Data Scientist';
  if (/data analyst|analytics/.test(blob)) return 'Data Analyst';
  if (/data engineer|etl|pipeline/.test(blob)) return 'Data Engineer';
  if (/devops|sre|site reliability|platform engineer/.test(blob)) return 'DevOps Engineer';
  if (/cloud security/.test(blob)) return 'Cloud Security Engineer';
  if (/app(lication)? security|appsec/.test(blob)) return 'Application Security Engineer';
  if (/network security/.test(blob)) return 'Network Security Engineer';
  if (/cyber|security analyst|infosec/.test(blob)) return 'Cyber Security Analyst';
  if (/product manag|product owner/.test(blob)) return 'Product Management';
  if (/business analyst|\bba\b/.test(blob)) return 'Business Analyst';
  if (/mechanical/.test(blob)) return 'Mechanical Engineer';
  if (/\bqa\b|quality assurance|test engineer|sdet/.test(blob)) return 'QA';
  if (/health\s?care|hospital|nurse|clinical|medical/.test(blob)) return 'Health Care';
  if (/\bsap\b/.test(blob)) return 'SAP';
  if (/electrical|electronics/.test(blob)) return 'Electrical';
  if (/service\s?now|servicenow/.test(blob)) return 'Service Now';
  if (/finance|fintech|accounting|cpa|fp&a/.test(blob)) return 'Finance';
  if (
    /software|backend|frontend|front-end|back-end|engineer|developer|swe|sde|programming/.test(blob)
  ) {
    return 'Software Developer';
  }
  return 'Other 1';
}

function extractExperienceYears(raw: unknown): string {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return String(Math.max(0, Math.min(15, raw)));
  }
  const text = String(raw || '').trim();
  if (!text) return '';
  const range = text.match(/(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)/);
  if (range) return range[1];
  const single = text.match(/(\d+(?:\.\d+)?)/);
  if (single) return String(Math.max(0, Math.min(15, Number(single[1]))));
  return '';
}

export type AssignOdJobPayload = {
  email: string | null | undefined;
  jobUrl: string;
  jobTitle: string;
  companyName: string;
  jobDescription?: string;
  jobCategory?: string | null;
  frozenCategories?: string[] | null;
  companyLogo?: string;
  location?: string;
  jobExperience?: string | number | null;
  frozenExperienceYears?: string[] | null;
  jobEmploymentType?: string;
  jobSalary?: string;
  jobWorkPlaceType?: string;
  jobSeniorityLevel?: string;
  companyUrl?: string;
  h1bEligible?: boolean;
};

export type AssignOdJobResult =
  | {
      ok: true;
      status: 'assigned';
      newJobs: number;
      aicUserId: string | null;
      firstStepUserId: string;
      jobCategory: string;
    }
  | {
      ok: true;
      status: 'already_assigned';
      newJobs: number;
      urlDuplicates: number;
      aicUserId: string | null;
      firstStepUserId: string;
      jobCategory: string;
    }
  | {
      ok: false;
      status: 'no_firststep_account' | 'no_application_incharge' | 'firststep_error' | 'invalid_url';
      message: string;
    };

type FirstStepUserRow = {
  userId: string | null;
  role: string | null;
  applicationRepresentativeUserId: string | null;
  name: string | null;
};

/** Resolve First Step Mongo user via email (user_id + role + AIC). */
export async function resolveFirstStepUserByEmail(email: string): Promise<FirstStepUserRow> {
  const base = getFirstStepApiBaseUrl();
  const url = `${base}/firstStep/user/getByEmail`;
  try {
    const { ok, body } = await fetchJson(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    if (!ok) return { userId: null, role: null, applicationRepresentativeUserId: null, name: null };
    const user = body?.data ?? body?.user ?? body;
    const id =
      (typeof user?.user_id === 'string' && user.user_id) ||
      (typeof user?.id === 'string' && user.id) ||
      (typeof user?._id === 'string' && user._id) ||
      (user?._id?.toString && user._id.toString()) ||
      null;
    const role =
      (typeof user?.role === 'string' && user.role.trim()) ||
      (typeof user?.user_role === 'string' && user.user_role.trim()) ||
      null;
    const aic =
      (typeof user?.application_representative_user_id === 'string' &&
        user.application_representative_user_id.trim()) ||
      null;
    const name = (typeof user?.name === 'string' && user.name.trim()) || null;
    return {
      userId: id ? String(id) : null,
      role,
      applicationRepresentativeUserId: aic,
      name,
    };
  } catch {
    return { userId: null, role: null, applicationRepresentativeUserId: null, name: null };
  }
}

/**
 * Assign a ScoutX feed job into First Step Application Incharge OD Jobs
 * (user_JB_added_jobs — same path as First Step Job Board Assign).
 * Maps ScoutX listing fields so AIC Edit & Activate is pre-filled.
 */
export async function assignJobUrlToOdJobs(opts: AssignOdJobPayload): Promise<AssignOdJobResult> {
  const jobUrl = String(opts.jobUrl || '').trim();
  if (!jobUrl || !/^https?:\/\//i.test(jobUrl)) {
    return { ok: false, status: 'invalid_url', message: 'Job URL is missing or invalid' };
  }

  const jobTitle = String(opts.jobTitle || '').trim();
  const companyName = String(opts.companyName || '').trim();
  if (!jobTitle || !companyName) {
    return {
      ok: false,
      status: 'invalid_url',
      message: 'Job title and company are required to assign to Application Incharge',
    };
  }

  const email = String(opts.email || '').trim().toLowerCase();
  if (!email) {
    return {
      ok: false,
      status: 'no_firststep_account',
      message: 'No email on your ScoutX account — cannot match a First Step user',
    };
  }

  const resolved = await resolveFirstStepUserByEmail(email);
  if (!resolved.userId) {
    return {
      ok: false,
      status: 'no_firststep_account',
      message: 'No First Step account found for your email. Sign up on First Step first.',
    };
  }

  if (!resolved.applicationRepresentativeUserId) {
    return {
      ok: false,
      status: 'no_application_incharge',
      message:
        'No Application Incharge is linked to your First Step account. Ask ops to set Application Representative first.',
    };
  }

  const jobCategory = mapScoutXCategoryToFirstStep({
    jobCategory: opts.jobCategory,
    frozenCategories: opts.frozenCategories,
    title: jobTitle,
  });

  const experienceRaw =
    opts.jobExperience ??
    (Array.isArray(opts.frozenExperienceYears) ? opts.frozenExperienceYears[0] : '') ??
    '';
  const jobExperience = extractExperienceYears(experienceRaw);

  const workMode = String(opts.jobWorkPlaceType || '').trim();
  const visa =
    opts.h1bEligible === true ? 'H-1B / sponsorship friendly (ScoutX signal)' : '';

  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T12:00:00.000Z`;

  const base = getFirstStepApiBaseUrl();
  try {
    const { ok, status, body } = await fetchJson(`${base}/api/jb-jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        user_id: resolved.userId,
        date: dateStr,
        job_url: jobUrl,
        jobTitle,
        companyName,
        jobDescription: String(opts.jobDescription || '').trim(),
        jobCategory,
        companyLogo: String(opts.companyLogo || '').trim(),
        location: String(opts.location || '').trim(),
        jobExperience,
        jobEmploymentType: String(opts.jobEmploymentType || '').trim(),
        jobSalary: String(opts.jobSalary || '').trim(),
        jobSkills: '',
        jobSource: 'ScoutX',
        jobVisaSponsorship: visa,
        jobWorkPlaceType: workMode,
        jobSeniorityLevel: String(opts.jobSeniorityLevel || '').trim(),
        companyUrl: String(opts.companyUrl || '').trim(),
      }),
    });

    if (!ok) {
      logger.log(
        'warn',
        `assign OD job failed http_${status}: ${typeof body === 'object' ? JSON.stringify(body)?.slice(0, 300) : body}`,
      );
      return {
        ok: false,
        status: 'firststep_error',
        message: body?.error || `First Step rejected the assignment (HTTP ${status})`,
      };
    }

    if (body?.success === false) {
      return {
        ok: false,
        status: 'firststep_error',
        message: body?.error || 'First Step could not create the OD job',
      };
    }

    if (body?.duplicate) {
      return {
        ok: true,
        status: 'already_assigned',
        newJobs: 0,
        urlDuplicates: 1,
        aicUserId: resolved.applicationRepresentativeUserId,
        firstStepUserId: resolved.userId,
        jobCategory,
      };
    }

    return {
      ok: true,
      status: 'assigned',
      newJobs: Number(body?.data?.newJobs || 1),
      aicUserId: resolved.applicationRepresentativeUserId,
      firstStepUserId: resolved.userId,
      jobCategory,
    };
  } catch (err: any) {
    logger.log('error', `assign OD job: ${err?.message || err}`);
    return {
      ok: false,
      status: 'firststep_error',
      message: err?.message || 'Could not reach First Step',
    };
  }
}

export { displayFirstStepRole, isFirstStepStaffRole };
