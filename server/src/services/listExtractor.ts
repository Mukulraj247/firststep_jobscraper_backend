import { Locator, Page } from 'playwright-core';
import logger from '../logger';
import * as fs from 'fs';
import * as path from 'path';
import { waitForCloudflareIfPresent } from './unblocker';
import {
  stepScroll,
  waitForLoadingToFinish,
  waitForMoreItems,
  waitForPageChange,
  snapshotListArea,
  countListItems,
  getScrollHeight,
  fingerprintRow,
} from './scraping/scrollEngine';
import {
  dismissNow as dismissOverlays,
  installDialogHandler,
  OverlayDismisserOptions,
} from './scraping/overlayDismisser';
import {
  assertNoCaptcha,
  CaptchaEncounteredError,
  CaptchaGateOptions,
} from './scraping/captchaGate';

const SMART_EXTRACTOR_SCRIPT_PATH = path.join(__dirname, '../workflow-management/scripts/smartJobExtractor.js');

export interface ListExtractionFieldMap {
  [fieldName: string]: string;
}

export interface ListExtractionPaginationConfig {
  mode?: 'none' | 'next-button' | 'infinite-scroll' | 'page-number-loop';
  nextButtonSelector?: string;
  maxPages?: number;
  startPage?: number;
  pageParam?: string;
  pageDelayMs?: number;
  /** Caps the inner scroll/paginate loop. Mirrors the extension's `maxSteps`. */
  maxScrollSteps?: number;
  /** Budget for `waitForLoadingToFinish` between scroll steps. */
  scrollSpinnerBudgetMs?: number;
  /** How long to wait for a click-next/load-more to actually re-render. */
  loadMoreWaitMs?: number;
}

export interface ListExtractionConfig {
  itemSelector: string;
  fields: ListExtractionFieldMap;
  uniqueKey?: string;
  maxItems?: number;
  pagination?: ListExtractionPaginationConfig;
  autoScroll?: boolean;
  scrollDelayMs?: number;
  maxScrollIterations?: number;
  /** Overlay / dialog handling knobs (parity with extension runtime). */
  popups?: OverlayDismisserOptions;
  /** CAPTCHA pause-on-detect (no third-party solver). */
  captcha?: CaptchaGateOptions;
}

const DEFAULT_SCROLL_DELAY_MS = 1200;
const DEFAULT_SCROLL_ITERATIONS = 10;
const DEFAULT_PAGE_LIMIT = 10;
const DEFAULT_MAX_ITEMS = 10_000;
const DEFAULT_ITEM_SELECTOR_TIMEOUT_MS = 18_000;
const DEFAULT_SPINNER_BUDGET_MS = 8_000;
const DEFAULT_LOAD_MORE_WAIT_MS = 12_000;
const EMPTY_STRIKE_LIMIT = 3;

const normalizeWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

/**
 * Strip Maxun recorder-artifact classes (e.g. `.__maxun_list_highlight`,
 * `.__maxun_highlight`, `.__maxun_selected`) from any CSS selector. These
 * classes are injected by the Chrome extension at record-time to visually mark
 * the clicked element and MUST NOT end up in the persisted selector, because
 * they do not exist on the live target page — causing 0 matches at scrape time.
 *
 * Handles forms like `.__maxun_list_highlight`, `div.job-tile.__maxun_list_highlight`,
 * and escaped variants. Runs on every selector (item selector, field selectors,
 * next-button selector) as a defensive layer independent of the extension fix.
 */
