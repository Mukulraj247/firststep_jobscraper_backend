import { describe, expect, it, vi } from 'vitest';
import { postJsonWithRetry } from './destinations';

const publicResolve = async () => [{ address: '93.184.216.34', family: 4 }];

describe('postJsonWithRetry', () => {
  it('preserves zero configured retries', async () => {
    const transport = vi.fn().mockRejectedValue(new Error('delivery failed'));

    await expect(postJsonWithRetry('https://hooks.example/event', {}, {
      retryAttempts: 0,
      delayMs: 1,
      timeoutMs: 50,
      transport,
      resolve: publicResolve,
    })).rejects.toThrow('delivery failed');

    expect(transport).toHaveBeenCalledOnce();
  });

  it('enforces the overall delivery deadline', async () => {
    const transport = vi.fn(() => new Promise<never>(() => undefined));

    await expect(postJsonWithRetry('https://hooks.example/event', {}, {
      retryAttempts: 0,
      timeoutMs: 100,
      deadlineMs: 10,
      transport,
      resolve: publicResolve,
    })).rejects.toThrow('delivery deadline');
  });
});
