import { BrowserContext, Locator, Page, Route } from 'playwright-core';
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
import { fixGoogleCareersJobsUrl } from '../utils/googleCareersUrl';
import { assertSafeOutboundUrl, safeOutboundUrlLogLabel } from '../utils/outboundUrlPolicy';

const SMART_EXTRACTOR_SCRIPT_PATH = path.join(__dirname, '../workflow-management/scripts/smartJobExtractor.js');

export type FieldSelectorSpec = string | string[];

export interface ListExtractionFieldMap {
  [fieldName: string]: FieldSelectorSpec;
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
  /** Primary item selector, or ranked list tried until matches exist. */
  itemSelector: string | string[];
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

export interface SelectorPromotion {
  field: string;
  from: string;
  to: string;
  winRatio: number;
}

export interface ListExtractionResult {
  rows: Record<string, any>[];
  /** Field selectors promoted to index 0 after a successful fallback win. */
  selectorPromotions: SelectorPromotion[];
  /** Item selector that actually matched (when ranked). */
  winningItemSelector?: string;
}

const DEFAULT_SCROLL_DELAY_MS = 1200;
const DEFAULT_SCROLL_ITERATIONS = 10;
const DEFAULT_PAGE_LIMIT = 10;
const DEFAULT_MAX_ITEMS = 10_000;
const DEFAULT_ITEM_SELECTOR_TIMEOUT_MS = 45_000;
const DEFAULT_SPINNER_BUDGET_MS = 8_000;
const DEFAULT_LOAD_MORE_WAIT_MS = 12_000;
const EMPTY_STRIKE_LIMIT = 3;

/**
 * Guard every HTTP(S) browser request, including subresources and redirects.
 *
 * This is a best-effort browser-layer SSRF check: Chromium and any configured
 * proxy resolve/connect after this route decision, so DNS rebinding and proxy
 * egress remain outside Node's authority. Production-grade enforcement needs a
 * hardened egress proxy/firewall which pins and filters destination addresses.
 */
type RouteOwner = Pick<Page, 'route' | 'unroute'>;

async function installOutboundRouteGuard(owner: RouteOwner): Promise<() => Promise<void>> {
  const handler = async (route: Route): Promise<void> => {
    const request = route.request();
    const requestUrl = request.url();
    if (!/^https?:\/\//i.test(requestUrl)) {
      await route.continue();
      return;
    }

    try {
      await assertSafeOutboundUrl(requestUrl);
      await route.continue();
    } catch {
      await route.abort('blockedbyclient');
    }
  };

  await owner.route('**/*', handler);
  return async () => {
    await owner.unroute('**/*', handler);
  };
}

export async function installOutboundNavigationGuard(page: Page): Promise<() => Promise<void>> {
  return installOutboundRouteGuard(page);
}

/** Context routes cover every existing and future interpreter-created page. */
export async function installOutboundBrowserContextGuard(
  context: Pick<BrowserContext, 'route' | 'unroute'>
): Promise<() => Promise<void>> {
  return installOutboundRouteGuard(context);
}

/**
 * Keep navigation retries within the 120s scraper job budget. The prior two
 * 60s attempts could consume the whole job before extraction or worker retry.
 */
export const listNavigationAttempts = (url?: string) => {
  try {
    if (url && new URL(url).hostname.toLowerCase() === 'careers.persistent.com') {
      // This host has documented Chromium HTTP/2 instability. It can take
      // longer to establish a response even with HTTP/2 disabled. Keep 25s
      // of the default 120s job budget for hydration and extraction.
      return [
        { waitUntil: 'domcontentloaded' as const, timeout: 75_000 },
        { waitUntil: 'commit' as const, timeout: 20_000 },
      ];
    }
  } catch {
    // Use the default budget for malformed URLs.
  }
  return [
    { waitUntil: 'domcontentloaded' as const, timeout: 45_000 },
    { waitUntil: 'commit' as const, timeout: 20_000 },
  ];
};

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
      let v = normalizeWhitespace(value);
      // Google Careers SPA: path-relative `jobs/results/...` joins wrong against
      // `/jobs/results` in the document URL → `/jobs/jobs/results/` (404). Heal server-side (cloud list runs).
      if (/^https?:\/\//i.test(v)) v = fixGoogleCareersJobsUrl(v);
      acc[key] = v;
    } else {
      acc[key] = value;
    }
    return acc;
  }, {});
};

