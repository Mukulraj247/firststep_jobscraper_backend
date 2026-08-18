import { describe, expect, it } from 'vitest';
import {
  resolveStoredDestinationWebhookSettings,
  resolveStoredLegacyWebhookSettings,
  validateDestinationWebhookSettings,
  validateLegacyWebhookSettings,
} from './webhookDeliverySettings';

describe('webhook delivery setting validation', () => {
  it.each([
    ['retryAttempts', -1],
    ['retryAttempts', 6],
    ['retryAttempts', 1.5],
    ['retryDelaySeconds', 0],
    ['retryDelaySeconds', 301],
    ['retryDelaySeconds', 1.5],
    ['timeoutSeconds', 0],
    ['timeoutSeconds', 31],
    ['timeoutSeconds', 1.5],
  ])('rejects invalid destination %s=%s', (field, value) => {
    expect(() => validateDestinationWebhookSettings({ [field]: value })).toThrow(field);
  });

  it.each([
    ['retryAttempts', -1],
    ['retryAttempts', 6],
    ['retryAttempts', 1.5],
    ['retryDelay', 0],
    ['retryDelay', 301],
    ['timeout', 0],
    ['timeout', 31],
  ])('rejects invalid legacy %s=%s', (field, value) => {
    expect(() => validateLegacyWebhookSettings({ [field]: value })).toThrow(field);
  });

  it('preserves a configured zero retries', () => {
    expect(resolveStoredDestinationWebhookSettings({ retryAttempts: 0 })).toMatchObject({
      retryAttempts: 0,
    });
    expect(resolveStoredLegacyWebhookSettings({ retryAttempts: 0 })).toMatchObject({
      retryAttempts: 0,
    });
  });

  it('defensively clamps unsafe stored destination values', () => {
    expect(resolveStoredDestinationWebhookSettings({
      retryAttempts: 99,
      retryDelaySeconds: -4,
      timeoutSeconds: 90,
    })).toEqual({
      retryAttempts: 5,
      retryDelaySeconds: 1,
      timeoutSeconds: 30,
    });
  });

  it('defensively clamps unsafe stored legacy values', () => {
    expect(resolveStoredLegacyWebhookSettings({
      retryAttempts: 99,
      retryDelay: -4,
      timeout: 90,
    })).toEqual({
      retryAttempts: 5,
      retryDelay: 1,
      timeout: 30,
    });
  });
});
