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

  // A null reason with override source is an explicit operator clear. Keep the
  // diagnostic error text, but do not immediately auto-classify it again.
  if (!existingReason && existingSource === 'override') {
    return { failureReason: null, failureReasonSource: existingSource };
  }

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

/**
 * Canonical list/filter value. This is deliberately independent from the
 * display/source pair so the same persisted code is used by rows, filters,
 * and reason counts.
 */
export function normalizeFailureReason(opts: {
  normalizedFailureReason?: string | null;
  failureReason?: string | null;
  failureReasonSource?: string | null;
  errorMessage?: string | null;
}): FailureReasonCode | null {
  if (!opts.failureReason && opts.failureReasonSource === 'override') {
    return null;
  }
  if (opts.normalizedFailureReason && isAllowedFailureReason(opts.normalizedFailureReason)) {
    return opts.normalizedFailureReason;
  }
  const resolved = resolveFailureReason(opts);
  return resolved.failureReason && isAllowedFailureReason(resolved.failureReason)
    ? resolved.failureReason
    : null;
}

/**
 * MongoDB equivalent of normalizeFailureReason. List rows, reason filters,
 * and reason counts must all add this field before using it so legacy rows
 * cannot be classified differently depending on how they are read.
 */
export function buildNormalizedFailureReasonExpression(): Record<string, any> {
  const allowedCodes = [...FAILURE_REASON_CODES];
  const messageMatches = (regex: string) => ({
    $regexMatch: { input: '$$message', regex },
  });

  return {
    $let: {
      vars: {
        normalized: '$normalizedFailureReason',
        failure: '$failureReason',
        source: '$failureReasonSource',
        message: {
          $toLower: {
            $convert: {
              input: { $ifNull: ['$errorMessage', ''] },
              to: 'string',
              onError: '',
              onNull: '',
            },
          },
        },
      },
      in: {
        $cond: [
          {
            $and: [
              { $eq: ['$$failure', null] },
              { $eq: ['$$source', 'override'] },
            ],
          },
          null,
          {
            $cond: [
              { $in: ['$$normalized', allowedCodes] },
              '$$normalized',
              {
                $cond: [
                  {
                    $and: [
                      { $in: ['$$failure', allowedCodes] },
                      { $ne: ['$$source', null] },
                      { $ne: ['$$source', 'suggested'] },
                    ],
                  },
                  '$$failure',
                  {
                    $switch: {
                      branches: [
                        {
                          case: messageMatches('(captcha|re-captcha|recaptcha|hcaptcha)'),
                          then: 'captcha',
                        },
                        {
                          case: messageMatches(
                            '(target page, context or browser has been closed|browser has been closed|browsercontext.*closed|target closed|session closed)'
                          ),
                          then: 'browser_closed',
                        },
                        {
                          case: messageMatches('(circuit open|host circuit)'),
                          then: 'circuit_open',
                        },
                        {
                          case: messageMatches('(timeout|timed out|navigation timeout|exceeded)'),
                          then: 'timeout',
                        },
                        {
                          case: messageMatches(
                            '(page\\.goto|net::err|navigation|err_name_not_resolved|err_connection)'
                          ),
                          then: 'navigation_error',
                        },
                        {
                          case: messageMatches('(zero rows|layout|selector)'),
                          then: 'layout_change',
                        },
                      ],
                      default: {
                        $cond: [
                          { $ne: ['$$message', ''] },
                          'unknown',
                          {
                            $cond: [
                              { $in: ['$$failure', allowedCodes] },
                              '$$failure',
                              null,
                            ],
                          },
                        ],
                      },
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    },
  };
}

export function buildFailureReasonAggregationStages(
  reasons: readonly string[] = []
): { page: Record<string, any>[]; counts: Record<string, any>[] } {
  const classificationStage = {
    $addFields: {
      normalizedFailureReason: buildNormalizedFailureReasonExpression(),
    },
  };
  const page: Record<string, any>[] = [classificationStage];
  if (reasons.length === 1 && reasons[0] !== 'unknown') {
    page.push({ $match: { normalizedFailureReason: reasons[0] } });
  } else if (reasons.length > 0) {
    const filterValues: Array<string | null> = [...reasons];
    if (reasons.includes('unknown')) {
      filterValues.push(null);
    }
    page.push({ $match: { normalizedFailureReason: { $in: filterValues } } });
  }

  return {
    page,
    counts: [
      classificationStage,
      {
        $group: {
          _id: { $ifNull: ['$normalizedFailureReason', 'unknown'] },
          count: { $sum: 1 },
        },
      },
    ],
  };
}
