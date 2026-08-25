import { BrowserContext, Frame, Page } from 'playwright-core';
import logger from '../logger';

export const randomBetween = (min: number, max: number): number =>
  Math.floor(Math.random() * (max - min + 1)) + min;

const isPageClosed = (page: Page): boolean => {
  try {
    return typeof page.isClosed === 'function' && page.isClosed();
  } catch {
    return true;
  }
};

export const applyHumanDelay = async (page: Page, minMs: number = 250, maxMs: number = 1250) => {
  if (isPageClosed(page)) return;
  await page.waitForTimeout(randomBetween(minMs, maxMs)).catch(() => undefined);
};

export const simulateHumanMouse = async (page: Page) => {
  const viewport = page.viewportSize() || { width: 1280, height: 720 };
  const points = [
    { x: randomBetween(40, viewport.width / 3), y: randomBetween(40, viewport.height / 3) },
    { x: randomBetween(viewport.width / 3, viewport.width - 40), y: randomBetween(viewport.height / 3, viewport.height - 40) },
    { x: randomBetween(60, viewport.width - 60), y: randomBetween(60, viewport.height - 60) },
  ];

  for (const point of points) {
    await page.mouse.move(point.x, point.y, { steps: randomBetween(8, 20) }).catch(() => undefined);
    await page.waitForTimeout(randomBetween(80, 220)).catch(() => undefined);
  }
};

export const applyStealthOverrides = async (context: BrowserContext, userAgent?: string) => {
  await context.addInitScript(({ configuredUserAgent }) => {
    const defineValue = (target: any, key: string, value: any) => {
      try {
        Object.defineProperty(target, key, {
          configurable: true,
          enumerable: true,
          get: () => value,
        });
      } catch {
        // Ignore non-critical stealth override failures.
      }
    };

    defineValue(Navigator.prototype, 'webdriver', false);
    defineValue(navigator, 'languages', ['en-US', 'en']);
    defineValue(navigator, 'platform', configuredUserAgent?.includes('Macintosh') ? 'MacIntel' : 'Win32');
    defineValue(navigator, 'plugins', [
      { name: 'Chrome PDF Plugin' },
      { name: 'Chrome PDF Viewer' },
      { name: 'Native Client' },
    ]);

    if (configuredUserAgent) {
      defineValue(Navigator.prototype, 'userAgent', configuredUserAgent);
    }

    if (!(window as any).chrome) {
      (window as any).chrome = {
        runtime: {},
        app: {},
      };
    }

    const originalQuery = window.navigator.permissions?.query?.bind(window.navigator.permissions);
    if (originalQuery) {
      window.navigator.permissions.query = (parameters: any) => {
        if (parameters.name === 'notifications') {
          return Promise.resolve({ state: Notification.permission } as any);
        }
        return originalQuery(parameters);
      };
    }
  }, { configuredUserAgent: userAgent });
};

export const detectCaptcha = async (page: Page): Promise<boolean> => {
  try {
    const pageText = await page.innerText('body');
    const lower = (pageText || '').toLowerCase();
    const markers = ['captcha', 'verify you are human', 'recaptcha'];
    const matched = markers.find((m) => lower.includes(m));
    if (matched) {
      logger.log('warn', `detectCaptcha: Found matching marker "${matched}" in visible page text`);
    }
    return !!matched;
  } catch {
    return false;
  }
};

// Do NOT include the bare word "cloudflare" — many healthy pages mention it in
// cookie/CDN footers (e.g. careers.epam.com), which caused permanent false
// positives and burned the full scraper job timeout waiting for nothing.
const CLOUDFLARE_TEXT_MARKERS = [
  'checking your browser',
  'performing security verification',
  'just a moment',
  'attention required',
  'enable javascript and cookies',
  'checking if the site connection is secure',
  'needs to review the security of your connection',
  'verify you are human',
  'cf-browser-verification',
];

const CLOUDFLARE_DOM_SELECTORS = [
  '#challenge-form',
  '#challenge-running',
  '#cf-challenge-running',
  '.cf-browser-verification',
  '#cf-please-wait',
  '.cf-turnstile',
  'iframe[src*="challenges.cloudflare.com"]',
  'iframe[src*="cdn-cgi/challenge-platform"]',
];

