import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'fs/promises';
import os from 'os';
import path from 'path';

describe('linkedinAccountPool', () => {
  let tmpDir: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'li-pool-'));
    await mkdir(path.join(tmpDir, '.runtime'), { recursive: true });
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
    delete process.env.LINKEDIN_ACCOUNT_1_EMAIL;
    delete process.env.LINKEDIN_ACCOUNT_1_PASSWORD;
    delete process.env.LINKEDIN_ACCOUNT_2_EMAIL;
    delete process.env.LINKEDIN_ACCOUNT_2_PASSWORD;
    delete process.env.LINKEDIN_ACCOUNT_MIN_SPACING_MINUTES;
    delete process.env.LINKEDIN_MAX_CONCURRENT_RUNS;
  });

  afterEach(async () => {
    cwdSpy.mockRestore();
    await rm(tmpDir, { recursive: true, force: true });
    vi.resetModules();
  });

  async function loadPool() {
    return import('./linkedinAccountPool');
  }

  it('loads accounts from ENV', async () => {
    process.env.LINKEDIN_ACCOUNT_1_EMAIL = 'a1@test.com';
    process.env.LINKEDIN_ACCOUNT_1_PASSWORD = 'pass1';
    process.env.LINKEDIN_ACCOUNT_2_EMAIL = 'a2@test.com';
    process.env.LINKEDIN_ACCOUNT_2_PASSWORD = 'pass2';
    const pool = await loadPool();
    expect(pool.loadLinkedInAccountsFromEnv()).toHaveLength(2);
    expect(pool.hasLinkedInAccountPoolConfigured()).toBe(true);
  });

  it('rotates accounts round-robin across acquire calls', async () => {
    process.env.LINKEDIN_ACCOUNT_1_EMAIL = 'a1@test.com';
    process.env.LINKEDIN_ACCOUNT_1_PASSWORD = 'pass1';
    process.env.LINKEDIN_ACCOUNT_2_EMAIL = 'a2@test.com';
    process.env.LINKEDIN_ACCOUNT_2_PASSWORD = 'pass2';
    process.env.LINKEDIN_ACCOUNT_3_EMAIL = 'a3@test.com';
    process.env.LINKEDIN_ACCOUNT_3_PASSWORD = 'pass3';
    process.env.LINKEDIN_ACCOUNT_MIN_SPACING_MINUTES = '0';

    const pool = await loadPool();
    const first = await pool.acquireLinkedInAccount('run-1');
    await pool.releaseLinkedInAccount(first.accountId, 'run-1', 'ok');
    const second = await pool.acquireLinkedInAccount('run-2');
    await pool.releaseLinkedInAccount(second.accountId, 'run-2', 'ok');
    const third = await pool.acquireLinkedInAccount('run-3');
    await pool.releaseLinkedInAccount(third.accountId, 'run-3', 'ok');

    expect([first.accountId, second.accountId, third.accountId]).toEqual(['1', '2', '3']);
  });

  it('persists pool cursor to disk', async () => {
    process.env.LINKEDIN_ACCOUNT_1_EMAIL = 'a1@test.com';
    process.env.LINKEDIN_ACCOUNT_1_PASSWORD = 'pass1';
    process.env.LINKEDIN_ACCOUNT_2_EMAIL = 'a2@test.com';
    process.env.LINKEDIN_ACCOUNT_2_PASSWORD = 'pass2';
    process.env.LINKEDIN_ACCOUNT_MIN_SPACING_MINUTES = '0';

    const pool1 = await loadPool();
    const lease = await pool1.acquireLinkedInAccount('run-a');
    await pool1.releaseLinkedInAccount(lease.accountId, 'run-a', 'ok');

    vi.resetModules();
    const pool2 = await loadPool();
    const next = await pool2.acquireLinkedInAccount('run-b');
    expect(next.accountId).toBe('2');
    await pool2.releaseLinkedInAccount(next.accountId, 'run-b', 'ok');

    const statePath = path.join(tmpDir, '.runtime', 'linkedin-account-pool.json');
    const raw = await readFile(statePath, 'utf8');
    const state = JSON.parse(raw);
    expect(state.nextIndex).toBeGreaterThanOrEqual(0);
  });

  it('cooldowns blocked accounts', async () => {
    process.env.LINKEDIN_ACCOUNT_1_EMAIL = 'a1@test.com';
    process.env.LINKEDIN_ACCOUNT_1_PASSWORD = 'pass1';
    process.env.LINKEDIN_ACCOUNT_2_EMAIL = 'a2@test.com';
    process.env.LINKEDIN_ACCOUNT_2_PASSWORD = 'pass2';
    process.env.LINKEDIN_ACCOUNT_MIN_SPACING_MINUTES = '0';
    process.env.LINKEDIN_ACCOUNT_COOLDOWN_MINUTES = '60';

    const pool = await loadPool();
    const first = await pool.acquireLinkedInAccount('run-block');
    await pool.releaseLinkedInAccount(first.accountId, 'run-block', 'blocked', 'challenge');
    const second = await pool.acquireLinkedInAccount('run-next');
    expect(second.accountId).toBe('2');
    await pool.releaseLinkedInAccount(second.accountId, 'run-next', 'ok');
  });
});
