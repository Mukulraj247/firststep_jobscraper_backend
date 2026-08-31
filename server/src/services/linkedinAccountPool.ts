import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';

export type LinkedInAccount = {
  id: string;
  email: string;
  password: string;
};

export type LinkedInAccountPoolState = {
  nextIndex: number;
  lastUsedAccountId: string | null;
  linkedInRunsInFlight: number;
  accounts: Record<
    string,
    {
      lastUsedAt: number | null;
      cooldownUntil: number | null;
      inUseByRunId: string | null;
      runsToday: number;
      runsTodayDate: string;
      lastError: string | null;
    }
  >;
};

export class LinkedInAccountPoolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LinkedInAccountPoolError';
  }
}

const POOL_STATE_PATH = path.resolve(process.cwd(), '.runtime', 'linkedin-account-pool.json');
const MAX_ACCOUNTS = 5;

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

export function getLinkedInPoolConfig() {
  return {
    minSpacingMs: envInt('LINKEDIN_ACCOUNT_MIN_SPACING_MINUTES', 30) * 60_000,
    cooldownMs: envInt('LINKEDIN_ACCOUNT_COOLDOWN_MINUTES', 60) * 60_000,
    maxRunsPerDay: envInt('LINKEDIN_ACCOUNT_MAX_RUNS_PER_DAY', 24),
    maxConcurrentRuns: Math.max(1, envInt('LINKEDIN_MAX_CONCURRENT_RUNS', 1)),
  };
}

export function loadLinkedInAccountsFromEnv(): LinkedInAccount[] {
  const accounts: LinkedInAccount[] = [];
  for (let i = 1; i <= MAX_ACCOUNTS; i += 1) {
    const email = String(process.env[`LINKEDIN_ACCOUNT_${i}_EMAIL`] || '').trim();
    const password = String(process.env[`LINKEDIN_ACCOUNT_${i}_PASSWORD`] || '').trim();
    if (email && password) {
      accounts.push({ id: String(i), email, password });
    }
  }
  return accounts;
}

export function hasLinkedInAccountPoolConfigured(): boolean {
  return loadLinkedInAccountsFromEnv().length > 0;
}

function utcDayKey(nowMs: number = Date.now()): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

async function ensureRuntimeDir(): Promise<void> {
  await mkdir(path.dirname(POOL_STATE_PATH), { recursive: true });
}

function defaultAccountState(): LinkedInAccountPoolState['accounts'][string] {
  return {
    lastUsedAt: null,
    cooldownUntil: null,
    inUseByRunId: null,
    runsToday: 0,
    runsTodayDate: utcDayKey(),
    lastError: null,
  };
}

function defaultPoolState(accountIds: string[]): LinkedInAccountPoolState {
  const accounts: LinkedInAccountPoolState['accounts'] = {};
  for (const id of accountIds) {
    accounts[id] = defaultAccountState();
  }
  return {
    nextIndex: 0,
    lastUsedAccountId: null,
    linkedInRunsInFlight: 0,
    accounts,
  };
}

