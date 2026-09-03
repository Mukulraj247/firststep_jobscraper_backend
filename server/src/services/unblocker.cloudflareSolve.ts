/**
 * Scrapling-inspired Cloudflare Turnstile solver for Scout-X.
 * Classify challenge → wait (non-interactive) or click checkbox (interactive/embedded) → poll.
 * Does not solve reCAPTCHA or paid WAF tokens.
 */
import type { Frame, Page } from 'playwright-core';
import logger from '../logger';
import { detectCloudflareChallenge, randomBetween } from './unblocker';

export type CloudflareChallengeType = 'none' | 'non-interactive' | 'interactive' | 'embedded';

export type SolveCloudflareOptions = {
  timeoutMs?: number;
  pollMs?: number;
  maxAttempts?: number;
  /** When false, only wait — never click Turnstile. Default true. */
  solveInteractive?: boolean;
};

const TURNSTILE_FRAME_RE = /^https?:\/\/challenges\.cloudflare\.com\/cdn-cgi\/challenge-platform\//i;

const TURNSTILE_OUTER_SELECTORS = [
  '#cf_turnstile',
  '#cf-turnstile',
  '.cf-turnstile',
  '.turnstile',
  'iframe[src*="challenges.cloudflare.com"]',
  'iframe[src*="cdn-cgi/challenge-platform"]',
];

const isPageClosed = (page: Page): boolean => {
  try {
    return typeof page.isClosed === 'function' && page.isClosed();
  } catch {
    return true;
  }
};

