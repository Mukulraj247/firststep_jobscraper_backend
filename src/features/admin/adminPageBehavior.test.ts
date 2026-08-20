import { describe, expect, it } from 'vitest';
import { webhookFieldCopy } from './adminPageBehavior';

describe('webhookFieldCopy', () => {
  it('does not throw when the edit target is null (dialog close animation)', () => {
    expect(() => webhookFieldCopy(null)).not.toThrow();
    expect(webhookFieldCopy(null)).toEqual({
      placeholder: 'https://',
      helperText: 'Optional. Enter a URL to enable a webhook.',
    });
  });

  it('tells the admin a webhook already exists', () => {
    expect(webhookFieldCopy({ webhookConfigured: true }).placeholder).toBe(
      'Leave blank to keep existing webhook',
    );
  });
});