async function readPoolState(): Promise<LinkedInAccountPoolState> {
  const envAccounts = loadLinkedInAccountsFromEnv();
  const ids = envAccounts.map((a) => a.id);
  if (!ids.length) {
    return defaultPoolState([]);
  }
  try {
    const raw = await readFile(POOL_STATE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as LinkedInAccountPoolState;
    const accounts = { ...defaultPoolState(ids).accounts, ...(parsed.accounts || {}) };
    for (const id of ids) {
      if (!accounts[id]) accounts[id] = defaultAccountState();
    }
    for (const key of Object.keys(accounts)) {
      if (!ids.includes(key)) delete accounts[key];
    }
    return {
      nextIndex: typeof parsed.nextIndex === 'number' ? parsed.nextIndex : 0,
      lastUsedAccountId:
        parsed.lastUsedAccountId != null ? String(parsed.lastUsedAccountId) : null,
      linkedInRunsInFlight:
        typeof parsed.linkedInRunsInFlight === 'number' ? parsed.linkedInRunsInFlight : 0,
      accounts,
    };
  } catch {
    return defaultPoolState(ids);
  }
}

async function writePoolState(state: LinkedInAccountPoolState): Promise<void> {
  await ensureRuntimeDir();
  await writeFile(POOL_STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
}

function resetDailyRunsIfNeeded(
  account: LinkedInAccountPoolState['accounts'][string],
  nowMs: number
): void {
  const day = utcDayKey(nowMs);
  if (account.runsTodayDate !== day) {
    account.runsTodayDate = day;
    account.runsToday = 0;
  }
}

function isAccountEligible(
  accountId: string,
  state: LinkedInAccountPoolState,
  cfg: ReturnType<typeof getLinkedInPoolConfig>,
  nowMs: number,
  excludeAccountId?: string | null
): boolean {
  if (excludeAccountId && accountId === excludeAccountId) return false;
  const account = state.accounts[accountId];
  if (!account) return false;
  resetDailyRunsIfNeeded(account, nowMs);
  if (account.inUseByRunId) return false;
  if (account.cooldownUntil != null && account.cooldownUntil > nowMs) return false;
  if (account.runsToday >= cfg.maxRunsPerDay) return false;
  if (
    account.lastUsedAt != null &&
    nowMs - account.lastUsedAt < cfg.minSpacingMs
  ) {
    return false;
  }
  return true;
}

function pickAccountId(
  state: LinkedInAccountPoolState,
  accountIds: string[],
  cfg: ReturnType<typeof getLinkedInPoolConfig>,
  nowMs: number,
  excludeAccountId?: string | null
): string | null {
  if (!accountIds.length) return null;

  const n = accountIds.length;
  for (let offset = 0; offset < n; offset += 1) {
    const idx = (state.nextIndex + offset) % n;
    const candidate = accountIds[idx];
    if (!isAccountEligible(candidate, state, cfg, nowMs, excludeAccountId)) continue;

    const otherEligibleExists = accountIds.some(
      (id) =>
        id !== candidate &&
        id !== excludeAccountId &&
        isAccountEligible(id, state, cfg, nowMs, excludeAccountId)
    );
    if (
      state.lastUsedAccountId &&
      candidate === state.lastUsedAccountId &&
      otherEligibleExists
    ) {
      continue;
    }

    return candidate;
  }
  return null;
}

export type LinkedInAccountLease = {
  accountId: string;
  email: string;
  password: string;
  runId: string;
};

export async function acquireLinkedInAccount(runId: string): Promise<LinkedInAccountLease> {
  const envAccounts = loadLinkedInAccountsFromEnv();
  if (!envAccounts.length) {
    throw new LinkedInAccountPoolError('No LinkedIn accounts configured in ENV');
  }
  const cfg = getLinkedInPoolConfig();
  const nowMs = Date.now();
  const state = await readPoolState();

  if (state.linkedInRunsInFlight >= cfg.maxConcurrentRuns) {
    throw new LinkedInAccountPoolError(
      `LinkedIn concurrent run limit reached (${cfg.maxConcurrentRuns})`
    );
  }

  const accountIds = envAccounts.map((a) => a.id);
  const accountId = pickAccountId(state, accountIds, cfg, nowMs);
  if (!accountId) {
    throw new LinkedInAccountPoolError(
      'No eligible LinkedIn accounts available (spacing, cooldown, or daily cap)'
    );
  }

  const account = state.accounts[accountId];
  account.inUseByRunId = runId;
  account.lastError = null;
  state.lastUsedAccountId = accountId;
  state.nextIndex = (accountIds.indexOf(accountId) + 1) % accountIds.length;
  state.linkedInRunsInFlight += 1;
  await writePoolState(state);

  const envAccount = envAccounts.find((a) => a.id === accountId)!;
  return {
    accountId,
    email: envAccount.email,
    password: envAccount.password,
    runId,
  };
}

export async function releaseLinkedInAccount(
  accountId: string,
  runId: string,
  outcome: 'ok' | 'blocked' | 'released',
  errorMessage?: string
): Promise<void> {
  const cfg = getLinkedInPoolConfig();
  const nowMs = Date.now();
  const state = await readPoolState();
  const account = state.accounts[accountId];
  if (!account) return;

  if (account.inUseByRunId === runId) {
    account.inUseByRunId = null;
  }
  state.linkedInRunsInFlight = Math.max(0, state.linkedInRunsInFlight - 1);

  resetDailyRunsIfNeeded(account, nowMs);
  if (outcome === 'ok') {
    account.lastUsedAt = nowMs;
    account.runsToday += 1;
    account.lastError = null;
  } else if (outcome === 'blocked') {
    account.cooldownUntil = nowMs + cfg.cooldownMs;
    account.lastError = errorMessage || 'blocked';
  } else {
    account.lastUsedAt = nowMs;
    account.lastError = errorMessage || null;
  }

  await writePoolState(state);
}

export function getLinkedInAccountById(accountId: string): LinkedInAccount | null {
  return loadLinkedInAccountsFromEnv().find((a) => a.id === accountId) || null;
}

export async function hasEligibleLinkedInAccounts(excludeAccountId?: string | null): Promise<boolean> {
  const envAccounts = loadLinkedInAccountsFromEnv();
  if (!envAccounts.length) return false;
  const cfg = getLinkedInPoolConfig();
  const nowMs = Date.now();
  const state = await readPoolState();
  if (state.linkedInRunsInFlight >= cfg.maxConcurrentRuns) return false;
  return (
    pickAccountId(
      state,
      envAccounts.map((a) => a.id),
      cfg,
      nowMs,
      excludeAccountId
    ) != null
  );
}
