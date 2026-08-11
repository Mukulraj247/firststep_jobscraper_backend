/**
 * Collection-path backpressure: retry delay with jitter + per-host circuit breakers.
 * In-memory per worker process (not shared across droplets).
 */

export type ScrapeBackpressureConfig = {
  retryDelaysMs: number[];
  jitterRatio: number;
  breakerThreshold: number;
  breakerWindowMs: number;
  breakerCoolDownMs: number;
};

const DEFAULT_DELAYS = [30_000, 120_000, 600_000];

export function loadScrapeBackpressureConfig(
  env: NodeJS.ProcessEnv = process.env
): ScrapeBackpressureConfig {
  const rawDelays = String(env.SCRAPE_RETRY_DELAYS_MS || '').trim();
  let retryDelaysMs = DEFAULT_DELAYS;
  if (rawDelays) {
    const parsed = rawDelays
      .split(',')
      .map((s) => Number.parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n) && n >= 0);
    if (parsed.length > 0) retryDelaysMs = parsed;
  }

  const jitterRatio = Number.parseFloat(String(env.SCRAPE_RETRY_JITTER_RATIO ?? '0.2'));
  const breakerThreshold = Number.parseInt(String(env.SCRAPE_HOST_BREAKER_THRESHOLD ?? '5'), 10);
  const breakerWindowMs = Number.parseInt(String(env.SCRAPE_HOST_BREAKER_WINDOW_MS ?? '120000'), 10);
  const breakerCoolDownMs = Number.parseInt(
    String(env.SCRAPE_HOST_BREAKER_COOLDOWN_MS ?? '600000'),
    10
  );

  return {
    retryDelaysMs,
    jitterRatio:
      Number.isFinite(jitterRatio) && jitterRatio >= 0 && jitterRatio <= 1 ? jitterRatio : 0.2,
    breakerThreshold:
      Number.isFinite(breakerThreshold) && breakerThreshold >= 1 ? breakerThreshold : 5,
    breakerWindowMs:
      Number.isFinite(breakerWindowMs) && breakerWindowMs >= 1000 ? breakerWindowMs : 120_000,
    breakerCoolDownMs:
      Number.isFinite(breakerCoolDownMs) && breakerCoolDownMs >= 1000
        ? breakerCoolDownMs
        : 600_000,
  };
}

export function hostnameFromUrl(url?: string | null): string | null {
  if (!url || typeof url !== 'string') return null;
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/\.$/, '');
    return host || null;
  } catch {
    return null;
  }
}

/** Apply ±jitterRatio uniform jitter around base. */
export function applyJitter(baseMs: number, jitterRatio: number, random = Math.random): number {
  const base = Math.max(0, Math.floor(baseMs));
  if (jitterRatio <= 0) return base;
  const delta = base * jitterRatio;
  const min = Math.max(0, base - delta);
  const max = base + delta;
  const span = max - min;
  return Math.floor(min + random() * span);
}

/**
 * Delay before the next attempt after `attemptsMade` completed failures
 * (0 = first retry → ~30s, 1 → ~2m, 2 → ~10m).
 */
export function computeScrapeRetryDelayMs(
  attemptsMade: number,
  config: ScrapeBackpressureConfig = loadScrapeBackpressureConfig(),
  random = Math.random
): number {
  const idx = Math.max(0, Math.min(config.retryDelaysMs.length - 1, attemptsMade));
  const base = config.retryDelaysMs[idx] ?? DEFAULT_DELAYS[DEFAULT_DELAYS.length - 1];
  return applyJitter(base, config.jitterRatio, random);
}

export class HostCircuitBreaker {
  private failures = 0;
  private windowStart = Date.now();
  private openUntil = 0;

  constructor(
    private readonly threshold: number,
    private readonly windowMs: number,
    private readonly coolDownMs: number
  ) {}

  recordFailure(now = Date.now()): void {
    if (now - this.windowStart > this.windowMs) {
      this.windowStart = now;
      this.failures = 0;
    }
    this.failures += 1;
    if (this.failures >= this.threshold) {
      this.openUntil = now + this.coolDownMs;
      this.failures = 0;
      this.windowStart = now;
    }
  }

  recordSuccess(): void {
    this.failures = Math.max(0, this.failures - 1);
  }

  isOpen(now = Date.now()): boolean {
    return now < this.openUntil;
  }

  remainingMs(now = Date.now()): number {
    return Math.max(0, this.openUntil - now);
  }

  /** Test helper */
  getFailureCount(): number {
    return this.failures;
  }
}

const breakers = new Map<string, HostCircuitBreaker>();

export function resetHostBreakersForTests(): void {
  breakers.clear();
}

export function getHostBreaker(
  hostname: string,
  config: ScrapeBackpressureConfig = loadScrapeBackpressureConfig()
): HostCircuitBreaker {
  const key = hostname.toLowerCase();
  let b = breakers.get(key);
  if (!b) {
    b = new HostCircuitBreaker(
      config.breakerThreshold,
      config.breakerWindowMs,
      config.breakerCoolDownMs
    );
    breakers.set(key, b);
  }
  return b;
}

export function recordHostSuccess(hostname: string | null | undefined): void {
  if (!hostname) return;
  getHostBreaker(hostname).recordSuccess();
}

export function recordHostFailure(hostname: string | null | undefined): void {
  if (!hostname) return;
  getHostBreaker(hostname).recordFailure();
}
