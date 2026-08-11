import { describe, it, expect, afterEach } from 'vitest';
import { getConstrainedScraperFingerprintWarning } from './prodEnvGuard';

describe('getConstrainedScraperFingerprintWarning', () => {
  const keys = ['SCRAPER_MAX_ATTEMPTS', 'LOW_MEMORY_MODE', 'NODE_OPTIONS'] as const;
  const saved: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key]!;
      delete saved[key];
    }
  });

  function setEnv(partial: Partial<Record<(typeof keys)[number], string>>) {
    for (const key of keys) {
      if (!(key in saved)) saved[key] = process.env[key];
      if (partial[key] === undefined) delete process.env[key];
      else process.env[key] = partial[key]!;
    }
  }

  it('warns on Render free-tier fingerprint', () => {
    setEnv({
      SCRAPER_MAX_ATTEMPTS: '1',
      LOW_MEMORY_MODE: 'true',
      NODE_OPTIONS: '--max-old-space-size=192',
    });
    expect(getConstrainedScraperFingerprintWarning()).toMatch(/Constrained scraper fingerprint/);
  });

  it('stays quiet for DO-like defaults', () => {
    setEnv({
      SCRAPER_MAX_ATTEMPTS: '3',
      LOW_MEMORY_MODE: 'false',
      NODE_OPTIONS: '--max-old-space-size=1280',
    });
    expect(getConstrainedScraperFingerprintWarning()).toBeNull();
  });
});