const stripMaxunArtifactClasses = (selector: string): string => {
  if (!selector) return selector;
  return selector
    .replace(/\.__maxun_[a-zA-Z0-9_-]+/g, '')
    .replace(/\\\.__maxun_[a-zA-Z0-9_-]+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
};

const normalizeSelector = (value?: string | null): string => {
  if (typeof value !== 'string') return '';
  return stripMaxunArtifactClasses(value.trim());
};

const isMeaningful = (value: unknown): boolean => {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return normalizeWhitespace(value).length > 0;
  return true;
};

const cleanRow = (row: Record<string, any>): Record<string, any> => {
  return Object.entries(row).reduce<Record<string, any>>((acc, [key, value]) => {
    if (typeof value === 'string') {
      acc[key] = normalizeWhitespace(value);
    } else {
      acc[key] = value;
    }
    return acc;
  }, {});
};

const sanitizeFields = (fields: ListExtractionFieldMap = {}): ListExtractionFieldMap => {
  return Object.entries(fields).reduce<ListExtractionFieldMap>((acc, [fieldName, selectorSpec]) => {
    const normalized = normalizeSelector(selectorSpec);
    if (!normalized) {
      logger.log('warn', `List extractor skipped field "${fieldName}" because its selector is empty`);
      return acc;
    }
    acc[fieldName] = normalized;
    return acc;
  }, {});
};

const sanitizeExtractionConfig = (config: ListExtractionConfig): ListExtractionConfig => {
  const itemSelector = normalizeSelector(config.itemSelector);
  const nextButtonSelector = normalizeSelector(config.pagination?.nextButtonSelector);

  return {
    ...config,
    itemSelector,
    fields: sanitizeFields(config.fields),
    pagination: config.pagination
      ? {
          ...config.pagination,
          nextButtonSelector: nextButtonSelector || undefined,
        }
      : undefined,
  };
};

/**
 * Auto-scroll the list's actual scroll container (not always `window`) using
 * the shared `scrollEngine` helpers. Mirrors the Chrome extension's
 * `autoScrollAndExtract` loop: stepScroll -> waitForLoadingToFinish ->
 * waitForMoreItems, with an empty-strikes counter for end-of-content.
 *
 * `listSelector` is required for virtualised lists (so we locate the
 * overflow-scroll ancestor); when it's absent we fall back to window scroll.
 */
export const autoScrollPage = async (
  page: Page,
  delayMs: number = DEFAULT_SCROLL_DELAY_MS,
  maxIterations: number = DEFAULT_SCROLL_ITERATIONS,
  listSelector?: string,
  spinnerBudgetMs: number = DEFAULT_SPINNER_BUDGET_MS
): Promise<void> => {
  let consecutiveEmpty = 0;
  let previousHeight = -1;

  for (let i = 0; i < maxIterations; i++) {
    const beforeCount = await countListItems(page, listSelector);
    const beforeHeight = await getScrollHeight(page, listSelector);

    const moved = await stepScroll(page, listSelector, 'down', 'toEnd');

    const effectiveSpinnerBudget = Math.max(spinnerBudgetMs, delayMs * 2);
    await waitForLoadingToFinish(page, listSelector, effectiveSpinnerBudget, 300);

    const growth = await waitForMoreItems(
      page,
      listSelector,
      beforeCount,
      beforeHeight,
      Math.max(800, delayMs)
    );

    const madeProgress = moved || growth.changed;
    if (!madeProgress) {
      consecutiveEmpty++;
      if (consecutiveEmpty >= EMPTY_STRIKE_LIMIT) {
        logger.log(
          'info',
          `autoScrollPage: end of content after ${i + 1} steps (${consecutiveEmpty} empty strikes, items=${growth.newCount})`
        );
        break;
      }
      await page.waitForTimeout(250).catch(() => undefined);
      continue;
    }

    consecutiveEmpty = 0;
    const currentHeight = await getScrollHeight(page, listSelector);
    if (currentHeight > 0 && currentHeight === previousHeight && !growth.changed) {
      break;
    }
    previousHeight = currentHeight;
  }
};

export const extractListItemsFromPage = async (
  page: Page,
  config: ListExtractionConfig
): Promise<Record<string, any>[]> => {
  const safeConfig = sanitizeExtractionConfig(config);

  if (!safeConfig.itemSelector) {
    logger.log('warn', 'extractListItemsFromPage: empty itemSelector; skipping $$eval');
    return [];
  }

  if (Object.keys(safeConfig.fields).length === 0) {
    logger.log('warn', 'extractListItemsFromPage: no valid field selectors remain after sanitization');
    return [];
  }

  let matchedCount = 0;
  try {
    await page.waitForSelector(safeConfig.itemSelector, {
      state: 'attached',
      timeout: DEFAULT_ITEM_SELECTOR_TIMEOUT_MS,
    });
    matchedCount = await page.locator(safeConfig.itemSelector).count();
  } catch {
    logger.log(
      'warn',
      `extractListItemsFromPage: item selector not found within ${DEFAULT_ITEM_SELECTOR_TIMEOUT_MS}ms — continuing (may return 0 rows)`
    );
  }

  if (matchedCount === 0) {
    // No point running $$eval when nothing matches — let the caller decide
    // whether to fall back to smart extraction.
    return [];
  }

  const rows = await page.$$eval(
    safeConfig.itemSelector,
    (elements, fields) => {
      const parseFieldSpecInner = (spec: string): { selector: string; attribute: string } => {
        const trimmed = spec.trim();
        const atIndex = trimmed.lastIndexOf('@');
        if (atIndex > 0) {
          return {
            selector: trimmed.slice(0, atIndex).trim(),
            attribute: trimmed.slice(atIndex + 1).trim().toLowerCase(),
          };
        }
        return { selector: trimmed, attribute: 'innertext' };
      };

      /** Element#querySelector needs :scope for combinators like >, +, ~ */
      const normalizeRelativeSelector = (selector: string): string => {
        const s = selector.trim();
        if (!s) return s;
        const first = s.charAt(0);
        if (first === '>' || first === '+' || first === '~') {
          return `:scope ${s}`;
        }
        return s;
      };

      /**
       * Recursively collect visible text from nested elements. Mirrors the
       * extension's `clientListExtractor.collectTextDeep` — handles cases like
       * Amazon prices `<span class="a-price"><sup>$</sup><span class="a-price-whole">59</span></span>`
       * where `innerText` on the parent returns nothing but the leaf texts are meaningful.
       */
      const collectTextDeep = (el: Element): string => {
        const parts: string[] = [];
        for (const node of Array.from(el.childNodes)) {
          if (node.nodeType === Node.TEXT_NODE) {
            const t = (node.textContent || '').trim();
            if (t) parts.push(t);
          } else if (node.nodeType === Node.ELEMENT_NODE) {
            const child = node as Element;
            const tag = child.tagName;
            if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'SVG' || tag === 'NOSCRIPT' || tag === 'IFRAME') continue;
            const childText = collectTextDeep(child);
            if (childText) parts.push(childText);
          }
        }
        return parts.join(' ').replace(/\s+/g, ' ').trim();
      };

      const DATA_TEXT_ATTRS = ['data-text', 'data-label', 'data-value', 'data-content', 'data-price', 'data-amount', 'aria-label'];

      const queryWithin = (root: Element, selector: string): Element | null => {
        if (!selector) return root;
        // XPath selector (extension recorders sometimes emit XPath)
        if (selector.startsWith('//') || selector.startsWith('./')) {
          try {
            const ownerDoc = root.ownerDocument || document;
            // `./` is relative to root; `//` is document-wide.
            const ctx: Node = selector.startsWith('./') ? root : ownerDoc;
            const res = ownerDoc.evaluate(selector, ctx, null, 9 /* FIRST_ORDERED_NODE_TYPE */, null);
            return (res.singleNodeValue as Element) || null;
          } catch {
            return null;
          }
        }
        try {
          return root.querySelector(normalizeRelativeSelector(selector));
        } catch {
          return null;
        }
      };

      const queryAllWithin = (root: Element, selector: string): Element[] => {
        if (!selector) return [root];
        if (selector.startsWith('//') || selector.startsWith('./')) {
          try {
            const ownerDoc = root.ownerDocument || document;
            const ctx: Node = selector.startsWith('./') ? root : ownerDoc;
            const res = ownerDoc.evaluate(selector, ctx, null, 7 /* ORDERED_NODE_SNAPSHOT_TYPE */, null);
            const out: Element[] = [];
            for (let i = 0; i < res.snapshotLength; i++) {
              const n = res.snapshotItem(i);
              if (n && n.nodeType === Node.ELEMENT_NODE) out.push(n as Element);
            }
            return out;
          } catch {
            return [];
          }
        }
        try {
          return Array.from(root.querySelectorAll(normalizeRelativeSelector(selector)));
        } catch {
          return [];
        }
      };

      const extractValueInner = (root: Element, spec: string): string | null => {
        const { selector, attribute } = parseFieldSpecInner(spec);

        const isTextAttr =
          attribute === 'innertext' ||
          attribute === 'text' ||
          attribute === 'textcontent';

        if (isTextAttr) {
          const nodes = queryAllWithin(root, selector);
          for (const target of nodes) {
            if (!target || target.nodeType !== Node.ELEMENT_NODE) continue;
            const el = target as HTMLElement;
            let text = typeof el.innerText === 'string' ? el.innerText.trim() : '';
            if (!text) text = (el.textContent || '').trim();
            if (!text) text = collectTextDeep(el);
            if (!text) {
              for (const attr of DATA_TEXT_ATTRS) {
                const v = el.getAttribute(attr);
                if (v && v.trim()) { text = v.trim(); break; }
              }
            }
            if (text.length > 0) return text;
          }
          return null;
        }

        if (attribute === 'href') {
          /**
           * Job boards (amazon.jobs, etc.): title node often has no wrapping <a>;
           * URL may be a sibling <a>, on a parent tile, or only in data-* until hydrated.
           * Also: `if (!target) return null` used to run before this branch, so a wrong/missing
           * url selector never reached row scanning — handle href before that early exit.
           */
          const baseDoc = (el: Element) => (el.ownerDocument?.location?.href) || window.location.href;

          const resolveUrlLikeFromEl = (el: Element | null): string | null => {
            if (!el) return null;
            const raw = (
              el.getAttribute('href') ||
              el.getAttribute('data-href') ||
              el.getAttribute('data-url') ||
              el.getAttribute('data-link') ||
              ''
            ).trim();
            if (!raw) return null;
            const low = raw.toLowerCase();
            if (low.startsWith('javascript:') || low === '#' || low.startsWith('mailto:') || low.startsWith('tel:'))
              return null;
            try {
              return new URL(raw, baseDoc(el)).href;
            } catch {
              return raw;
            }
          };

          const scorePath = (pathname: string, absLower: string): number => {
            const p = pathname.toLowerCase();
            let score = 12 + Math.min(pathname.length, 120) / 40;
            if (p.includes('/job')) score += 110;
            if (p.includes('/jobs')) score += 90;
            if (p.includes('/content/en/jobs')) score += 95;
            if (p.includes('job-detail') || p.includes('jobdetail')) score += 75;
            if (p.includes('/career')) score += 38;
            if (absLower.includes('amazon.jobs') && p.length > 15) score += 15;
            return score;
          };

          const scored: { href: string; score: number }[] = [];

          const gatherCandidatesFromSubtree = (row: Element, depthPenalty: number): void => {
            const seen = new Set<Element>();
            const q = 'a, [href], [data-href], [data-url], [data-link], [role="link"]';
            for (const n of Array.from(row.querySelectorAll(q))) {
              if (seen.has(n)) continue;
              seen.add(n);
              const abs = resolveUrlLikeFromEl(n);
              if (!abs) continue;
              let path = '';
              try {
                path = new URL(abs).pathname;
              } catch {
                path = abs;
              }
              let sc = scorePath(path, abs.toLowerCase()) - depthPenalty;
              if (n.getAttribute('aria-disabled') === 'true') sc -= 45;
              if (n.tagName === 'A' && !(n.getAttribute('href') || '').trim()) sc -= 25;
              scored.push({ href: abs, score: sc });
            }
          };
          const target = selector.trim() ? queryWithin(root, selector) : null;

          if (target) {
            let anchor: Element | null = target;
            if (anchor.tagName !== 'A') {
              anchor = target.closest('a') || target.parentElement?.closest('a') || null;
            }
            const direct = resolveUrlLikeFromEl(anchor);
            if (direct) {
              let path = '';
              try {
                path = new URL(direct).pathname;
              } catch {
                path = direct;
              }
              scored.push({ href: direct, score: scorePath(path, direct.toLowerCase()) + 5 });
            }
          }

          let hop: Element | null = root;
          for (let d = 0; d < 5 && hop; d++) {
            gatherCandidatesFromSubtree(hop, d * 28);
            hop = hop.parentElement;
          }

          if (!scored.length) return null;
          const best = new Map<string, number>();
          for (const { href: h, score: s } of scored) {
            const prev = best.get(h);
            if (prev === undefined || s > prev) best.set(h, s);
          }
          let topHref = '';
          let topScore = -1e9;
          for (const [h, s] of best) {
            if (s > topScore) {
              topScore = s;
              topHref = h;
            }
          }
          return topHref || null;
        }

        const target = queryWithin(root, selector);
        if (!target) return null;

        if (attribute === 'html') {
          return (target as HTMLElement).innerHTML || '';
        }

        if (attribute === 'src') {
          const raw = target.getAttribute('src') || target.getAttribute('data-src');
          if (!raw || !raw.trim()) {
            try {
              const bg = window.getComputedStyle(target as HTMLElement).backgroundImage;
              const m = bg && bg.match(/url\(["']?([^"')]+)["']?\)/);
              if (m && m[1]) return new URL(m[1], window.location.href).href;
            } catch { /* ignore */ }
            return null;
          }
          try { return new URL(raw, window.location.href).href; } catch { return raw; }
        }

        return target.getAttribute(attribute);
      };

      return elements.map((element) => {
        return Object.entries(fields).reduce<Record<string, any>>((acc, [fieldName, selectorSpec]) => {
          // `fixed` attribute means the selector IS the literal value
          // (used by extension for per-page "company: Amazon@fixed" patterns).
          const spec = String(selectorSpec);
          const atIndex = spec.lastIndexOf('@');
          if (atIndex > 0 && spec.slice(atIndex + 1).trim().toLowerCase() === 'fixed') {
            acc[fieldName] = spec.slice(0, atIndex);
            return acc;
          }
          acc[fieldName] = extractValueInner(element, spec);
          return acc;
        }, {});
      });
    },
    safeConfig.fields
  );

  const cleaned = rows.map(cleanRow).filter((row) => Object.values(row).some((value) => isMeaningful(value)));
  if (cleaned.length === 0 && rows.length > 0) {
    logger.log(
      'warn',
      'extractListItemsFromPage: matched item nodes but every field was empty after extraction — check field selectors (use :scope > child, or a more specific sub-selector)'
    );
  }
  return cleaned;
};

