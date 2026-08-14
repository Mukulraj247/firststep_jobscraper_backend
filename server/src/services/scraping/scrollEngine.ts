/**
 * scrollEngine - Server-side (Playwright) port of the Chrome extension's
 * in-page scroll/pagination helpers in
 * `chrome-extension/src/content/extractionRunner.ts`.
 *
 * Used by both cloud scraping engines:
 *   - Engine 1: `maxun-core/src/interpret.ts` `handlePagination`
 *   - Engine 2: `server/src/services/listExtractor.ts` `runListExtraction`
 *
 * The goal is that the cloud scraper scrolls, waits for spinners, and detects
 * page changes with the same heuristics the user saw locally in the extension,
 * so a robot configured in the sidepanel reproduces the same behaviour when it
 * runs on a schedule in the cloud.
 *
 * All functions take a Playwright `Page` and run the actual DOM work via
 * `page.evaluate` so they can be injected into any context (workflow path,
 * list-extraction path, smart-extractor fallback) without coupling.
 */

import type { Page } from 'playwright-core';

/** Opaque handle identifying the list's actual scroll container in the page. */
export type ScrollRoot = 'window' | 'element';

export interface FindScrollRootResult {
  root: ScrollRoot;
  tag?: string;
  className?: string;
}

/**
 * Ask the page to locate the nearest overflow-scrollable ancestor of
 * `listSelector`. Returns `{ root: 'window' }` if the page itself scrolls.
 *
 * The result is advisory — all `stepScroll`/`waitForMoreItems` calls scroll
 * either window or the element derived from the same selector, so we don't
 * need to serialize a handle across `evaluate` boundaries.
 */
export async function findScrollRoot(
  page: Page,
  listSelector?: string
): Promise<FindScrollRootResult> {
  if (!listSelector) return { root: 'window' };
  try {
    return await page.evaluate((sel) => {
      const canScrollEl = (el: Element): boolean => {
        const style = getComputedStyle(el as HTMLElement);
        const overflowing =
          style.overflowY === 'auto' ||
          style.overflowY === 'scroll' ||
          style.overflow === 'auto' ||
          style.overflow === 'scroll';
        return overflowing && (el as HTMLElement).scrollHeight > (el as HTMLElement).clientHeight + 4;
      };

      let anchor: Element | null = null;
      try {
        anchor = document.querySelector(sel);
      } catch {
        anchor = null;
      }
      if (!anchor) return { root: 'window' as const };

      let cur: HTMLElement | null = anchor as HTMLElement;
      while (cur && cur !== document.body && cur !== document.documentElement) {
        if (canScrollEl(cur)) {
          return {
            root: 'element' as const,
            tag: cur.tagName,
            className: (cur.className || '').toString().slice(0, 80),
          };
        }
        cur = cur.parentElement;
      }
      return { root: 'window' as const };
    }, listSelector);
  } catch {
    return { root: 'window' };
  }
}

/**
 * Scroll one step. If `listSelector` resolves to an inner scroll container,
 * we scroll that container; otherwise we scroll the window.
 *
 * `mode = 'toEnd'` jumps straight to the bottom/top (matches the extension's
 * default when auto-scrolling infinite lists). `mode = 'viewport'` is a
 * ~85% viewport step (use between clicks / page-number navigations).
 *
 * Returns `true` if the scroll position actually moved.
 */
