import {
  normalizeFailureReason,
  resolveFailureReason,
} from '../utils/failureReason';

/**
 * A retryable scrape failure is re-queued as `pending` before its next
 * execution. Any other terminal state must be immutable to duplicate queue
 * deliveries, otherwise a later job can overwrite the original outcome.
 */
export const ACTIVE_RUN_STATUSES = [
  'pending',
  'queued',
  'scheduled',
  'running',
  'aborting',
] as const;

export const TERMINAL_RUN_STATUSES = [
  'completed',
  'success',
  'failed',
  'dead',
  'aborted',
] as const;

export const isTerminalRunStatus = (status?: string | null): boolean =>
  TERMINAL_RUN_STATUSES.includes(
    String(status || '').toLowerCase() as (typeof TERMINAL_RUN_STATUSES)[number]
  );

export const isFailureRunStatus = (status?: string | null): boolean =>
  status === 'failed' || status === 'dead';

export function addFailureClassificationToTerminalUpdate<T extends Record<string, any>>(
  update: T
): T {
  const fields = update?.$set ?? update;
  if (!isFailureRunStatus(fields?.status)) {
    return update;
  }
  if (!fields.failureReason && fields.failureReasonSource === 'override') {
    return update;
  }

  const resolved = resolveFailureReason({
    failureReason: fields.failureReason,
    failureReasonSource: fields.failureReasonSource,
    errorMessage: fields.errorMessage,
  });
  const existingNormalized = normalizeFailureReason({
    normalizedFailureReason: fields.normalizedFailureReason,
    failureReason: resolved.failureReason,
    failureReasonSource: resolved.failureReasonSource,
    errorMessage: fields.errorMessage,
  });
  const failureReason = resolved.failureReason || existingNormalized || 'unknown';
  const failureReasonSource = resolved.failureReasonSource || 'suggested';
  const classified = {
    ...fields,
    failureReason,
    failureReasonSource,
    normalizedFailureReason: normalizeFailureReason({
      normalizedFailureReason: fields.normalizedFailureReason,
      failureReason,
      failureReasonSource,
      errorMessage: fields.errorMessage,
    }) || failureReason,
  };

  return (update?.$set
    ? { ...update, $set: classified }
    : classified) as T;
}

export function addAdmissionGuardReleaseToTerminalUpdate<T extends Record<string, any>>(
  update: T
): T {
  const status = update?.$set?.status ?? update?.status;
  if (!isTerminalRunStatus(status)) {
    return update;
  }
  return {
    ...update,
    $unset: {
      ...(update.$unset || {}),
      activeAutomationKey: 1,
      accountActiveSlot: 1,
    },
  };
}