/**
 * Dedup rows using the same fingerprint formula as the Chrome extension
 * (`chrome-extension/src/content/extractionRunner.ts` `fingerprintRow`). Keeps
 * whitespace / case / trim differences from creating "false" duplicates.
 * Still respects `uniqueKey` when present (useful for URL / SKU dedup).
 */
const dedupeRows = (rows: Record<string, any>[], uniqueKey?: string): Record<string, any>[] => {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const fingerprint =
      uniqueKey && row && row[uniqueKey]
        ? String(row[uniqueKey]).trim().toLowerCase()
        : fingerprintRow(row);

    if (!fingerprint || seen.has(fingerprint)) {
      return false;
    }

    seen.add(fingerprint);
    return true;
  });
};

/**
 * Many SPAs (e.g. amazon.jobs Stencil pagination) disable "Next" with `aria-disabled="true"`
 * only — no `disabled` attribute. The old check caused 30s click timeouts on the last page.
 * Mirrors `clickPaginationButton` in the Chrome extension content script.
 */
const isNextControlDisabled = async (loc: Locator): Promise<boolean> => {
  if ((await loc.count()) === 0) return true;
  const first = loc.first();
  if ((await first.getAttribute('disabled')) !== null) return true;
  const aria = (await first.getAttribute('aria-disabled'))?.toLowerCase();
  if (aria === 'true' || aria === '1') return true;
  try {
    return !(await first.isEnabled());
  } catch {
    return true;
  }
};