const AMAZON_CHALLENGE_MARKERS = [
  'verify you are a human',
  'robot check',
  'please click below',
  'enable javascript',
  'we have detected unusual traffic',
  'sorry, we just need to make sure',
  'access denied',
  'unusual traffic patterns',
  'captcha',
  'blocked',
];

const MICROSOFT_CHALLENGE_MARKERS = [
  'access denied',
  'blocked',
  'unauthorized',
  'microsoft account',
  'sign in to continue',
  'verify you are human',
  'captcha',
  'sorry, your request',
  'request blocked',
  'security verify',
  'unusual activity',
];

async function detectAmazonChallenge(page: Page): Promise<boolean> {
  try {
    const pageText = await page.innerText('body');
    const lower = (pageText || '').toLowerCase();
    const matched = AMAZON_CHALLENGE_MARKERS.find((marker) => lower.includes(marker));
    if (matched) {
      logger.log('warn', `detectAmazonChallenge: Found matching marker "${matched}" in visible page text`);
    }
    return !!matched;
  } catch {
    return false;
  }
}

export { detectAmazonChallenge };

async function detectMicrosoftChallenge(page: Page): Promise<boolean> {
  try {
    const pageText = await page.innerText('body');
    const lower = (pageText || '').toLowerCase();
    const matched = MICROSOFT_CHALLENGE_MARKERS.find((marker) => lower.includes(marker));
    if (matched) {
      logger.log('warn', `detectMicrosoftChallenge: Found matching marker "${matched}" in visible page text`);
    }
    return !!matched;
  } catch {
    return false;
  }
}

export async function detectMicrosoftChallengeAndWait(
  page: Page,
  options: { timeoutMs?: number; pollMs?: number } = {}
): Promise<{ detected: boolean; cleared: boolean }> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const pollMs = options.pollMs ?? 5_000;
  const started = Date.now();

  const isBlocked = await detectMicrosoftChallenge(page);
  if (!isBlocked) {
    return { detected: false, cleared: false };
  }

  while (Date.now() - started < timeoutMs) {
    const stillBlocked = await detectMicrosoftChallenge(page);
    if (!stillBlocked) {
      return { detected: true, cleared: true };
    }
    await page.waitForLoadState('domcontentloaded').catch(() => undefined);
    if (isPageClosed(page)) {
      return { detected: true, cleared: false };
    }
    await page.waitForTimeout(pollMs).catch(() => undefined);
  }

  return { detected: true, cleared: false };
}

export async function detectAmazonChallengeAndWait(
  page: Page,
  options: { timeoutMs?: number; pollMs?: number } = {}
): Promise<{ detected: boolean; cleared: boolean }> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const pollMs = options.pollMs ?? 5_000;
  const started = Date.now();

  const isBlocked = await detectAmazonChallenge(page);
  if (!isBlocked) {
    return { detected: false, cleared: false };
  }

  while (Date.now() - started < timeoutMs) {
    const stillBlocked = await detectAmazonChallenge(page);
    if (!stillBlocked) {
      return { detected: true, cleared: true };
    }
    await page.waitForLoadState('domcontentloaded').catch(() => undefined);
    if (isPageClosed(page)) {
      return { detected: true, cleared: false };
    }
    await page.waitForTimeout(pollMs).catch(() => undefined);
  }

  return { detected: true, cleared: false };
}

const readBodyText = async (page: Page): Promise<string> => {
  try {
    const pageText = await page.innerText('body');
    return (pageText || '').toLowerCase();
  } catch {
    return '';
  }
};

