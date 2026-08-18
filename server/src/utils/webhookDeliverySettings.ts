export type DestinationWebhookSettings = {
  retryAttempts: number;
  retryDelaySeconds: number;
  timeoutSeconds: number;
};

export type LegacyWebhookSettings = {
  retryAttempts: number;
  retryDelay: number;
  timeout: number;
};

const assertOptionalInteger = (
  input: Record<string, unknown>,
  field: string,
  min: number,
  max: number
) => {
  if (!Object.prototype.hasOwnProperty.call(input, field)) return;
  const value = input[field];
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    throw new RangeError(`${field} must be an integer between ${min} and ${max}`);
  }
};

export const validateDestinationWebhookSettings = (input: Record<string, unknown> = {}) => {
  assertOptionalInteger(input, 'retryAttempts', 0, 5);
  assertOptionalInteger(input, 'retryDelaySeconds', 1, 300);
  assertOptionalInteger(input, 'timeoutSeconds', 1, 30);
};

export const validateLegacyWebhookSettings = (input: Record<string, unknown> = {}) => {
  assertOptionalInteger(input, 'retryAttempts', 0, 5);
  assertOptionalInteger(input, 'retryDelay', 1, 300);
  assertOptionalInteger(input, 'timeout', 1, 30);
};

const storedInteger = (value: unknown, fallback: number, min: number, max: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
};

export const resolveStoredDestinationWebhookSettings = (
  input: Record<string, unknown> = {}
): DestinationWebhookSettings => ({
  retryAttempts: storedInteger(input.retryAttempts, 3, 0, 5),
  retryDelaySeconds: storedInteger(input.retryDelaySeconds, 5, 1, 300),
  timeoutSeconds: storedInteger(input.timeoutSeconds, 30, 1, 30),
});

export const resolveStoredLegacyWebhookSettings = (
  input: Record<string, unknown> = {}
): LegacyWebhookSettings => ({
  retryAttempts: storedInteger(input.retryAttempts, 3, 0, 5),
  retryDelay: storedInteger(input.retryDelay, 5, 1, 300),
  timeout: storedInteger(input.timeout, 30, 1, 30),
});