const paginateByNextButton = async (
  page: Page,
  pagination: ListExtractionPaginationConfig,
  currentPage: number,
  itemSelector: string | undefined
) => {
  const nextButtonSelector = normalizeSelector(pagination.nextButtonSelector);
  if (!nextButtonSelector) {
    logger.log('warn', 'List extractor pagination skipped because nextButtonSelector is empty');
    return false;
  }
  const nextButton = page.locator(nextButtonSelector).first();
  const count = await nextButton.count();
  if (count === 0) return false;
  if (await isNextControlDisabled(nextButton)) {
    logger.log(
      'info',
      'List extractor: next control is disabled or not enabled — stopping pagination (last page or blocked)'
    );
    return false;
  }

  // Snapshot before click so we can assert the page actually re-rendered,
  // matching the extension's `waitForPageChange` behaviour.
  const before = await snapshotListArea(page, itemSelector);

  await nextButton.click();
  await page.waitForLoadState('networkidle').catch(() => undefined);

  const waitBudget = Math.max(pagination.loadMoreWaitMs || DEFAULT_LOAD_MORE_WAIT_MS, 4000);
  const changed = await waitForPageChange(page, itemSelector, before, waitBudget);
  if (!changed) {
    logger.log(
      'warn',
      `paginateByNextButton: page did not change within ${waitBudget}ms after clicking next (page ${currentPage + 1})`
    );
  }
  await page.waitForTimeout(pagination.pageDelayMs || DEFAULT_SCROLL_DELAY_MS);
  logger.log('info', `List extractor clicked next button for page ${currentPage + 1} (changed=${changed})`);
  return true;
};

