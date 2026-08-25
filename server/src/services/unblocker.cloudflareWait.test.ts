import { describe, expect, it, vi } from 'vitest';
import { waitForCloudflareToClear } from './unblocker';

describe('waitForCloudflareToClear', () => {
  it('returns false when the page is closed during the challenge poll (does not throw browser_closed)', async () => {
    const page = {
      isClosed: () => true,
      evaluate: vi.fn().mockResolvedValue(null),
      title: vi.fn().mockResolvedValue('Just a moment...'),
      innerText: vi.fn().mockResolvedValue(''),
      waitForLoadState: vi.fn().mockResolvedValue(undefined),
      waitForTimeout: vi.fn().mockRejectedValue(
        new Error('page.waitForTimeout: Target page, context or browser has been closed')
      ),
      url: vi.fn().mockReturnValue('https://jobs.uber.com/'),
    } as any;

    await expect(
      waitForCloudflareToClear(page, { timeoutMs: 5_000, pollMs: 50 })
    ).resolves.toBe(false);
  });
});
