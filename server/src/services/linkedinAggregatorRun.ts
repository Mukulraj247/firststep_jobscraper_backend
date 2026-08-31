import type { Page } from 'playwright-core';
import {
  acquireLinkedInAccount,
  hasEligibleLinkedInAccounts,
  releaseLinkedInAccount,
  type LinkedInAccountLease,
} from './linkedinAccountPool';
import {
  ensureLinkedInLoggedIn,
  isLinkedInChallenge,
  isLinkedInLoginWall,
  LinkedInLoginError,
  persistLinkedInAccountSession,
} from './linkedinLogin';
import {
  getLinkedInAccountSessionPath,
  linkedInAccountSessionExists,
} from '../storage/sessionState';

export type LinkedInAggregatorRunHandle = {
  lease: LinkedInAccountLease;
  sessionPath: string;
  rotatedOnce: boolean;
};

export async function beginLinkedInAggregatorRun(
  runId: string
): Promise<LinkedInAggregatorRunHandle> {
  const lease = await acquireLinkedInAccount(runId);
  const sessionPath = await getLinkedInAccountSessionPath(lease.accountId);
  return { lease, sessionPath, rotatedOnce: false };
}

export async function getLinkedInAggregatorStorageStatePath(
  handle: LinkedInAggregatorRunHandle
): Promise<string | undefined> {
  const exists = await linkedInAccountSessionExists(handle.lease.accountId);
  return exists ? handle.sessionPath : undefined;
}

export async function ensureLinkedInAggregatorSessionOnPage(
  page: Page,
  handle: LinkedInAggregatorRunHandle,
  listStartUrl: string
): Promise<void> {
  await page.goto(listStartUrl, { waitUntil: 'domcontentloaded', timeout: 90_000 }).catch(() => {});

  if (await isLinkedInChallenge(page)) {
    throw new LinkedInLoginError('LinkedIn security challenge on jobs page', 'challenge');
  }

  const onWall = await isLinkedInLoginWall(page);
  if (!onWall) {
    await persistLinkedInAccountSession(page, handle.lease.accountId);
    return;
  }

  await ensureLinkedInLoggedIn(
    page,
    handle.lease.accountId,
    handle.lease.email,
    handle.lease.password
  );
  await page.goto(listStartUrl, { waitUntil: 'domcontentloaded', timeout: 90_000 });
}

export async function finishLinkedInAggregatorRun(
  handle: LinkedInAggregatorRunHandle,
  outcome: 'ok' | 'blocked' | 'released',
  errorMessage?: string
): Promise<void> {
  await releaseLinkedInAccount(handle.lease.accountId, handle.lease.runId, outcome, errorMessage);
}

export async function tryRotateLinkedInAggregatorAccount(
  runId: string,
  handle: LinkedInAggregatorRunHandle,
  errorMessage?: string
): Promise<LinkedInAggregatorRunHandle | null> {
  if (handle.rotatedOnce) return null;
  await releaseLinkedInAccount(handle.lease.accountId, handle.lease.runId, 'blocked', errorMessage);
  const eligible = await hasEligibleLinkedInAccounts(handle.lease.accountId);
  if (!eligible) return null;
  const next = await beginLinkedInAggregatorRun(runId);
  return { ...next, rotatedOnce: true };
}

export function isLinkedInBlockError(error: unknown): boolean {
  if (error instanceof LinkedInLoginError) {
    return error.kind === 'challenge' || error.kind === 'unknown';
  }
  const msg = error instanceof Error ? error.message : String(error);
  return /challenge|captcha|authwall|sign in|login wall|checkpoint/i.test(msg);
}