export const detectCloudflareChallenge = async (page: Page): Promise<boolean> => {
  try {
    const domMarker = await page.evaluate((selectors) => {
      for (const sel of selectors) {
        try {
          if (document.querySelector(sel)) return sel;
        } catch {
          /* ignore invalid selectors */
        }
      }
      return null;
    }, CLOUDFLARE_DOM_SELECTORS);
    if (domMarker) {
      logger.log('info', `detectCloudflareChallenge: Found DOM marker "${domMarker}"`);
      return true;
    }
  } catch {
    /* page may be navigating */
  }

  try {
    const title = ((await page.title()) || '').toLowerCase();
    if (title.includes('just a moment') || title.includes('attention required')) {
      logger.log('info', `detectCloudflareChallenge: Found matching title "${title}"`);
      return true;
    }
  } catch {
    /* ignore */
  }

  const lower = await readBodyText(page);
  const matched = CLOUDFLARE_TEXT_MARKERS.find((marker) => lower.includes(marker));
  if (matched) {
    logger.log('info', `detectCloudflareChallenge: Found matching marker "${matched}" in visible page text`);
  }
  return !!matched;
};

export const waitForCloudflareToClear = async (
  page: Page,
  options: { timeoutMs?: number; pollMs?: number } = {}
): Promise<boolean> => {
  const timeoutMs = options.timeoutMs ?? 45_000;
  const pollMs = options.pollMs ?? 2_000;
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    if (isPageClosed(page)) return false;
    const challenged = await detectCloudflareChallenge(page);
    if (!challenged) return true;

    // Give the challenge page room to complete checks and redirect.
    await page.waitForLoadState('domcontentloaded').catch(() => undefined);
    if (isPageClosed(page)) return false;
    await page.waitForTimeout(pollMs).catch(() => undefined);
  }

  return !(await detectCloudflareChallenge(page));
};

/** Maps automation runtime config (same keys as list-extraction path) to wait options. */
export function getUnblockOptionsFromRuntimeConfig(config: Record<string, unknown> | null | undefined) {
  return {
    timeoutMs: typeof config?.cloudflareWaitTimeoutMs === 'number' ? config.cloudflareWaitTimeoutMs : 45_000,
    pollMs: typeof config?.cloudflarePollIntervalMs === 'number' ? config.cloudflarePollIntervalMs : 2_000,
  };
}

/**
 * Wait for Cloudflare interstitial to disappear when present (no mouse / delay).
 * @returns true if no challenge or it cleared; false if still active after timeout.
 */
export async function waitForCloudflareIfPresent(
  page: Page,
  options: { timeoutMs?: number; pollMs?: number } = {}
): Promise<boolean> {
  if (!(await detectCloudflareChallenge(page))) {
    return true;
  }
  logger.log('info', 'Cloudflare challenge detected; waiting for it to clear...');
  const cleared = await waitForCloudflareToClear(page, {
    timeoutMs: options.timeoutMs ?? 45_000,
    pollMs: options.pollMs ?? 2_000,
  });
  if (!cleared) {
    logger.log('warn', 'Cloudflare challenge may still be active after wait timeout');
  }
  return cleared;
}

/**
 * Light human-like signals before automation (used when starting workflow interpretation).
 */
export async function warmUpBeforeAutomation(
  page: Page,
  options: { timeoutMs?: number; pollMs?: number } = {}
): Promise<void> {
  await waitForCloudflareIfPresent(page, options);
  await simulateHumanMouse(page).catch(() => undefined);
  await applyHumanDelay(page, 300, 900);
}

/**
 * After each main-frame navigation, re-check for Cloudflare (SPA-safe debounce; no repeated mouse).
 */
export function attachCloudflareWaitOnNavigation(
  context: BrowserContext,
  options: { timeoutMs?: number; pollMs?: number } = {}
): () => void {
  const disposers: Array<() => void> = [];

  const hookPage = (page: Page) => {
    let debounceTimer: NodeJS.Timeout | null = null;
    const onFrameNav = (frame: Frame) => {
      if (frame !== page.mainFrame()) {
        return;
      }
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        void waitForCloudflareIfPresent(page, options).catch(() => undefined);
      }, 600);
    };
    page.on('framenavigated', onFrameNav);
    disposers.push(() => {
      page.off('framenavigated', onFrameNav);
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
    });
  };

  context.pages().forEach(hookPage);
  const onNewPage = (p: Page) => hookPage(p);
  context.on('page', onNewPage);
  disposers.push(() => context.off('page', onNewPage));

  return () => {
    disposers.forEach((d) => d());
  };
}
