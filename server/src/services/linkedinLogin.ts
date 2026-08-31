import type { Page } from 'playwright-core';
import { getLinkedInAccountSessionPath } from '../storage/sessionState';
import { isLinkedInHost } from './linkedinSessionGate';

export class LinkedInLoginError extends Error {
  constructor(
    message: string,
    public readonly kind: 'challenge' | 'credentials' | 'timeout' | 'unknown' = 'unknown'
  ) {
    super(message);
    this.name = 'LinkedInLoginError';
  }
}

const LOGIN_URL = 'https://www.linkedin.com/login';
const CHALLENGE_MARKERS = [
  'checkpoint',
  'captcha',
  'challenge',
  'verify your identity',
  'security verification',
  'unusual activity',
  'let\'s do a quick',
];

const LOGIN_WALL_MARKERS = [
  'sign in',
  'join linkedin',
  'sign up',
  'authwall',
];

function pageText(page: Page): Promise<string> {
  return page.evaluate(() => document.body?.innerText || '').catch(() => '');
}

export async function hasLinkedInSessionCookie(page: Page): Promise<boolean> {
  const cookies = await page.context().cookies('https://www.linkedin.com');
  return cookies.some((c) => c.name === 'li_at' && !!c.value);
}

export async function isLinkedInLoginWall(page: Page, url?: string): Promise<boolean> {
  const currentUrl = (url || page.url() || '').toLowerCase();
  if (currentUrl.includes('/login') || currentUrl.includes('/authwall')) return true;
  const text = (await pageText(page)).toLowerCase();
  return LOGIN_WALL_MARKERS.some((m) => text.includes(m));
}

export async function isLinkedInChallenge(page: Page): Promise<boolean> {
  const url = (page.url() || '').toLowerCase();
  if (url.includes('checkpoint') || url.includes('challenge')) return true;
  const text = (await pageText(page)).toLowerCase();
  return CHALLENGE_MARKERS.some((m) => text.includes(m));
}

export async function loginLinkedInWithCredentials(
  page: Page,
  email: string,
  password: string,
  opts?: { timeoutMs?: number }
): Promise<void> {
  const timeoutMs = opts?.timeoutMs ?? 60_000;
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: timeoutMs });

  const username = page.locator('#username, input[name="session_key"]').first();
  const passwordInput = page.locator('#password, input[name="session_password"]').first();
  await username.waitFor({ state: 'visible', timeout: 15_000 });
  await username.fill(email);
  await passwordInput.fill(password);

  const submit = page.locator('button[type="submit"], button[data-litms-control-urn="login-submit"]').first();
  await submit.click();

  await page.waitForLoadState('domcontentloaded', { timeout: timeoutMs }).catch(() => {});

  if (await isLinkedInChallenge(page)) {
    throw new LinkedInLoginError('LinkedIn security challenge detected during login', 'challenge');
  }

  const hasCookie = await hasLinkedInSessionCookie(page);
  const onLoginWall = await isLinkedInLoginWall(page);
  if (!hasCookie || onLoginWall) {
    const text = (await pageText(page)).toLowerCase();
    if (text.includes('wrong') || text.includes('incorrect') || text.includes('invalid')) {
      throw new LinkedInLoginError('LinkedIn rejected email or password', 'credentials');
    }
    throw new LinkedInLoginError('LinkedIn login did not establish a session', 'unknown');
  }
}

export async function persistLinkedInAccountSession(page: Page, accountId: string): Promise<void> {
  const sessionPath = await getLinkedInAccountSessionPath(accountId);
  await page.context().storageState({ path: sessionPath });
}

export async function ensureLinkedInLoggedIn(
  page: Page,
  accountId: string,
  email: string,
  password: string
): Promise<void> {
  const host = (() => {
    try {
      return new URL(page.url() || LOGIN_URL).hostname;
    } catch {
      return 'linkedin.com';
    }
  })();

  if (!isLinkedInHost(host) && !page.url()) {
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  }

  if (await hasLinkedInSessionCookie(page)) {
    const onWall = await isLinkedInLoginWall(page);
    if (!onWall) return;
  }

  await loginLinkedInWithCredentials(page, email, password);
  await persistLinkedInAccountSession(page, accountId);
}