const paginateByPageNumber = async (
  page: Page,
  startUrl: string,
  pagination: ListExtractionPaginationConfig,
  currentPage: number
) => {
  const pageParam = pagination.pageParam || 'page';
  // `advancePagination` passes `currentPage = pageIndex + 1` after each extracted page.
  // Next URL page index must be startPage + currentPage (e.g. after page 1, currentPage=1 → next is startPage+1 = 2).
  // The old `(startPage||1) + currentPage - 1` incorrectly stayed on page 1 when the start URL already had `page=1`.
  const startBase =
    typeof pagination.startPage === 'number' && !Number.isNaN(pagination.startPage)
      ? pagination.startPage
      : 1;
  const nextPage = startBase + currentPage;
  const nextUrl = new URL(page.url() || startUrl);
  nextUrl.searchParams.set(pageParam, String(nextPage));
  const currentUrl = page.url() || '';
  const samePageParam =
    new URL(currentUrl || startUrl).searchParams.get(pageParam) === String(nextPage);
  if (samePageParam || nextUrl.toString() === currentUrl) return false;
  await gotoForListExtraction(page, nextUrl.toString());
  await page.waitForTimeout(pagination.pageDelayMs || DEFAULT_SCROLL_DELAY_MS);
  logger.log('info', `List extractor navigated to page loop URL ${nextUrl}`);
  return true;
};

