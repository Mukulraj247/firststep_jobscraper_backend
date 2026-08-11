/**
 * Suggest / preserve failureReason on list-extraction finish,
 * and classify common scrape failures from error text.
 */

export type FailureReasonSource = 'suggested' | 'confirmed' | 'override';

/** Canonical failure-reason codes persisted on Run.failureReason */
export const FAILURE_REASON_CODES = [
  'layout_change',
  'captcha',
  'browser_closed',
  'navigation_error',
  'timeout',
  'circuit_open',
  'unknown',
] as const;

export type FailureReasonCode = (typeof FAILURE_REASON_CODES)[number];

export const FAILURE_REASON_LABELS: Record<FailureReasonCode, string> = {
  layout_change: 'Layout change',
  captcha: 'CAPTCHA',
  browser_closed: 'Browser closed',
  navigation_error: 'Navigation error',
  timeout: 'Timeout',
  circuit_open: 'Host circuit open',
  unknown: 'Unknown',
};

export function isAllowedFailureReason(code: string): code is FailureReasonCode {
  return (FAILURE_REASON_CODES as readonly string[]).includes(code);
}

/**
 * Map an errorMessage / log snippet to a suggested failureReason code.
 * Used when marking runs failed/dead and when hydrating older runs that only have errorMessage.
 */
export function classifyFailureReason(errorMessage: string | null | undefined): FailureReasonCode | null {
  const msg = String(errorMessage || '').trim();
  if (!msg) return null;
  const lower = msg.toLowerCase();

  if (
    lower.includes('captcha') ||
    lower.includes('re-captcha') ||
    lower.includes('recaptcha') ||
    lower.includes('hcaptcha')
  ) {
    return 'captcha';
  }

  if (
    lower.includes('target page, context or browser has been closed') ||
    lower.includes('browser has been closed') ||
    (lower.includes('browsercontext') && lower.includes('closed')) ||
    lower.includes('target closed') ||
    lower.includes('session closed')
  ) {
    return 'browser_closed';
  }

  if (lower.includes('circuit open') || lower.includes('host circuit')) {
    return 'circuit_open';
  }

  if (
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('navigation timeout') ||
    lower.includes('exceeded')
  ) {
    return 'timeout';
  }

  if (
    lower.includes('page.goto') ||
    lower.includes('net::err') ||
    lower.includes('navigation') ||
    lower.includes('err_name_not_resolved') ||
    lower.includes('err_connection')
  ) {
    return 'navigation_error';
  }

  if (
    lower.includes('zero rows') ||
    lower.includes('layout') ||
    lower.includes('selector')
  ) {
    return 'layout_change';
  }

  return 'unknown';
}

export function applyLayoutChangeSuggestion(opts: {
  anomaly: string | null | undefined;
  runStatus: string;
  rows: number;
  failureReason?: string | null;
  failureReasonSource?: string | null;
}): { failureReason: string | null; failureReasonSource: FailureReasonSource | null } {
  const existingReason = opts.failureReason || null;
  const existingSource = (opts.failureReasonSource as FailureReasonSource | null) || null;

  const shouldSuggest =
    opts.anomaly === 'zero_rows' || (opts.runStatus === 'failed' && opts.rows === 0);

  if (!shouldSuggest) {
    return { failureReason: existingReason, failureReasonSource: existingSource };
  }

  // Do not overwrite operator-confirmed / override values.
  if (existingReason && existingSource && existingSource !== 'suggested') {
    return { failureReason: existingReason, failureReasonSource: existingSource };
  }

  return { failureReason: 'layout_change', failureReasonSource: 'suggested' };
}

/**
 * Resolve the reason to show / persist: keep confirmed/override; else classify from error text.
 */
export function resolveFailureReason(opts: {
  failureReason?: string | null;
  failureReasonSource?: string | null;
  errorMessage?: string | null;
}): { failureReason: string | null; failureReasonSource: FailureReasonSource | null } {
  const existingReason = opts.failureReason || null;
  const existingSource = (opts.failureReasonSource as FailureReasonSource | null) || null;

  if (existingReason && existingSource && existingSource !== 'suggested') {
    return { failureReason: existingReason, failureReasonSource: existingSource };
  }

  const classified = classifyFailureReason(opts.errorMessage);
  if (classified) {
    // Prefer an existing suggested layout_change over a weaker reclassify only if
    // the error text does not clearly point elsewhere.
    if (existingReason && existingSource === 'suggested' && !opts.errorMessage) {
      return { failureReason: existingReason, failureReasonSource: existingSource };
    }
    return { failureReason: classified, failureReasonSource: 'suggested' };
  }

  return { failureReason: existingReason, failureReasonSource: existingSource };
}