/** Normalize a field map value to a ranked non-empty selector list. */
export const normalizeFieldSelectorList = (selectorSpec: FieldSelectorSpec | null | undefined): string[] => {
  const raw = Array.isArray(selectorSpec) ? selectorSpec : [selectorSpec];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const normalized = normalizeSelector(typeof entry === 'string' ? entry : '');
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
};

const sanitizeFields = (fields: ListExtractionFieldMap = {}): ListExtractionFieldMap => {
  return Object.entries(fields).reduce<ListExtractionFieldMap>((acc, [fieldName, selectorSpec]) => {
    const ranked = normalizeFieldSelectorList(selectorSpec);
    if (ranked.length === 0) {
      logger.log('warn', `List extractor skipped field "${fieldName}" because its selector is empty`);
      return acc;
    }
    acc[fieldName] = ranked.length === 1 ? ranked[0] : ranked;
    return acc;
  }, {});
};

const sanitizeItemSelectors = (itemSelector: string | string[] | null | undefined): string[] => {
  return normalizeFieldSelectorList(itemSelector as FieldSelectorSpec);
};

/** First / primary selector string for APIs that need a single CSS selector. */
export const primaryItemSelector = (itemSelector: string | string[] | null | undefined): string => {
  return sanitizeItemSelectors(itemSelector)[0] || '';
};

/** Query keys that are 0-based row/item offsets (SuccessFactors `startrow`, etc.). */
const LIST_OFFSET_QUERY_KEYS = new Set(['startrow', 'offset', 'from']);
/** Query keys that are 1-based page numbers. */
const LIST_PAGE_QUERY_KEYS = ['pg', 'page', 'p'];

/**
 * Reset pagination query params so cloud scrapes start on page 1 (or configured
 * startPage) even when the robot URL was saved after the user paged in the extension.
 * Offset-style params (`startrow` / `offset` / `from`) reset to **0**, not 1.
 */
export function normalizeListStartUrl(
  startUrl: string,
  pagination?: ListExtractionPaginationConfig
): string {
  try {
    const u = new URL(startUrl);
    const preferred = String(pagination?.pageParam || '').trim().toLowerCase();
    const startPage = Math.max(1, Number(pagination?.startPage) || 1);
    let changed = false;

    const resetKey = (key: string) => {
      if (!u.searchParams.has(key)) return false;
      const value = LIST_OFFSET_QUERY_KEYS.has(key.toLowerCase()) ? '0' : String(startPage);
      u.searchParams.set(key, value);
      return true;
    };

    if (preferred) {
      changed = resetKey(preferred) || changed;
    }
    // Always clear offset params (SF `startrow`, etc.). A preferred pageParam like
    // `page` must not leave a saved `startrow=50` untouched — that scrapes only the last page.
    for (const key of LIST_OFFSET_QUERY_KEYS) {
      if (resetKey(key)) changed = true;
    }
    if (!changed) {
      for (const key of LIST_PAGE_QUERY_KEYS) {
        if (resetKey(key)) {
          changed = true;
          break;
        }
      }
    }
    return changed ? u.toString() : startUrl;
  } catch {
    return startUrl;
  }
}

const sanitizeExtractionConfig = (config: ListExtractionConfig): ListExtractionConfig => {
  const itemSelectors = sanitizeItemSelectors(config.itemSelector);
  const nextButtonSelector = normalizeSelector(config.pagination?.nextButtonSelector);

  return {
    ...config,
    itemSelector: itemSelectors.length <= 1 ? itemSelectors[0] || '' : itemSelectors,
    fields: sanitizeFields(config.fields),
    pagination: config.pagination
      ? {
          ...config.pagination,
          nextButtonSelector: nextButtonSelector || undefined,
        }
      : undefined,
  };
};

/** Flatten field map to Record<field, string[]> for in-page extraction. */
const fieldsAsRankedLists = (fields: ListExtractionFieldMap): Record<string, string[]> => {
  return Object.entries(fields).reduce<Record<string, string[]>>((acc, [name, spec]) => {
    const ranked = normalizeFieldSelectorList(spec);
    if (ranked.length) acc[name] = ranked;
    return acc;
  }, {});
};