export async function stepScroll(
  page: Page,
  listSelector: string | undefined,
  direction: 'down' | 'up' = 'down',
  mode: 'viewport' | 'toEnd' = 'toEnd'
): Promise<boolean> {
  try {
    return await page.evaluate(
      ({ sel, dir, m }) => {
        const findRoot = (el: Element | null): HTMLElement => {
          const pageRoot = (document.scrollingElement || document.documentElement) as HTMLElement;
          if (!el) return pageRoot;
          let cur: HTMLElement | null = el as HTMLElement;
          while (cur && cur !== document.body && cur !== document.documentElement) {
            const style = getComputedStyle(cur);
            const canScroll =
              (style.overflowY === 'auto' ||
                style.overflowY === 'scroll' ||
                style.overflow === 'auto' ||
                style.overflow === 'scroll') &&
              cur.scrollHeight > cur.clientHeight + 4;
            if (canScroll) return cur;
            cur = cur.parentElement;
          }
          return pageRoot;
        };

        let anchor: Element | null = null;
        if (sel) {
          try {
            anchor = document.querySelector(sel);
          } catch {
            anchor = null;
          }
        }
        const target = findRoot(anchor);
        const isPageRoot =
          target === document.scrollingElement ||
          target === document.documentElement ||
          target === document.body;

        if (isPageRoot) {
          const before = window.scrollY;
          const viewport = window.innerHeight;
          const maxY = Math.max(0, document.documentElement.scrollHeight - viewport);
          const nextY =
            m === 'toEnd'
              ? dir === 'down'
                ? maxY
                : 0
              : dir === 'down'
              ? Math.min(before + Math.max(200, viewport * 0.85), maxY)
              : Math.max(before - Math.max(200, viewport * 0.85), 0);
          window.scrollTo({ top: nextY, left: 0, behavior: 'instant' as ScrollBehavior });
          return Math.abs(window.scrollY - before) > 1;
        }

        const before = target.scrollTop;
        const viewport = target.clientHeight;
        const maxY = Math.max(0, target.scrollHeight - viewport);
        const nextY =
          m === 'toEnd'
            ? dir === 'down'
              ? maxY
              : 0
            : dir === 'down'
            ? Math.min(before + Math.max(200, viewport * 0.85), maxY)
            : Math.max(before - Math.max(200, viewport * 0.85), 0);
        target.scrollTop = nextY;
        return Math.abs(target.scrollTop - before) > 1;
      },
      { sel: listSelector, dir: direction, m: mode }
    );
  } catch {
    return false;
  }
}

export interface WaitForMoreItemsResult {
  changed: boolean;
  newCount: number;
  reason: 'items' | 'height' | 'timeout';
}

/**
 * Poll the page for either:
 *   - the list-item count to grow past `beforeCount`, OR
 *   - the scroll container's `scrollHeight` to grow by >50px
 * within `timeoutMs`. Mirrors `waitForMoreItems` in the extension.
 */
export async function waitForMoreItems(
  page: Page,
  listSelector: string | undefined,
  beforeCount: number,
  beforeScrollHeight: number,
  timeoutMs = 6000
): Promise<WaitForMoreItemsResult> {
  try {
    return await page.evaluate(
      async ({ sel, before, beforeSH, deadlineMs }) => {
        const findRoot = (el: Element | null): HTMLElement => {
          const pageRoot = (document.scrollingElement || document.documentElement) as HTMLElement;
          if (!el) return pageRoot;
          let cur: HTMLElement | null = el as HTMLElement;
          while (cur && cur !== document.body && cur !== document.documentElement) {
            const style = getComputedStyle(cur);
            const canScroll =
              (style.overflowY === 'auto' ||
                style.overflowY === 'scroll' ||
                style.overflow === 'auto' ||
                style.overflow === 'scroll') &&
              cur.scrollHeight > cur.clientHeight + 4;
            if (canScroll) return cur;
            cur = cur.parentElement;
          }
          return pageRoot;
        };

        const countItems = (): number => {
          if (!sel) return 0;
          try {
            return document.querySelectorAll(sel).length;
          } catch {
            return 0;
          }
        };

        let anchor: Element | null = null;
        if (sel) {
          try {
            anchor = document.querySelector(sel);
          } catch {
            anchor = null;
          }
        }
        const target = findRoot(anchor);

        const deadline = Date.now() + deadlineMs;
        return await new Promise<{ changed: boolean; newCount: number; reason: 'items' | 'height' | 'timeout' }>(
          (resolve) => {
            const check = () => {
              const count = countItems();
              if (count > before) {
                resolve({ changed: true, newCount: count, reason: 'items' });
                return;
              }
              const sh =
                target === document.scrollingElement || target === document.documentElement
                  ? document.documentElement.scrollHeight
                  : (target as HTMLElement).scrollHeight;
              if (sh > beforeSH + 50) {
                resolve({ changed: true, newCount: count, reason: 'height' });
                return;
              }
              if (Date.now() > deadline) {
                resolve({ changed: false, newCount: count, reason: 'timeout' });
                return;
              }
              setTimeout(check, 150);
            };
            check();
          }
        );
      },
      { sel: listSelector, before: beforeCount, beforeSH: beforeScrollHeight, deadlineMs: timeoutMs }
    );
  } catch {
    return { changed: false, newCount: beforeCount, reason: 'timeout' };
  }
}