async function gotoForListExtraction(page: Page, url: string): Promise<void> {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  } catch (err: any) {
    logger.log('warn', `List extractor goto failed on first try: ${err.message}; retrying with commit wait`);
    await page.goto(url, { waitUntil: 'commit', timeout: 60_000 });
  }

  // Let late-binding React/Next.js chunks finish hydrating. `networkidle` on
  // modern SPA job boards (amazon.jobs, ally.avature.net) frequently never
  // fires because of long-poll analytics / heartbeat pings, which caused the
  // previous 100s budget to be wasted before the list even rendered.
  try {
    await page.waitForLoadState('networkidle', { timeout: 15_000 });
  } catch { /* ignore — SPA heartbeats keep network open */ }

  logger.log('info', `List extractor navigation to ${url} completed`);
  await waitForCloudflareIfPresent(page);
}

const advancePagination = async (
  page: Page,
  startUrl: string,
  config: ListExtractionConfig,
  currentPage: number
) => {
  const pagination = config.pagination || {};
  const spinnerBudget = pagination.scrollSpinnerBudgetMs || DEFAULT_SPINNER_BUDGET_MS;
  switch (pagination.mode) {
    case 'next-button':
      return paginateByNextButton(page, pagination, currentPage, config.itemSelector);
    case 'page-number-loop':
      return paginateByPageNumber(page, startUrl, pagination, currentPage);
    case 'infinite-scroll':
      await autoScrollPage(
        page,
        config.scrollDelayMs,
        pagination.maxScrollSteps || config.maxScrollIterations,
        config.itemSelector,
        spinnerBudget
      );
      return false;
    default:
      return false;
  }
};