/**
 * If a non-primary ranked selector wins for ≥50% of non-empty extractions,
 * recommend promoting it to index 0.
 */
export const computeSelectorPromotions = (
  fields: ListExtractionFieldMap,
  winCounts: Record<string, number[]>
): SelectorPromotion[] => {
  const promotions: SelectorPromotion[] = [];
  for (const [field, ranked] of Object.entries(fieldsAsRankedLists(fields))) {
    if (ranked.length < 2) continue;
    const counts = winCounts[field] || [];
    const total = counts.reduce((a, b) => a + b, 0);
    if (total <= 0) continue;
    let bestIdx = 0;
    let bestCount = counts[0] || 0;
    for (let i = 1; i < ranked.length; i += 1) {
      const c = counts[i] || 0;
      if (c > bestCount) {
        bestCount = c;
        bestIdx = i;
      }
    }
    if (bestIdx === 0) continue;
    const winRatio = bestCount / total;
    if (winRatio < 0.5) continue;
    promotions.push({
      field,
      from: ranked[0],
      to: ranked[bestIdx],
      winRatio,
    });
  }
  return promotions;
};

export const applySelectorPromotions = (
  fields: ListExtractionFieldMap,
  promotions: SelectorPromotion[]
): ListExtractionFieldMap => {
  if (!promotions.length) return fields;
  const next: ListExtractionFieldMap = { ...fields };
  for (const promo of promotions) {
    const ranked = normalizeFieldSelectorList(next[promo.field]);
    const without = ranked.filter((s) => s !== promo.to);
    next[promo.field] = [promo.to, ...without];
  }
  return next;
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

/**
 * Wait for async career widgets (Findly/CWS and similar) to hydrate job cards.
 * Succeeds when the item selector attaches, live-results count is > 0, or common
 * job-card markup appears.
 */
export async function waitForAsyncListHydration(
  page: Page,
  itemSelector: string | undefined,
  timeoutMs: number = DEFAULT_ITEM_SELECTOR_TIMEOUT_MS
): Promise<boolean> {
  const selector = String(itemSelector || '').trim();
  const deadline = Date.now() + Math.max(1_000, timeoutMs);

  if (selector) {
    try {
      await page.waitForSelector(selector, {
        state: 'attached',
        timeout: timeoutMs,
      });
      return true;
    } catch {
      /* fall through to heuristic poll */
    }
  }

  while (Date.now() < deadline) {
    try {
      const ready = await page.evaluate(() => {
        const text = document.body?.innerText || '';
        const live = text.match(/(\d+)\s+Live\s+Results/i);
        if (live && Number(live[1]) > 0) return true;
        if (
          document.querySelectorAll(
            'div.job.clearfix, li.job, .job-listing, [class*="job-card"], [data-job-id]'
          ).length > 0
        ) {
          return true;
        }
        return false;
      });
      if (ready) return true;
    } catch {
      /* page navigated mid-wait */
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await page.waitForTimeout(Math.min(500, remaining));
  }
  return false;
}

export const extractListItemsFromPage = async (
  page: Page,
  config: ListExtractionConfig
): Promise<{
  rows: Record<string, any>[];
  fieldWinCounts: Record<string, number[]>;
  winningItemSelector?: string;
}> => {
  const safeConfig = sanitizeExtractionConfig(config);
  const itemCandidates = sanitizeItemSelectors(safeConfig.itemSelector);
  const rankedFields = fieldsAsRankedLists(safeConfig.fields);

  if (itemCandidates.length === 0) {
    logger.log('warn', 'extractListItemsFromPage: empty itemSelector; skipping $$eval');
    return { rows: [], fieldWinCounts: {} };
  }

  if (Object.keys(rankedFields).length === 0) {
    logger.log('warn', 'extractListItemsFromPage: no valid field selectors remain after sanitization');
    return { rows: [], fieldWinCounts: {} };
  }

  let winningItemSelector = '';
  let matchedCount = 0;
  for (const candidate of itemCandidates) {
    try {
      await page.waitForSelector(candidate, {
        state: 'attached',
        timeout:
          itemCandidates.length === 1
            ? DEFAULT_ITEM_SELECTOR_TIMEOUT_MS
            : Math.min(6000, DEFAULT_ITEM_SELECTOR_TIMEOUT_MS),
      });
      matchedCount = await page.locator(candidate).count();
    } catch {
      matchedCount = 0;
    }
    if (matchedCount > 0) {
      winningItemSelector = candidate;
      break;
    }
  }

  if (!winningItemSelector || matchedCount === 0) {
    logger.log(
      'warn',
      `extractListItemsFromPage: no item selector matched (${itemCandidates.length} candidate(s))`
    );
    return { rows: [], fieldWinCounts: {} };
  }

  const evalResult = await page.$$eval(
    winningItemSelector,
    (elements, fields: Record<string, string[]>) => {
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
            const p = (pathname || '').toLowerCase().replace(/\/+$/, '') || '/';
            let score = 12 + Math.min(pathname.length, 120) / 40;
            const listingOnly =
              p === '/jobs' ||
              p === '/job' ||
              p === '/careers' ||
              p === '/career' ||
              p === '/search' ||
              (p.endsWith('/jobs') && !/\/jobs\/.+/i.test(p));
            const posting =
              /\/job\/[^/]+/i.test(p) ||
              /\/jobs\/\d+/i.test(p) ||
              /\/jobs\/listing\/[^/]+/i.test(p) ||
              /\/jobs\/[^/]{6,}/i.test(p);
            if (listingOnly) score -= 120;
            if (posting) score += 220;
            else {
              if (p.includes('job-detail') || p.includes('jobdetail')) score += 75;
              if (p.includes('/career')) score += 38;
            }
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

      const meaningful = (value: unknown): boolean => {
        if (value == null) return false;
        if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim().length > 0;
        return true;
      };

      const fieldWinCounts: Record<string, number[]> = {};
      for (const [fieldName, ranked] of Object.entries(fields)) {
        fieldWinCounts[fieldName] = (ranked || []).map(() => 0);
      }

      const rows = elements.map((element) => {
        return Object.entries(fields).reduce<Record<string, any>>((acc, [fieldName, ranked]) => {
          const list = Array.isArray(ranked) ? ranked : [String(ranked)];
          for (let i = 0; i < list.length; i += 1) {
            const spec = String(list[i] || '');
            // `fixed` attribute means the selector IS the literal value
            // (used by extension for per-page "company: Amazon@fixed" patterns).
            const atIndex = spec.lastIndexOf('@');
            if (atIndex > 0 && spec.slice(atIndex + 1).trim().toLowerCase() === 'fixed') {
              acc[fieldName] = spec.slice(0, atIndex);
              fieldWinCounts[fieldName][i] = (fieldWinCounts[fieldName][i] || 0) + 1;
              return acc;
            }
            const value = extractValueInner(element, spec);
            if (meaningful(value)) {
              acc[fieldName] = value;
              fieldWinCounts[fieldName][i] = (fieldWinCounts[fieldName][i] || 0) + 1;
              return acc;
            }
          }
          acc[fieldName] = null;
          return acc;
        }, {});
      });

      return { rows, fieldWinCounts };
    },
    rankedFields
  );

  const rows = Array.isArray(evalResult?.rows) ? evalResult.rows : [];
  const fieldWinCounts = evalResult?.fieldWinCounts || {};
  const cleaned = rows.map(cleanRow).filter((row) => Object.values(row).some((value) => isMeaningful(value)));
  if (cleaned.length === 0 && rows.length > 0) {
    logger.log(
      'warn',
      'extractListItemsFromPage: matched item nodes but every field was empty after extraction — check field selectors (use :scope > child, or a more specific sub-selector)'
    );
  }
  return { rows: cleaned, fieldWinCounts, winningItemSelector };
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
 * Explicit disabled signals only. Do NOT use Playwright `isEnabled()` for generic
 * locators — on Naukri (and similar boards) `.first()` often matches the current
 * page number or a non-button node where `isEnabled()` false-positives after page 2,
 * aborting pagination even when Max Pages is 3+.
 * Mirrors the extension's `clickPaginationButton` disabled checks.
 */
const isExplicitlyDisabledElement = async (loc: Locator): Promise<boolean> => {
  if ((await loc.count()) === 0) return true;
  const el = loc.first();
  if ((await el.getAttribute('disabled')) !== null) return true;
  const aria = (await el.getAttribute('aria-disabled'))?.toLowerCase();
  if (aria === 'true' || aria === '1') return true;
  const className = (await el.getAttribute('class')) || '';
  if (/(^|\s)(disabled|is-disabled|btn-disabled)(\s|$)/i.test(className)) return true;
  // Form controls: trust native disabled / Playwright enabled state.
  try {
    const tag = await el.evaluate((node) => (node as HTMLElement).tagName.toLowerCase());
    if (tag === 'button' || tag === 'input' || tag === 'select' || tag === 'textarea') {
      return !(await el.isEnabled());
    }
  } catch {
    /* treat as not explicitly disabled */
  }
  return false;
};

/**
 * Among all matches for the user selector, pick the real "Next" control (not page "1"
 * / current page). Mirrors extension `resolvePaginationElement(hint='next')`.
 * Returns the match index, or -1 if none.
 */
const resolveNextButtonIndex = async (
  page: Page,
  selector: string,
  targetPage: number
): Promise<number> => {
  try {
    return await page.evaluate(
      ({ sel, target }) => {
        let matches: HTMLElement[] = [];
        try {
          matches = Array.from(document.querySelectorAll(sel)) as HTMLElement[];
        } catch {
          return -1;
        }
        if (matches.length === 0) return -1;

        const isVisible = (el: HTMLElement) => {
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) return false;
          const style = window.getComputedStyle(el);
          if (style.visibility === 'hidden' || style.display === 'none') return false;
          return true;
        };
        const isDisabled = (el: HTMLElement) =>
          el.hasAttribute('disabled') ||
          el.getAttribute('aria-disabled') === 'true' ||
          /(^|\s)(disabled|is-disabled|btn-disabled)(\s|$)/i.test(el.className) ||
          (el as HTMLButtonElement).disabled === true;

        const visible = matches.filter(isVisible);
        const pool = visible.length > 0 ? visible : matches;
        const enabled = pool.filter((el) => !isDisabled(el));
        const searchPool = enabled.length > 0 ? enabled : pool;
        if (searchPool.length === 0) return -1;

        const indexOf = (el: HTMLElement) => matches.indexOf(el);

        // Prefer Load More / Show More Jobs (Oracle HCM) before classic Next controls.
        const byLoadMore = searchPool.find((el) => {
          const combined = `${(el.textContent || '').trim()} ${el.getAttribute('aria-label') || ''} ${
            el.getAttribute('title') || ''
          }`;
          return /\b(load\s*more|show\s*more|see\s*more|view\s*more)(\s+\w+){0,3}\b/i.test(combined);
        });
        if (byLoadMore) return indexOf(byLoadMore);

        const byRel = searchPool.find((el) => (el.getAttribute('rel') || '').toLowerCase() === 'next');
        if (byRel) return indexOf(byRel);

        const byAria = searchPool.find((el) => {
          const v = (el.getAttribute('aria-label') || '').toLowerCase();
          return /\b(next|siguiente|suivant|weiter|próximo)\b/.test(v);
        });
        if (byAria) return indexOf(byAria);

        const byText = searchPool.find((el) => {
          const text = (el.textContent || '').trim().toLowerCase();
          return (
            /\b(next|siguiente|suivant|weiter|próximo)\b/.test(text) ||
            /^(›|→|»|>)\s*$/.test(text) ||
            /(›|→|»)/.test(text)
          );
        });
        if (byText) return indexOf(byText);

        // Prefer a numbered page link matching the target page (Naukri-style).
        const byPageText = searchPool.find(
          (el) => (el.textContent || '').trim() === String(target)
        );
        if (byPageText) return indexOf(byPageText);

        const byHref = searchPool.find((el) => {
          const href = el.getAttribute('href') || '';
          return new RegExp(`[?&](?:page|pg|p)=${target}\\b`, 'i').test(href);
        });
        if (byHref) return indexOf(byHref);

        // Path suffix page (naukri.com/...-bangalore-3)
        const byPath = searchPool.find((el) => {
          const href = el.getAttribute('href') || '';
          return new RegExp(`-${target}(?:[/?#]|$)`).test(href);
        });
        if (byPath) return indexOf(byPath);

        // Last enabled match is usually "Next" in LTR pagers.
        return indexOf(searchPool[searchPool.length - 1]);
      },
      { sel: selector, target: targetPage }
    );
  } catch (err: any) {
    logger.log('warn', `resolveNextButtonIndex failed: ${err?.message || err}`);
    return -1;
  }
};

/**
 * Naukri / Indeed-style path pages: `...-bangalore` → `...-bangalore-2` → `...-bangalore-3`.
 * Used when the clickable next control is missing or falsely disabled.
 */
const buildPathIncrementUrl = (currentUrl: string, nextPage: number): string | null => {
  if (!nextPage || nextPage < 2) return null;
  try {
    const url = new URL(currentUrl);
    const path = url.pathname;
    const suffixRe = /-(\d+)\/?$/;
    if (suffixRe.test(path)) {
      url.pathname = path.replace(suffixRe, `-${nextPage}`);
      return url.toString();
    }
    // Page 1 often has no numeric suffix — only invent one on job-board-like paths.
    if (!/jobs|careers|search|portals|vacancies|openings/i.test(path)) return null;
    url.pathname = path.replace(/\/?$/, '') + `-${nextPage}`;
    return url.toString();
  } catch {
    return null;
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

  const targetPage = currentPage + 1;
  const matchCount = await page.locator(nextButtonSelector).count();
  let nextButton: Locator | null = null;

  if (matchCount > 0) {
    const idx = await resolveNextButtonIndex(page, nextButtonSelector, targetPage);
    if (idx >= 0) {
      nextButton = page.locator(nextButtonSelector).nth(idx);
      logger.log(
        'info',
        `List extractor resolved next control index=${idx} of ${matchCount} for page ${targetPage}`
      );
    } else {
      nextButton = page.locator(nextButtonSelector).first();
    }
  }

  const before = await snapshotListArea(page, itemSelector);

  if (nextButton) {
    const disabled = await isExplicitlyDisabledElement(nextButton);
    if (disabled && matchCount <= 1) {
      // Single Next control, honestly disabled → last page.
      logger.log(
        'info',
        `List extractor: next control is explicitly disabled — stopping pagination at page ${currentPage}`
      );
      return false;
    }

    if (!disabled) {
      try {
        await nextButton.click({ timeout: 8_000 });
        await page.waitForLoadState('networkidle').catch(() => undefined);

        const waitBudget = Math.max(pagination.loadMoreWaitMs || DEFAULT_LOAD_MORE_WAIT_MS, 4000);
        const changed = await waitForPageChange(page, itemSelector, before, waitBudget);
        await page.waitForTimeout(pagination.pageDelayMs || DEFAULT_SCROLL_DELAY_MS);
        logger.log(
          'info',
          `List extractor clicked next button for page ${targetPage} (changed=${changed})`
        );
        if (changed) return true;
        logger.log(
          'warn',
          `paginateByNextButton: page did not change after click (page ${targetPage}); trying path-URL fallback`
        );
      } catch (err: any) {
        logger.log(
          'warn',
          `paginateByNextButton: click failed (${err?.message || err}); trying path-URL fallback`
        );
      }
    } else {
      logger.log(
        'info',
        `List extractor: resolved next among ${matchCount} matches is disabled (likely wrong node) — trying path-URL fallback for page ${targetPage}`
      );
    }
  } else {
    logger.log(
      'info',
      `List extractor: next control not found for selector — trying path-URL fallback for page ${targetPage}`
    );
  }

  // Path-suffix fallback (Naukri `...-bangalore-2`, etc.) when click path stalls.
  const pathUrl = buildPathIncrementUrl(page.url() || '', targetPage);
  if (pathUrl && pathUrl !== (page.url() || '')) {
    await gotoForListExtraction(page, pathUrl);
    await page.waitForTimeout(pagination.pageDelayMs || DEFAULT_SCROLL_DELAY_MS);
    const after = await snapshotListArea(page, itemSelector);
    const changed = after.url !== before.url;
    logger.log(
      'info',
      `List extractor path-URL pagination on ${safeOutboundUrlLogLabel(pathUrl)} (changed=${changed})`
    );
    return changed;
  }

  logger.log(
    'info',
    'List extractor: next control unavailable and no path-URL fallback — stopping pagination'
  );
  return false;
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
  logger.log('info', `List extractor navigated page loop on ${safeOutboundUrlLogLabel(nextUrl.toString())}`);
  return true;
};

async function gotoForListExtraction(page: Page, url: string): Promise<void> {
  await assertSafeOutboundUrl(url);
  const attempts = listNavigationAttempts(url);
  let lastError: unknown;

  for (let index = 0; index < attempts.length; index += 1) {
    const attempt = attempts[index];
    try {
      await page.goto(url, attempt);
      lastError = undefined;
      break;
    } catch (error: any) {
      lastError = error;
      if (index < attempts.length - 1) {
        logger.log(
          'warn',
          `List extractor goto failed (${attempt.waitUntil}, ${attempt.timeout}ms): ${error.message}; retrying`
        );
      }
    }
  }

  if (lastError) {
    throw lastError;
  }

  // Let late-binding React/Next.js chunks finish hydrating. `networkidle` on
  // modern SPA job boards (amazon.jobs, ally.avature.net) frequently never
  // fires because of long-poll analytics / heartbeat pings, which caused the
  // previous 100s budget to be wasted before the list even rendered.
  try {
    await page.waitForLoadState('networkidle', { timeout: 15_000 });
  } catch { /* ignore — SPA heartbeats keep network open */ }

  logger.log('info', `List extractor navigation to ${safeOutboundUrlLogLabel(url)} completed`);
  const cloudflareCleared = await waitForCloudflareIfPresent(page);
  if (!cloudflareCleared) {
    // Fail fast — continuing pagination on a challenge page burns the job
    // hard-timeout (SCRAPER_JOB_TIMEOUT_MS) with 0 rows every page.
    throw new Error(
      `Cloudflare challenge did not clear after navigating to ${safeOutboundUrlLogLabel(url)}`
    );
  }
}

const advancePagination = async (
  page: Page,
  startUrl: string,
  config: ListExtractionConfig,
  currentPage: number
) => {
  const pagination = config.pagination || {};
  const spinnerBudget = pagination.scrollSpinnerBudgetMs || DEFAULT_SPINNER_BUDGET_MS;
  const itemSel = primaryItemSelector(config.itemSelector);
  switch (pagination.mode) {
    case 'next-button':
      return paginateByNextButton(page, pagination, currentPage, itemSel);
    case 'page-number-loop':
      return paginateByPageNumber(page, startUrl, pagination, currentPage);
    case 'infinite-scroll':
      await autoScrollPage(
        page,
        config.scrollDelayMs,
        pagination.maxScrollSteps || config.maxScrollIterations,
        itemSel,
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
): Promise<ListExtractionResult> => {
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
  const aggregatedWins: Record<string, number[]> = {};
  let winningItemSelector: string | undefined;

  const mergeWins = (pageWins: Record<string, number[]>) => {
    for (const [field, counts] of Object.entries(pageWins || {})) {
      if (!aggregatedWins[field]) {
        aggregatedWins[field] = counts.map((c) => c || 0);
        continue;
      }
      for (let i = 0; i < counts.length; i += 1) {
        aggregatedWins[field][i] = (aggregatedWins[field][i] || 0) + (counts[i] || 0);
      }
    }
  };

  const disposeDialog = installDialogHandler(page, popupsOptions);
  const disposeOutboundGuard = await installOutboundBrowserContextGuard(page.context());

  try {
    const effectiveStartUrl = normalizeListStartUrl(startUrl, safeConfig.pagination);
    if (effectiveStartUrl !== startUrl) {
      logger.log(
        'info',
        `List extractor reset start URL pagination on ${safeOutboundUrlLogLabel(effectiveStartUrl)}`
      );
    }
    await gotoForListExtraction(page, effectiveStartUrl);
    await dismissOverlays(page, popupsOptions);
    // Findly / DXC-style widgets often paint after language confirm + XHR.
    await dismissOverlays(page, popupsOptions);
    await assertNoCaptcha(page, captchaOptions);

    // Give async job widgets time to hydrate before the first extract pass.
    const bootSelector = primaryItemSelector(safeConfig.itemSelector);
    const hydrated = await waitForAsyncListHydration(
      page,
      bootSelector || undefined,
      DEFAULT_ITEM_SELECTOR_TIMEOUT_MS
    );
    if (!hydrated && bootSelector) {
      logger.log(
        'warn',
        `List extractor: item selector not ready after boot wait (${bootSelector})`
      );
    }

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

    const activeItemSelector = () =>
      winningItemSelector || primaryItemSelector(safeConfig.itemSelector);

    if (!primaryItemSelector(safeConfig.itemSelector)) {
      logger.log(
        'info',
        `No item selector provided for ${safeOutboundUrlLogLabel(effectiveStartUrl)}. Attempting smart job extraction...`
      );
      const smart = await runSmartExtraction();
      return { rows: smart.map(cleanRow), selectorPromotions: [] };
    }

    for (let pageIndex = 0; pageIndex < pageLimit; pageIndex++) {
      await dismissOverlays(page, popupsOptions);
      await assertNoCaptcha(page, captchaOptions);

      if (safeConfig.autoScroll || safeConfig.pagination?.mode === 'infinite-scroll') {
        await autoScrollPage(
          page,
          safeConfig.scrollDelayMs,
          safeConfig.pagination?.maxScrollSteps || safeConfig.maxScrollIterations,
          activeItemSelector(),
          spinnerBudget
        );
      }

      const pageResult = await extractListItemsFromPage(page, {
        ...safeConfig,
        itemSelector: winningItemSelector || safeConfig.itemSelector,
      });
      if (pageResult.winningItemSelector) {
        winningItemSelector = pageResult.winningItemSelector;
      }
      mergeWins(pageResult.fieldWinCounts);
      allRows.push(...pageResult.rows);

      const dedupedCount = dedupeRows(allRows, safeConfig.uniqueKey).length;
      logger.log(
        'info',
        `List extractor gathered ${pageResult.rows.length} rows on page ${pageIndex + 1} (${dedupedCount} unique rows total)`
      );

      if (dedupedCount >= maxItemsCap) {
        break;
      }

      const advanced = await advancePagination(
        page,
        effectiveStartUrl,
        { ...safeConfig, itemSelector: activeItemSelector() },
        pageIndex + 1
      );
      if (!advanced) {
        break;
      }
    }

    if (allRows.length === 0) {
      logger.log(
        'warn',
        `Configured selector "${primaryItemSelector(safeConfig.itemSelector)}" produced 0 rows across ${pageLimit} page(s). Falling back to smart extraction on the landing page.`
      );
      try {
        await gotoForListExtraction(page, effectiveStartUrl);
        await dismissOverlays(page, popupsOptions);
        const smartRows = await runSmartExtraction();
        if (smartRows.length > 0) {
          logger.log('info', `Smart extraction fallback yielded ${smartRows.length} rows.`);
          return {
            rows: smartRows.map(cleanRow).slice(0, maxItemsCap),
            selectorPromotions: [],
            winningItemSelector,
          };
        }
      } catch (err: any) {
        logger.log('warn', `Smart extraction fallback failed: ${err.message}`);
      }
    }

    const dedupedRows = dedupeRows(allRows, safeConfig.uniqueKey).slice(0, maxItemsCap);
    const selectorPromotions = computeSelectorPromotions(safeConfig.fields, aggregatedWins);
    if (selectorPromotions.length) {
      logger.log(
        'info',
        `Ranked selector promotions: ${selectorPromotions
          .map((p) => `${p.field}: ${p.from} → ${p.to} (${Math.round(p.winRatio * 100)}%)`)
          .join('; ')}`
      );
    }
    return { rows: dedupedRows, selectorPromotions, winningItemSelector };
  } catch (error: any) {
    if (error instanceof CaptchaEncounteredError) {
      throw error;
    }
    throw error;
  } finally {
    await disposeOutboundGuard().catch(() => undefined);
    try {
      disposeDialog();
    } catch {
      /* ignore */
    }
  }
};