/**
 * Wait up to `timeoutMs` for any spinner/loading-indicator near `listSelector`
 * to disappear. Mirrors the extension's `waitForLoadingToFinish` — cheap if
 * no spinner ever appears (up to `appearWindowMs` ~400ms probe), then full
 * budget only when a loader is actually present.
 */
export async function waitForLoadingToFinish(
  page: Page,
  listSelector: string | undefined,
  timeoutMs = 6000,
  appearWindowMs = 400
): Promise<boolean> {
  try {
    return await page.evaluate(
      async ({ sel, total, appear }) => {
        const findRoot = (el: Element | null): HTMLElement | null => {
          if (!el) return null;
          let cur: HTMLElement | null = el as HTMLElement;
          while (cur && cur !== document.body && cur !== document.documentElement) {
            const style = getComputedStyle(cur);
            const canScroll =
              (style.overflowY === 'auto' ||
                style.overflowY === 'scroll' ||
                style.overflow === 'auto' ||
                style.overflow === 'scroll') &&
              cur.scrollHeight > cur.clientHeight + 4;
            if (canScroll) return cur;
            cur = cur.parentElement;
          }
          return null;
        };

        let anchor: Element | null = null;
        if (sel) {
          try {
            anchor = document.querySelector(sel);
          } catch {
            anchor = null;
          }
        }
        const scrollRoot = findRoot(anchor);

        const classMatch = /\b(spinner|loader|loading|progress(bar)?|skeleton)\b/i;

        const isVisible = (el: Element): boolean => {
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) return false;
          const style = getComputedStyle(el as HTMLElement);
          if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') return false;
          return true;
        };

        const detect = (): Element | null => {
          const roots: Element[] = [];
          if (scrollRoot) {
            roots.push(scrollRoot);
            if (scrollRoot.parentElement) roots.push(scrollRoot.parentElement);
          }
          roots.push(document.body);

          const seen = new Set<Element>();
          for (const root of roots) {
            let candidates: Element[];
            try {
              candidates = [
                ...Array.from(root.querySelectorAll('[aria-busy="true"]')),
                ...Array.from(root.querySelectorAll('[role="progressbar"], [role="status"]')),
              ];
            } catch {
              candidates = [];
            }
            try {
              const all = Array.from(root.querySelectorAll<HTMLElement>('*'));
              for (const el of all) {
                if (typeof el.className === 'string' && classMatch.test(el.className)) {
                  candidates.push(el);
                }
              }
            } catch {
              /* ignore */
            }
            for (const el of candidates) {
              if (seen.has(el)) continue;
              seen.add(el);
              if (isVisible(el)) return el;
            }
          }
          return null;
        };

        const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

        let sawSpinner = !!detect();
        if (!sawSpinner) {
          const appearDeadline = Date.now() + Math.min(appear, total);
          while (Date.now() < appearDeadline) {
            if (detect()) {
              sawSpinner = true;
              break;
            }
            await sleep(60);
          }
        }
        if (!sawSpinner) return false;

        const fullDeadline = Date.now() + total;
        while (Date.now() < fullDeadline) {
          if (!detect()) return true;
          await sleep(120);
        }
        return false;
      },
      { sel: listSelector, total: timeoutMs, appear: appearWindowMs }
    );
  } catch {
    return false;
  }
}