export const runListExtraction = async (
  page: Page,
  startUrl: string,
  config: ListExtractionConfig
): Promise<Record<string, any>[]> => {
  const safeConfig = sanitizeExtractionConfig(config);
  const pageLimit = config.pagination?.maxPages || DEFAULT_PAGE_LIMIT;
  const maxItemsCap = typeof safeConfig.maxItems === 'number' && safeConfig.maxItems > 0
    ? safeConfig.maxItems
    : DEFAULT_MAX_ITEMS;
  const popupsOptions: OverlayDismisserOptions = safeConfig.popups || { autoDismiss: true };
  const captchaOptions: CaptchaGateOptions = safeConfig.captcha || { pauseOnDetect: true };
  const spinnerBudget =
    config.pagination?.scrollSpinnerBudgetMs || DEFAULT_SPINNER_BUDGET_MS;
  const allRows: Record<string, any>[] = [];

  // Install global page guards: alert/confirm auto-dismiss + per-pass
  // overlay/CAPTCHA hooks mirror the extension's runtime behaviour.
  const disposeDialog = installDialogHandler(page, popupsOptions);

  try {
    await gotoForListExtraction(page, startUrl);
    // Dismiss any banner that appeared on the very first paint.
    await dismissOverlays(page, popupsOptions);
    await assertNoCaptcha(page, captchaOptions);

    const runSmartExtraction = async (): Promise<Record<string, any>[]> => {
      try {
        await page.waitForTimeout(3000);
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(2000);
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(1000);

        const scriptContent = fs.readFileSync(SMART_EXTRACTOR_SCRIPT_PATH, 'utf-8');
        const discoveredRows = await page.evaluate(scriptContent);
        if (Array.isArray(discoveredRows)) {
          logger.log('info', `Smart extraction discovered ${discoveredRows.length} potential job items.`);
          return discoveredRows as Record<string, any>[];
        }
      } catch (error: any) {
        logger.log('error', `Smart extraction failed: ${error.message}`);
      }
      return [];
    };

    // SMART EXTRACTION FALLBACK: URL-only automation (no configured selector).
    if (!safeConfig.itemSelector) {
      logger.log('info', `No item selector provided for ${startUrl}. Attempting smart job extraction...`);
      return runSmartExtraction();
    }

    for (let pageIndex = 0; pageIndex < pageLimit; pageIndex++) {
      // Refresh guards between pages — SPA navigations can spawn new banners
      // and occasionally present a CAPTCHA challenge mid-session.
      await dismissOverlays(page, popupsOptions);
      await assertNoCaptcha(page, captchaOptions);

      if (safeConfig.autoScroll || safeConfig.pagination?.mode === 'infinite-scroll') {
        await autoScrollPage(
          page,
          safeConfig.scrollDelayMs,
          safeConfig.pagination?.maxScrollSteps || safeConfig.maxScrollIterations,
          safeConfig.itemSelector,
          spinnerBudget
        );
      }

      const pageRows = await extractListItemsFromPage(page, safeConfig);
      allRows.push(...pageRows);

      const dedupedCount = dedupeRows(allRows, safeConfig.uniqueKey).length;
      logger.log(
        'info',
        `List extractor gathered ${pageRows.length} rows on page ${pageIndex + 1} (${dedupedCount} unique rows total)`
      );

      if (dedupedCount >= maxItemsCap) {
        break;
      }

      const advanced = await advancePagination(page, startUrl, safeConfig, pageIndex + 1);
      if (!advanced) {
        break;
      }
    }

    // FALLBACK: configured selector produced 0 rows across all pages — common
    // cause is a stale/fragile selector recorded months ago against markup that
    // has since changed. Try smart auto-discovery on the first page before
    // giving up, so scheduled runs don't silently produce empty datasets.
    if (allRows.length === 0) {
      logger.log(
        'warn',
        `Configured selector "${safeConfig.itemSelector}" produced 0 rows across ${pageLimit} page(s). Falling back to smart extraction on the landing page.`
      );
      try {
        await gotoForListExtraction(page, startUrl);
        await dismissOverlays(page, popupsOptions);
        const smartRows = await runSmartExtraction();
        if (smartRows.length > 0) {
          logger.log('info', `Smart extraction fallback yielded ${smartRows.length} rows.`);
          return smartRows.slice(0, maxItemsCap);
        }
      } catch (err: any) {
        logger.log('warn', `Smart extraction fallback failed: ${err.message}`);
      }
    }

    const dedupedRows = dedupeRows(allRows, safeConfig.uniqueKey);
    return dedupedRows.slice(0, maxItemsCap);
  } catch (error: any) {
    // CaptchaEncounteredError must propagate to the worker so the run can be
    // paused and a `captcha:required` socket event can be emitted.
    if (error instanceof CaptchaEncounteredError) {
      throw error;
    }
    throw error;
  } finally {
    try {
      disposeDialog();
    } catch {
      /* ignore */
    }
  }
};