function envCloudflareWaitTimeoutMs(fallback: number): number {
  const raw = parseInt(String(process.env.CLOUDFLARE_WAIT_TIMEOUT_MS || ''), 10);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

/**
 * Classify Cloudflare challenge so we only click when a Turnstile widget is present.
 */
export async function detectCloudflareChallengeType(page: Page): Promise<CloudflareChallengeType> {
  if (isPageClosed(page)) return 'none';

  try {
    const frames = page.frames();
    for (const frame of frames) {
      const url = frame.url() || '';
      if (TURNSTILE_FRAME_RE.test(url)) {
        return 'interactive';
      }
    }
  } catch {
    /* ignore */
  }

  try {
    const kind = await page.evaluate((selectors) => {
      const html = document.documentElement?.innerHTML || '';
      if (/challenges\.cloudflare\.com\/turnstile\/v/i.test(html)) {
        return 'embedded' as const;
      }
      for (const sel of selectors) {
        try {
          if (document.querySelector(sel)) return 'interactive' as const;
        } catch {
          /* ignore */
        }
      }
      // Scrapling-style cType hint when present in challenge HTML.
      const cType = html.match(/cType:\s*['"]([^'"]+)['"]/i);
      if (cType?.[1]) {
        const t = cType[1].toLowerCase();
        if (t.includes('managed') || t.includes('interactive') || t.includes('turnstile')) {
          return 'interactive' as const;
        }
        return 'non-interactive' as const;
      }
      return null;
    }, TURNSTILE_OUTER_SELECTORS);
    if (kind === 'interactive' || kind === 'embedded') return kind;
  } catch {
    /* page may be navigating */
  }

  if (await detectCloudflareChallenge(page)) {
    return 'non-interactive';
  }
  return 'none';
}

async function findTurnstileFrame(page: Page): Promise<Frame | null> {
  try {
    for (const frame of page.frames()) {
      const url = frame.url() || '';
      if (TURNSTILE_FRAME_RE.test(url)) return frame;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Click near the Turnstile checkbox (Scrapling offset ~26–28, ~25–27 + 100–200ms delay).
 * Returns true if a click was attempted.
 */
export async function tryClickCloudflareTurnstile(page: Page): Promise<boolean> {
  if (isPageClosed(page)) return false;

  try {
    // Prefer iframe element bounding box on the main page (Scrapling approach).
    const iframeLocator = page.locator('iframe[src*="challenges.cloudflare.com"]').first();
    const count = await iframeLocator.count().catch(() => 0);
    if (count > 0) {
      await iframeLocator.waitFor({ state: 'visible', timeout: 8_000 }).catch(() => undefined);
      const box = await iframeLocator.boundingBox().catch(() => null);
      if (box && box.width > 0 && box.height > 0) {
        const x = box.x + randomBetween(26, 28);
        const y = box.y + randomBetween(25, 27);
        logger.log('info', `Cloudflare Turnstile click at (${Math.round(x)},${Math.round(y)})`);
        await page.waitForTimeout(randomBetween(100, 200)).catch(() => undefined);
        await page.mouse.click(x, y).catch(() => undefined);
        await page.waitForLoadState('domcontentloaded').catch(() => undefined);
        return true;
      }
    }

    // Fallback: click inside the challenge frame body.
    const frame = await findTurnstileFrame(page);
    if (frame) {
      const body = frame.locator('body').first();
      const box = await body.boundingBox().catch(() => null);
      if (box && box.width > 0 && box.height > 0) {
        const x = box.x + randomBetween(26, 28);
        const y = box.y + randomBetween(25, 27);
        logger.log('info', `Cloudflare Turnstile frame click at (${Math.round(x)},${Math.round(y)})`);
        await page.waitForTimeout(randomBetween(100, 200)).catch(() => undefined);
        await page.mouse.click(x, y).catch(() => undefined);
        await page.waitForLoadState('domcontentloaded').catch(() => undefined);
        return true;
      }
      await frame.locator('input[type="checkbox"], .ctp-checkbox-label, label').first().click({
        timeout: 3_000,
        force: true,
      }).catch(() => undefined);
      return true;
    }

    // Embedded widget without iframe URL yet — click outer container.
    for (const sel of ['#cf_turnstile', '#cf-turnstile', '.cf-turnstile']) {
      const el = page.locator(sel).first();
      if ((await el.count().catch(() => 0)) === 0) continue;
      const box = await el.boundingBox().catch(() => null);
      if (box && box.width > 0 && box.height > 0) {
        const x = box.x + randomBetween(26, 28);
        const y = box.y + randomBetween(25, 27);
        logger.log('info', `Cloudflare Turnstile outer click (${sel}) at (${Math.round(x)},${Math.round(y)})`);
        await page.waitForTimeout(randomBetween(100, 200)).catch(() => undefined);
        await page.mouse.click(x, y).catch(() => undefined);
        return true;
      }
    }
  } catch (err: any) {
    logger.log('warn', `tryClickCloudflareTurnstile failed: ${err?.message || err}`);
  }
  return false;
}

/**
 * Poll until Cloudflare markers disappear (passive wait — no click).
 */
export async function waitForCloudflareMarkersGone(
  page: Page,
  options: { timeoutMs?: number; pollMs?: number } = {}
): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? envCloudflareWaitTimeoutMs(45_000);
  const pollMs = options.pollMs ?? 2_000;
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    if (isPageClosed(page)) return false;
    if (!(await detectCloudflareChallenge(page))) return true;
    await page.waitForLoadState('domcontentloaded').catch(() => undefined);
    if (isPageClosed(page)) return false;
    await page.waitForTimeout(pollMs).catch(() => undefined);
  }
  return !(await detectCloudflareChallenge(page));
}

/**
 * Scrapling-style solve: classify → wait or click → poll → retry ≤ maxAttempts.
 */
export async function solveCloudflareChallenge(
  page: Page,
  options: SolveCloudflareOptions = {}
): Promise<boolean> {
  const solveInteractive = options.solveInteractive !== false;
  const maxAttempts = Math.max(1, Math.min(options.maxAttempts ?? 3, 5));
  const timeoutMs = options.timeoutMs ?? envCloudflareWaitTimeoutMs(60_000);
  const pollMs = options.pollMs ?? 2_000;
  const started = Date.now();
  const deadline = () => Math.max(1_000, timeoutMs - (Date.now() - started));

  if (isPageClosed(page)) return false;

  let type = await detectCloudflareChallengeType(page);
  if (type === 'none') {
    if (!(await detectCloudflareChallenge(page))) return true;
    type = 'non-interactive';
  }

  logger.log('info', `Cloudflare challenge detected; type=${type}`);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (isPageClosed(page)) return false;
    if (!(await detectCloudflareChallenge(page))) {
      logger.log('info', 'Cloudflare challenge cleared');
      return true;
    }

    const remaining = deadline();
    if (remaining < 1_500) break;

    type = await detectCloudflareChallengeType(page);
    const needsClick =
      solveInteractive && (type === 'interactive' || type === 'embedded');

    if (needsClick) {
      logger.log('info', `Cloudflare Turnstile click attempt ${attempt}/${maxAttempts}`);
      await tryClickCloudflareTurnstile(page);
      await page.waitForTimeout(randomBetween(800, 1_600)).catch(() => undefined);
    }

    const slice = Math.min(remaining, needsClick ? 20_000 : remaining);
    const cleared = await waitForCloudflareMarkersGone(page, {
      timeoutMs: slice,
      pollMs,
    });
    if (cleared) {
      logger.log('info', 'Cloudflare challenge cleared');
      return true;
    }
  }

  logger.log(
    'warn',
    `Cloudflare challenge still present after ${maxAttempts} attempts`
  );
  return !(await detectCloudflareChallenge(page));
}