export interface PageChangeSnapshot {
  url: string;
  firstItemText: string;
  htmlLen: number;
  itemCount: number;
}

/**
 * Capture enough DOM state to later decide whether a click/navigation actually
 * changed the page. Mirrors the extension's `captureSnapshot` + URL tracking.
 */
export async function snapshotListArea(
  page: Page,
  listSelector: string | undefined
): Promise<PageChangeSnapshot> {
  try {
    return await page.evaluate((sel) => {
      let area: Element = document.body;
      if (sel) {
        try {
          const anchor = document.querySelector(sel);
          if (anchor) area = anchor.parentElement || anchor;
        } catch {
          /* ignore */
        }
      }
      const first = area.querySelector(':scope > *');
      const html = (area as HTMLElement).innerHTML || '';
      let itemCount = 0;
      if (sel) {
        try {
          itemCount = document.querySelectorAll(sel).length;
        } catch {
          itemCount = 0;
        }
      }
      return {
        url: window.location.href,
        firstItemText: first ? (first.textContent || '').trim().slice(0, 100) : '',
        htmlLen: html.length,
        itemCount,
      };
    }, listSelector);
  } catch {
    return { url: '', firstItemText: '', htmlLen: 0, itemCount: 0 };
  }
}

/**
 * Poll for any of the page-change signals the extension uses:
 *   - URL changed, OR
 *   - first-item text changed, OR
 *   - innerHTML length changed by >30%, OR
 *   - item count changed
 * Returns `true` as soon as any signal fires; returns `false` on timeout.
 */
export async function waitForPageChange(
  page: Page,
  listSelector: string | undefined,
  before: PageChangeSnapshot,
  timeoutMs = 12_000
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  // Small initial delay so SPA click handlers have a chance to mutate DOM.
  await page.waitForTimeout(100).catch(() => undefined);
  while (Date.now() < deadline) {
    const now = await snapshotListArea(page, listSelector);
    if (now.url && now.url !== before.url) {
      return true;
    }
    if (before.itemCount > 0 && now.itemCount !== before.itemCount) {
      return true;
    }
    if (now.firstItemText && now.firstItemText !== before.firstItemText) {
      return true;
    }
    if (before.htmlLen > 0) {
      const delta = now.htmlLen - before.htmlLen;
      const ratio = now.htmlLen / Math.max(before.htmlLen, 1);
      // Append-style "Show More" often grows HTML by a few KB without a 30% jump.
      if (ratio < 0.85 || ratio > 1.08 || delta > 800) {
        return true;
      }
    }
    await page.waitForTimeout(300).catch(() => undefined);
  }
  return false;
}

/**
 * Read the current list-item count from the page.
 */
export async function countListItems(page: Page, listSelector?: string): Promise<number> {
  if (!listSelector) return 0;
  try {
    return await page.evaluate((sel) => {
      try {
        return document.querySelectorAll(sel).length;
      } catch {
        return 0;
      }
    }, listSelector);
  } catch {
    return 0;
  }
}

/**
 * Read the current scrollHeight of the list's scroll container (or the page).
 */
export async function getScrollHeight(page: Page, listSelector?: string): Promise<number> {
  try {
    return await page.evaluate((sel) => {
      const findRoot = (el: Element | null): HTMLElement => {
        const pageRoot = (document.scrollingElement || document.documentElement) as HTMLElement;
        if (!el) return pageRoot;
        let cur: HTMLElement | null = el as HTMLElement;
        while (cur && cur !== document.body && cur !== document.documentElement) {
          const style = getComputedStyle(cur);
          const canScroll =
            (style.overflowY === 'auto' ||
              style.overflowY === 'scroll' ||
              style.overflow === 'auto' ||
              style.overflow === 'scroll') &&
            cur.scrollHeight > cur.clientHeight + 4;
          if (canScroll) return cur;
          cur = cur.parentElement;
        }
        return pageRoot;
      };

      let anchor: Element | null = null;
      if (sel) {
        try {
          anchor = document.querySelector(sel);
        } catch {
          anchor = null;
        }
      }
      const target = findRoot(anchor);
      return target === document.scrollingElement || target === document.documentElement
        ? document.documentElement.scrollHeight
        : (target as HTMLElement).scrollHeight;
    }, listSelector);
  } catch {
    return 0;
  }
}

/**
 * Fingerprint a row for dedup. Identical to the extension's `fingerprintRow`
 * (see `chrome-extension/src/content/extractionRunner.ts`), so rows extracted
 * in the sidepanel and rows extracted by the cloud worker collapse to the
 * same identity and are deduped consistently.
 *
 * - Values are coerced to string.
 * - Whitespace is collapsed and trimmed.
 * - Case is lowered.
 * - Field order is preserved (Object.values keeps insertion order).
 */
export function fingerprintRow(row: Record<string, any>): string {
  return JSON.stringify(
    Object.values(row || {}).map((v) => {
      if (v === null || v === undefined) return '';
      const s = typeof v === 'string' ? v : String(v);
      return s.replace(/\s+/g, ' ').trim().toLowerCase();
    })
  );
}

export interface ScrollUntilDoneOptions {
  listSelector?: string;
  direction?: 'down' | 'up';
  maxSteps?: number;
  pageDelayMs?: number;
  spinnerBudgetMs?: number;
  /** Stops the loop when the caller decides (e.g. maxItems reached). */
  shouldStop?: () => boolean;
  /** Strikes of "no new items" before declaring end-of-content. */
  emptyLimit?: number;
  /** Optional per-iteration side-effect, e.g. to re-extract rows. */
  onStep?: (info: { step: number; itemCount: number; scrollHeight: number }) => Promise<void> | void;
}

/**
 * Keep stepping `stepScroll` → `waitForLoadingToFinish` → `waitForMoreItems`
 * until we either hit `maxSteps`, `shouldStop()` returns `true`, or we see
 * `emptyLimit` consecutive iterations with no growth.
 *
 * Mirrors the core loop of `autoScrollAndExtract` in the extension, minus the
 * row-extraction + progress streaming which live with each engine.
 */
export async function scrollUntilDone(page: Page, opts: ScrollUntilDoneOptions = {}): Promise<{
  steps: number;
  reason: 'max-steps' | 'stopped' | 'end-reached';
}> {
  const {
    listSelector,
    direction = 'down',
    maxSteps = 30,
    pageDelayMs = 1200,
    spinnerBudgetMs,
    shouldStop = () => false,
    emptyLimit = 3,
    onStep,
  } = opts;

  const budget = typeof spinnerBudgetMs === 'number' ? spinnerBudgetMs : Math.max(pageDelayMs * 3, 8000);
  let consecutiveEmpty = 0;
  let step = 0;

  while (step < maxSteps) {
    if (shouldStop()) {
      return { steps: step, reason: 'stopped' };
    }

    step++;
    const beforeCount = await countListItems(page, listSelector);
    const beforeHeight = await getScrollHeight(page, listSelector);

    await stepScroll(page, listSelector, direction, 'toEnd');
    await waitForLoadingToFinish(page, listSelector, budget, 300);
    const growth = await waitForMoreItems(
      page,
      listSelector,
      beforeCount,
      beforeHeight,
      Math.max(800, pageDelayMs)
    );

    if (onStep) {
      try {
        await onStep({
          step,
          itemCount: growth.newCount,
          scrollHeight: await getScrollHeight(page, listSelector),
        });
      } catch {
        /* onStep must never break the loop */
      }
    }

    if (growth.changed) {
      consecutiveEmpty = 0;
    } else {
      consecutiveEmpty++;
      if (consecutiveEmpty >= emptyLimit) {
        return { steps: step, reason: 'end-reached' };
      }
    }

    // Tiny breather on empty steps so we don't busy-loop.
    if (!growth.changed) {
      await page.waitForTimeout(250).catch(() => undefined);
    }
  }

  return { steps: step, reason: 'max-steps' };
}
