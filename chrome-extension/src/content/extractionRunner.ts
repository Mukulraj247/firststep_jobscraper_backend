/**
 * Extraction Runner - Executes data extraction from the page.
 * Uses ClientListExtractor for the actual extraction logic.
 */

import { clientListExtractor } from '../shared/clientListExtractor';
import type { FieldConfig, ExtractedRow } from '../shared/types';

/**
 * Extract data from the current page using the given selector and fields.
 */
export function extractPageData(
  listSelector: string,
  fields: Record<string, FieldConfig>,
  limit: number = 0
): ExtractedRow[] {
  // Convert FieldConfig to the format ClientListExtractor expects
  const extractorFields: Record<string, { selector: string; attribute: string; isShadow?: boolean; fromSchema?: boolean }> = {};

  for (const [label, config] of Object.entries(fields)) {
    extractorFields[label] = {
      selector: config.selector,
      attribute: config.attribute,
      isShadow: config.isShadow,
      fromSchema: config.fromSchema,
    };
  }

  return clientListExtractor.extractListData(document, listSelector, extractorFields, limit);
}

/**
 * Count items matching the list selector.
 */
export function countItems(listSelector: string): number {
  return clientListExtractor.countListItems(document, listSelector);
}

/**
 * Given any element (including SVGs, icons), walk up the DOM to find
 * the nearest interactive element (button, a, input, or any element
 * that has a click handler or is in a button/a/role=button).
 */
function getClickableElement(el: Element): Element | null {
  const CLICKABLE_TAGS = new Set(['button', 'a', 'input', 'select', 'textarea']);
  let current: Element | null = el;
  for (let i = 0; i < 10 && current !== null; i++) {
    const tag = current.tagName?.toLowerCase() || '';
    if (CLICKABLE_TAGS.has(tag)) return current;
    const role = current.getAttribute('role');
    if (role === 'button' || role === 'link' || role === 'menuitem') return current;
    // Stop if we hit a major structural boundary
    if (['main', 'nav', 'header', 'footer', 'aside'].includes(tag)) break;
    current = current.parentElement;
  }
  return null;
}

/**
 * When many nodes match the same selector (e.g. all page numbers + next), score
 * candidates so we prefer real "next" controls — not the last tab-stop in DOM
 * order (often the highest page number).
 */
function pickBestNextPaginationControl(
  searchPool: HTMLElement[],
  targetPage?: number
): HTMLElement | null {
  let best: HTMLElement | null = null;
  let bestScore = -Infinity;
  for (const el of searchPool) {
    let s = 0;
    const rel = (el.getAttribute('rel') || '').toLowerCase();
    if (rel === 'next') s += 200;

    const al = (el.getAttribute('aria-label') || '').toLowerCase();
    if (/\bnext\b/.test(al)) s += 160;
    if (/forward|siguiente|suivant|weiter|próximo|nächste/.test(al)) s += 140;

    const title = (el.getAttribute('title') || '').toLowerCase();
    if (/next|forward|pagination/.test(title)) s += 100;

    const t = (el.textContent || '').trim();
    if (/^next$/i.test(t)) s += 150;
    if (/^(›|→|»)\s*$/.test(t) || t === '>' || /^›{1,2}$/.test(t)) s += 130;

    if (/^\d+$/.test(t)) {
      const n = parseInt(t, 10);
      if (typeof targetPage === 'number' && n === targetPage) s += 120;
      else s -= 50;
    }

    const cls = ((el.className as any) || '').toString().toLowerCase();
    if (/chevron|arrow|next|forward|pager-next|pagination-next/.test(cls)) s += 40;

    const href = el.getAttribute('href') || '';
    if (typeof targetPage === 'number' && /[?&](page|pg|p|offset)=/i.test(href)) {
      const m = href.match(/[?&](?:page|pg|p|offset)=([^&]+)/i);
      if (m && String(m[1]) === String(targetPage)) s += 110;
    }

    if (s > bestScore) {
      bestScore = s;
      best = el;
    }
  }
  return bestScore >= 45 ? best : null;
}

/**
 * Resolve a user-provided pagination selector that may match multiple elements
 * (e.g. `a.page-link` matches Previous, 1, 2, …, Next). Picks the right one
 * based on the hint.
 *
 *   - hint='next' (default)  → prefer rel="next", aria-label/text with "next",
 *                              an href with incrementing page param, or the
 *                              LAST non-disabled match.
 *   - hint='prev'            → prefer rel="prev", text "prev/previous"
 *   - hint='pageNumber'      → prefer the element whose visible text equals
 *                              `targetPage` (1-indexed).
 */
function resolvePaginationElement(
  selector: string,
  hint: 'next' | 'prev' | 'loadMore' | 'pageNumber' = 'next',
  targetPage?: number
): HTMLElement | null {
  let matches: HTMLElement[] = [];
  try {
    matches = Array.from(document.querySelectorAll(selector)) as HTMLElement[];
  } catch (err) {
    console.warn('[Maxun] Invalid pagination selector:', selector, err);
    return null;
  }
  if (matches.length === 0) return null;

  const visible = matches.filter((el) => {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') return false;
    return true;
  });
  const pool = visible.length > 0 ? visible : matches;

  if (pool.length === 1) return pool[0];

  const isDisabled = (el: HTMLElement) =>
    el.hasAttribute('disabled') ||
    el.getAttribute('aria-disabled') === 'true' ||
    /(^|\s)(disabled|is-disabled)(\s|$)/.test(el.className) ||
    (el as HTMLButtonElement).disabled === true;

  const enabled = pool.filter((el) => !isDisabled(el));
  const searchPool = enabled.length > 0 ? enabled : pool;

  if (hint === 'pageNumber' && typeof targetPage === 'number') {
    const exact = searchPool.find((el) => (el.textContent || '').trim() === String(targetPage));
    if (exact) return exact;
  }

  if (hint === 'next') {
    const byRel = searchPool.find((el) => (el.getAttribute('rel') || '').toLowerCase() === 'next');
    if (byRel) return byRel;

    const byAria = searchPool.find((el) => {
      const v = (el.getAttribute('aria-label') || '').toLowerCase();
      return /\b(next|siguiente|suivant|weiter|próximo)\b/.test(v);
    });
    if (byAria) return byAria;

    const byText = searchPool.find((el) => {
      const text = (el.textContent || '').trim().toLowerCase();
      return /\b(next|siguiente|suivant|weiter|próximo)\b/.test(text) ||
             /^(›|→|»|>)\s*$/.test(text) ||
             /(›|→|»)/.test(text);
    });
    if (byText) return byText;

    if (typeof targetPage === 'number') {
      const byHref = searchPool.find((el) => {
        const href = el.getAttribute('href') || '';
        return new RegExp(`[?&](?:page|pg|p)=${targetPage}\\b`, 'i').test(href);
      });
      if (byHref) return byHref;
    }

    const scored = pickBestNextPaginationControl(searchPool, targetPage);
    if (scored) return scored;

    return searchPool[searchPool.length - 1];
  }

  if (hint === 'prev') {
    const byRel = searchPool.find((el) => /^prev(ious)?$/i.test(el.getAttribute('rel') || ''));
    if (byRel) return byRel;
    const byText = searchPool.find((el) => /\b(prev|previous|anterior)\b|^(‹|←|«|<)\s*$/i.test((el.textContent || '').trim()));
    if (byText) return byText;
    return searchPool[0];
  }

  if (hint === 'loadMore') {
    const byText = searchPool.find((el) =>
      /\b(load\s*more|show\s*more|see\s*more|view\s*more)(\s+\w+){0,3}\b/i.test(
        `${(el.textContent || '').trim()} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''}`
      )
    );
    if (byText) return byText;
    return searchPool[0];
  }

  return searchPool[0];
}

/**
 * Click pagination button and wait for DOM changes.
 * Uses Playwright-style event simulation to properly trigger React onClick handlers.
 * Returns true if new content was detected.
 */
export async function clickPaginationButton(
  selector: string,
  hint: 'next' | 'prev' | 'loadMore' | 'pageNumber' = 'next',
  targetPage?: number,
  listSelector?: string | null
): Promise<boolean> {
  let element: Element | null = resolvePaginationElement(selector, hint, targetPage);
  if (!element) {
    console.log('[Maxun] Pagination button NOT found for selector:', selector, 'hint:', hint);
    return false;
  }
  console.log(
    '[Maxun] Resolved pagination element:',
    (element as HTMLElement).tagName,
    (element as HTMLElement).className,
    'text:', (element.textContent || '').trim().slice(0, 30),
    'rel:', element.getAttribute('rel'),
    'aria-label:', element.getAttribute('aria-label'),
    'href:', element.getAttribute('href'),
  );

  const interactive = getClickableElement(element);
  if (!interactive) {
    console.log('[Maxun] No clickable parent found for selector:', selector);
    return false;
  }

  const tagName = interactive.tagName?.toLowerCase() || '';
  const isDisabled = interactive.hasAttribute('disabled') ||
    interactive.getAttribute('aria-disabled') === 'true' ||
    (interactive as HTMLButtonElement).disabled === true;

  console.log('[Maxun] Clickable element:', tagName, interactive.className, 'disabled:', isDisabled);

  // Scroll into view
  (interactive as HTMLElement).scrollIntoView({ behavior: 'instant', block: 'center' });
  await delay(500);

  // If disabled, wait for it to become enabled
  if (isDisabled) {
    console.log('[Maxun] Button is disabled, waiting for it to become enabled...');
    const enabled = await waitForElementEnabled(interactive as Element, 10000);
    if (!enabled) {
      console.log('[Maxun] Button never became enabled');
      return false;
    }
    console.log('[Maxun] Button became enabled');
  }

  // Capture state BEFORE click — prefer the same row selector used for extraction
  // so SPAs (e.g. Amazon Jobs) detect job list changes, not an unrelated wrapper.
  const listArea = findListArea();
  const beforeUrl = window.location.href;
  const beforeSnapshot = captureSnapshot(listArea);
  const beforeMetrics = listSelector ? captureListMetrics(listSelector) : null;

  console.log('[Maxun] Clicking pagination button...', {
    listSelector: listSelector || '(none)',
    metrics: beforeMetrics,
  });

  // Use Playwright-style event simulation for maximum React compatibility
  const rect = (interactive as HTMLElement).getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;

  const view = (interactive as HTMLElement).ownerDocument.defaultView || window;
  const target = interactive as HTMLElement;

  // Playwright-style pointer + mouse event sequence
  const pointerDown = new PointerEvent('pointerdown', {
    bubbles: true, cancelable: true, view,
    clientX: centerX, clientY: centerY,
    isPrimary: true, pointerId: 1, pointerType: 'mouse',
    width: 1, height: 1, pressure: 0.5, tiltX: 0, tiltY: 0,
  });
  const pointerUp = new PointerEvent('pointerup', {
    bubbles: true, cancelable: true, view,
    clientX: centerX, clientY: centerY,
    isPrimary: true, pointerId: 1, pointerType: 'mouse',
    width: 1, height: 1, pressure: 0, tiltX: 0, tiltY: 0,
  });
  const mouseDown = new MouseEvent('mousedown', {
    bubbles: true, cancelable: true, view,
    clientX: centerX, clientY: centerY, button: 0, buttons: 1,
  });
  const mouseUp = new MouseEvent('mouseup', {
    bubbles: true, cancelable: true, view,
    clientX: centerX, clientY: centerY, button: 0, buttons: 0,
  });
  const click = new MouseEvent('click', {
    bubbles: true, cancelable: true, view,
    clientX: centerX, clientY: centerY, button: 0, buttons: 0,
  });

  target.dispatchEvent(pointerDown);
  await delay(50);
  target.dispatchEvent(mouseDown);
  await delay(50);
  target.dispatchEvent(mouseUp);
  await delay(50);
  target.dispatchEvent(pointerUp);
  await delay(50);
  const clickResult = target.dispatchEvent(click);
  console.log('[Maxun] Click dispatched, defaultPrevented:', !clickResult);

  console.log('[Maxun] Button clicked, waiting for page to update...');

  let changed = await waitForPageChange(
    listArea,
    beforeSnapshot,
    beforeUrl,
    18000,
    listSelector || undefined,
    beforeMetrics
  );
  if (!changed && listSelector) {
    console.log('[Maxun] No change yet — waiting 2.5s for slow SPA render, then re-checking…');
    await delay(2500);
    changed = await waitForPageChange(
      listArea,
      beforeSnapshot,
      beforeUrl,
      8000,
      listSelector || undefined,
      beforeMetrics
    );
  }
  console.log('[Maxun] Page change detection result:', changed);
  return changed;
}

/**
 * Capture a snapshot of the list area for comparison.
 */
function captureSnapshot(element: Element): { html: string; htmlLen: number; firstItemText: string } {
  const firstItem = element.querySelector(':scope > *');
  const fullHtml = element.innerHTML || '';
  return {
    html: fullHtml.slice(0, 500),
    htmlLen: fullHtml.length,
    firstItemText: firstItem ? (firstItem.textContent || '').trim().slice(0, 100) : '',
  };
}

/** Fingerprint rows matching the user's list selector (same as extraction). */
function captureListMetrics(listSelector: string): {
  itemCount: number;
  firstItemText: string;
  sampleHash: string;
} {
  try {
    const items = Array.from(document.querySelectorAll(listSelector));
    const count = items.length;
    const firstItemText = items[0] ? (items[0].textContent || '').trim().slice(0, 120) : '';
    const sampleHash = items
      .slice(0, 8)
      .map((el) => (el.textContent || '').trim().slice(0, 80))
      .join('\u001f');
    return { itemCount: count, firstItemText, sampleHash };
  } catch {
    return { itemCount: 0, firstItemText: '', sampleHash: '' };
  }
}

/**
 * Wait for the page to actually change after a click.
 * When `listSelector` is provided, compares row fingerprints from that selector
 * (fixes SPAs where `findListArea()` snapshots the wrong node).
 */
function waitForPageChange(
  listArea: Element,
  before: { html: string; htmlLen: number; firstItemText: string },
  beforeUrl: string,
  timeoutMs: number,
  listSelector?: string,
  beforeMetrics?: { itemCount: number; firstItemText: string; sampleHash: string } | null
): Promise<boolean> {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    let resolved = false;
    const beforeCount = listArea.querySelectorAll(':scope > *').length;

    console.log(
      `[Maxun] waitForPageChange: timeout=${timeoutMs}ms, listSelector=${listSelector || 'n/a'}, ` +
        `areaChildren=${beforeCount}, htmlLen=${before.htmlLen}`
    );

    function succeed(label: string) {
      if (resolved) return;
      resolved = true;
      console.log(`[Maxun] Page change detected via ${label}`);
      clearInterval(intervalId);
      observer.disconnect();
      setTimeout(() => resolve(true), 1200);
    }

    function fail() {
      if (resolved) return;
      resolved = true;
      clearInterval(intervalId);
      observer.disconnect();
      console.log(`[Maxun] waitForPageChange: TIMED OUT`);
      resolve(false);
    }

    const intervalId = setInterval(() => {
      if (Date.now() > deadline) {
        fail();
        return;
      }

      if (window.location.href !== beforeUrl) {
        succeed('URL');
        return;
      }

      if (listSelector && beforeMetrics) {
        const m = captureListMetrics(listSelector);
        if (
          m.sampleHash !== beforeMetrics.sampleHash ||
          m.firstItemText !== beforeMetrics.firstItemText ||
          m.itemCount !== beforeMetrics.itemCount
        ) {
          succeed(
            `listSelector-metrics (count ${beforeMetrics.itemCount}→${m.itemCount})`
          );
          return;
        }
      }

      const snapshot = captureSnapshot(listArea);
      if (snapshot.firstItemText && snapshot.firstItemText !== before.firstItemText) {
        succeed('firstItem');
        return;
      }

      // Append-style loaders (Oracle "Show More Jobs") often grow HTML gradually;
      // require a real length delta using full lengths (not the 500-char preview).
      const beforeLen = Math.max(before.htmlLen || before.html.length || 1, 1);
      const afterLen = snapshot.htmlLen || listArea.innerHTML.length;
      const ratio = afterLen / beforeLen;
      if (ratio < 0.85 || ratio > 1.08 || afterLen - beforeLen > 800) {
        succeed(`HTML (${beforeLen}→${afterLen})`);
        return;
      }

      const afterChildren = listArea.querySelectorAll(':scope > *').length;
      if (afterChildren !== beforeCount) {
        succeed(`areaChildren (${beforeCount}→${afterChildren})`);
        return;
      }
    }, 280);

    const observer = new MutationObserver((mutations) => {
      if (resolved) return;
      for (const m of mutations) {
        if (m.type === 'childList') {
          console.log(`[Maxun] MutationObserver: childList change, polling will verify…`);
          break;
        }
      }
    });

    observer.observe(listArea, { childList: true, subtree: true });
  });
}

/**
 * Find the main list/job results area on the page.
 */
function findListArea(): Element {
  // Priority 1: specific job/list container selectors (most reliable)
  const jobSelectors = [
    'ul.jobs-module_root__gY8Hp',       // Amazon Jobs specific
    '[data-testid="search-results"]',
    '[data-testid="job-list"]',
    'ul[class*="job"][class*="root"]',
    'ul[class*="job-list"]',
    'ul[class*="result"][class*="root"]',
    '[class*="results"][class*="root"]',
    'ol[class*="job"]',
    'ol[class*="result"]',
  ];
  for (const sel of jobSelectors) {
    const el = document.querySelector(sel);
    if (el && el.children.length > 0) {
      console.log('[Maxun] findListArea: job selector', sel, '→', el.children.length, 'items');
      return el;
    }
  }

  // Priority 2: search all roots for the best ul/ol (most items, excluding nav/sidebar)
  const roots = document.querySelectorAll('main, [role="main"], #__next, article, .content, .main');
  let best: Element | null = null;
  let bestScore = 0;

  for (const root of roots) {
    const lists = root.querySelectorAll('ul, ol');
    for (const list of lists) {
      const score = list.children.length;
      if (score < 2) continue;
      const cls = (list.className || '').toLowerCase();
      // Skip filter, nav, sidebar, menu lists — they often have more items than the job list
      if (/filter|nav|menu|sidebar|breadcrumb|pagination|header|footer|dropdown/i.test(cls)) continue;
      if (score > bestScore) {
        bestScore = score;
        best = list;
      }
    }
  }

  if (best) {
    console.log('[Maxun] findListArea: best from roots', bestScore, 'items in', best.tagName, best.className.slice(0, 40));
    return best;
  }

  console.log('[Maxun] findListArea: no list found, using body');
  return document.body;
}

/**
 * Wait for an element to become enabled (not disabled).
 */
function waitForElementEnabled(el: Element, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    const observer = new MutationObserver(() => {
      if (!((el as HTMLButtonElement).disabled) && el.getAttribute('aria-disabled') !== 'true') {
        clearTimeout(timer);
        observer.disconnect();
        resolve(true);
      }
    });
    observer.observe(el, { attributes: true, attributeFilter: ['disabled', 'aria-disabled'] });
  });
}

/**
 * Find the nearest scrollable ancestor of the given element.
 * Returns `window` (represented as the document scrollingElement) if no
 * specific inner container scrolls the list.
 */
function findScrollRoot(el: Element | null): HTMLElement {
  const pageRoot = (document.scrollingElement || document.documentElement) as HTMLElement;
  if (!el) return pageRoot;

  let cur: HTMLElement | null = el as HTMLElement;
  while (cur && cur !== document.body && cur !== document.documentElement) {
    const style = getComputedStyle(cur);
    const canScroll =
      (style.overflowY === 'auto' || style.overflowY === 'scroll' || style.overflow === 'auto' || style.overflow === 'scroll') &&
      cur.scrollHeight > cur.clientHeight + 4;
    if (canScroll) return cur;
    cur = cur.parentElement;
  }
  return pageRoot;
}

/**
 * Count items matching `listSelector` with a safe fallback.
 */
function countListItems(listSelector: string | null | undefined): number {
  if (!listSelector) return 0;
  try {
    return document.querySelectorAll(listSelector).length;
  } catch {
    return 0;
  }
}

/**
 * Scroll the given target (window or inner container) by a viewport-sized
 * step in the requested direction. Returns true if the scroll position
 * actually moved.
 */
function stepScroll(
  target: HTMLElement,
  direction: 'down' | 'up',
  mode: 'viewport' | 'toEnd' = 'toEnd'
): boolean {
  const isPageRoot =
    target === document.scrollingElement || target === document.documentElement || target === document.body;

  // In `toEnd` mode we jump directly to the end of the currently-loaded content.
  // Infinite-scroll sites trigger their lazy-load when the viewport gets close
  // to the bottom, so one jump == one batch (e.g. 25-50 items at a time).
  // `viewport` mode keeps the legacy ~85%-viewport step for the SCROLL_DOWN
  // message used by the click/page-number loop.
  if (isPageRoot) {
    const before = window.scrollY;
    const viewport = window.innerHeight;
    const maxY = Math.max(0, document.documentElement.scrollHeight - viewport);
    const nextY = mode === 'toEnd'
      ? (direction === 'down' ? maxY : 0)
      : (direction === 'down'
          ? Math.min(before + Math.max(200, viewport * 0.85), maxY)
          : Math.max(before - Math.max(200, viewport * 0.85), 0));
    window.scrollTo({ top: nextY, left: 0, behavior: 'instant' as ScrollBehavior });
    return Math.abs(window.scrollY - before) > 1;
  }

  const before = target.scrollTop;
  const viewport = target.clientHeight;
  const maxY = Math.max(0, target.scrollHeight - viewport);
  const nextY = mode === 'toEnd'
    ? (direction === 'down' ? maxY : 0)
    : (direction === 'down'
        ? Math.min(before + Math.max(200, viewport * 0.85), maxY)
        : Math.max(before - Math.max(200, viewport * 0.85), 0));
  target.scrollTop = nextY;
  return Math.abs(target.scrollTop - before) > 1;
}

/**
 * Wait for either:
 *   - the list-item count to increase past `beforeCount`, OR
 *   - the target's scrollHeight to grow (new content added below)
 *
 * This is much more reliable than measuring body HTML length changes.
 */
function waitForMoreItems(
  target: HTMLElement,
  listSelector: string | null | undefined,
  beforeCount: number,
  beforeScrollHeight: number,
  timeoutMs: number
): Promise<{ changed: boolean; newCount: number; reason: 'items' | 'height' | 'timeout' }> {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const check = () => {
      const count = countListItems(listSelector);
      if (count > beforeCount) {
        resolve({ changed: true, newCount: count, reason: 'items' });
        return;
      }
      const sh =
        target === document.scrollingElement || target === document.documentElement
          ? document.documentElement.scrollHeight
          : target.scrollHeight;
      if (sh > beforeScrollHeight + 50) {
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
  });
}

/**
 * Perform one scroll step to try to load more items. Used by the
 * extraction orchestrator (one call per "page" of auto-scroll).
 *
 * Strategy:
 *   1. Locate the list's actual scroll container (window or inner).
 *   2. Record item count and scrollHeight before.
 *   3. Take a viewport-sized step in the requested direction.
 *   4. Wait up to `timeoutMs` for either new items or increased scrollHeight.
 *   5. Return true if anything changed (step, items, or height).
 *
 * Returns true if progress was made, false if we've reached the end.
 */
export async function scrollForMore(
  direction: 'down' | 'up' = 'down',
  listSelector?: string,
  timeoutMs = 6000
): Promise<boolean> {
  let anchor: Element | null = null;
  if (listSelector) {
    try {
      anchor = document.querySelector(listSelector);
    } catch {
      anchor = null;
    }
  }
  const target = findScrollRoot(anchor);

  const beforeCount = countListItems(listSelector);
  const beforeScrollHeight =
    target === document.scrollingElement || target === document.documentElement
      ? document.documentElement.scrollHeight
      : target.scrollHeight;

  const moved = stepScroll(target, direction);

  const { changed, newCount, reason } = await waitForMoreItems(
    target,
    listSelector,
    beforeCount,
    beforeScrollHeight,
    timeoutMs
  );

  console.log(
    '[Maxun] scrollForMore:',
    { direction, moved, beforeCount, newCount, reason, target: (target as HTMLElement).tagName + ((target as HTMLElement).className ? '.' + (target as HTMLElement).className.slice(0, 30) : '') }
  );

  return moved || changed;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Auto-Scroll (unlimited session) ───────────────────────────────────────────

/**
 * Detect a loading indicator anywhere near the list. Returns the first visible
 * candidate or `null`. Used to pause auto-scroll while the site is lazy-loading
 * the next batch.
 *
 * Heuristics (in priority order):
 *   1. `[aria-busy="true"]` inside or directly after the scroll root.
 *   2. Elements with `role="progressbar"` or `role="status"`.
 *   3. Class names containing `spinner`, `loader`, `loading`, `progress`.
 *   4. SVG / div siblings of the list with a running CSS animation.
 */
function detectLoadingIndicator(scrollRoot: HTMLElement | null): Element | null {
  const roots: Element[] = [];
  if (scrollRoot && scrollRoot !== document.scrollingElement && scrollRoot !== document.documentElement) {
    roots.push(scrollRoot);
    if (scrollRoot.parentElement) roots.push(scrollRoot.parentElement);
  }
  roots.push(document.body);

  const seen = new Set<Element>();
  const isVisible = (el: Element): boolean => {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    const style = getComputedStyle(el as HTMLElement);
    if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') return false;
    return true;
  };

  const classMatch = /\b(spinner|loader|loading|progress(bar)?|skeleton)\b/i;

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

    // Class-name candidates (cheap substring pre-filter to avoid scanning *).
    try {
      const classHits = Array.from(root.querySelectorAll<HTMLElement>('*'))
        .filter((el) => typeof el.className === 'string' && classMatch.test(el.className));
      candidates.push(...classHits);
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
}

/**
 * Wait up to `timeoutMs` for any loading indicator to disappear. If none is
 * visible at the time of the call, returns immediately. Useful right after a
 * scroll step to let the site's lazy-load finish.
 *
 * We poll very briefly for a spinner to *appear* (most sites render it in the
 * same tick as scroll); if one never shows up we return immediately so the
 * caller can fall back to height/item-count polling instead of eating a fixed
 * 1.5 s delay on every step.
 */
async function waitForLoadingToFinish(
  scrollRoot: HTMLElement | null,
  timeoutMs: number,
  appearWindowMs: number = 400
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let sawSpinner = !!detectLoadingIndicator(scrollRoot);
  if (!sawSpinner) {
    const appearDeadline = Date.now() + Math.min(appearWindowMs, timeoutMs);
    while (Date.now() < appearDeadline) {
      if (detectLoadingIndicator(scrollRoot)) { sawSpinner = true; break; }
      await delay(60);
    }
  }
  if (!sawSpinner) return false;

  while (Date.now() < deadline) {
    if (!detectLoadingIndicator(scrollRoot)) return true;
    await delay(120);
  }
  return false;
}

/**
 * Fingerprint a row for dedup. Mirrors the logic used by the background
 * orchestrator, so rows remain compatible if we ever migrate dedup there.
 */
function fingerprintRow(row: ExtractedRow): string {
  return JSON.stringify(Object.values(row).map((v) => (v || '').toLowerCase().trim()));
}

export interface AutoScrollProgress {
  step: number;
  itemsThisStep: number;
  newRows: number;
  totalRows: number;
  loading: boolean;
  endReached: boolean;
  done: boolean;
  rows?: ExtractedRow[];
  reason?: 'cancelled' | 'max-steps' | 'progress';
}

export interface AutoScrollOptions {
  listSelector: string;
  fields: Record<string, FieldConfig>;
  direction: 'down' | 'up';
  pageDelayMs: number;
  /** Optional safety cap. `0`, `undefined`, or negative = unlimited. */
  maxSteps?: number;
  onProgress: (p: AutoScrollProgress) => void;
  shouldCancel: () => boolean;
}

/**
 * Long-running auto-scroll session. Keeps scrolling + extracting until:
 *   - the caller cancels (Stop button), OR
 *   - `maxSteps` is reached (if provided).
 *
 * When the page appears to have run out of content ("end reached"), the loop
 * does NOT exit. It stays in an idle state, polling at `pageDelayMs` intervals
 * so late-loading items are captured. The user is the only thing that finalises
 * the session.
 */
export async function autoScrollAndExtract(options: AutoScrollOptions): Promise<void> {
  const {
    listSelector,
    fields,
    direction,
    pageDelayMs,
    maxSteps,
    onProgress,
    shouldCancel,
  } = options;

  const safetyCap = typeof maxSteps === 'number' && maxSteps > 0 ? maxSteps : Infinity;

  // Resolve the list's scroll container once — the list's anchor may unmount
  // in virtualized lists, so we only need it for container discovery.
  let anchor: Element | null = null;
  try {
    anchor = document.querySelector(listSelector);
  } catch { anchor = null; }
  const scrollRoot = findScrollRoot(anchor);
  const isPageRoot =
    scrollRoot === document.scrollingElement || scrollRoot === document.documentElement;

  console.log('[Maxun] autoScrollAndExtract: starting', {
    listSelector, direction, pageDelayMs, maxSteps,
    scrollRoot: isPageRoot ? 'window' : (scrollRoot.tagName + '.' + scrollRoot.className.slice(0, 40)),
  });

  const rows: ExtractedRow[] = [];
  const seen = new Set<string>();
  let step = 0;
  let consecutiveEmpty = 0;
  const EMPTY_LIMIT = 3;

  // Extract once up-front so the first progress payload has items even before
  // any scrolling has happened.
  const extractNow = (): { itemsThisStep: number; newRows: number } => {
    const pageRows = extractPageData(listSelector, fields, 0);
    let newCount = 0;
    for (const row of pageRows) {
      const fp = fingerprintRow(row);
      if (!seen.has(fp)) {
        seen.add(fp);
        rows.push(row);
        newCount++;
      }
    }
    return { itemsThisStep: pageRows.length, newRows: newCount };
  };

  const emit = (
    patch: Partial<AutoScrollProgress> & { loading: boolean; endReached: boolean; done: boolean }
  ) => {
    // Send a defensive copy of the accumulated rows on every tick so the side
    // panel can render the table incrementally rather than waiting for the
    // user to press Stop. Rows grow monotonically and are small JSON, so the
    // cost is negligible for typical list sizes.
    onProgress({
      step,
      itemsThisStep: patch.itemsThisStep ?? 0,
      newRows: patch.newRows ?? 0,
      totalRows: rows.length,
      loading: patch.loading,
      endReached: patch.endReached,
      done: patch.done,
      rows: rows.slice(),
      reason: patch.reason,
    });
  };

  const initial = extractNow();
  emit({
    itemsThisStep: initial.itemsThisStep,
    newRows: initial.newRows,
    loading: false,
    endReached: false,
    done: false,
  });

  while (!shouldCancel() && step < safetyCap) {
    step++;

    const beforeCount = countListItems(listSelector);
    const beforeHeight = isPageRoot
      ? document.documentElement.scrollHeight
      : scrollRoot.scrollHeight;

    // 1) Jump straight to the end of the currently-loaded content. Infinite-
    //    scroll sites react to proximity-to-bottom, so one jump loads one
    //    full batch (~25-50 items) instead of the many small steps a
    //    viewport-sized scroll would require.
    const moved = stepScroll(scrollRoot, direction, 'toEnd');

    // 2) Fast spinner check — only eats extra time if a loader actually
    //    appears within 300ms of scrolling. Otherwise we move straight to
    //    the growth poll.
    const spinnerBudget = Math.max(pageDelayMs * 3, 8000);
    await waitForLoadingToFinish(isPageRoot ? null : scrollRoot, spinnerBudget, 300);

    if (shouldCancel()) break;

    // 3) Wait for growth (new items or scrollHeight increase). This is the
    //    primary gate — as soon as it resolves we extract and loop again.
    const growth = await waitForMoreItems(
      scrollRoot,
      listSelector,
      beforeCount,
      beforeHeight,
      Math.max(800, pageDelayMs)
    );

    if (shouldCancel()) break;

    // 4) Extract + dedup.
    const { itemsThisStep, newRows } = extractNow();

    const spinnerStillVisible = !!detectLoadingIndicator(isPageRoot ? null : scrollRoot);

    const madeProgress = growth.changed || newRows > 0;
    if (madeProgress) consecutiveEmpty = 0;
    else consecutiveEmpty++;

    const endReached = consecutiveEmpty >= EMPTY_LIMIT && !spinnerStillVisible;

    emit({
      itemsThisStep,
      newRows,
      loading: spinnerStillVisible,
      endReached,
      done: false,
    });

    console.log('[Maxun] autoScroll step', {
      step, moved, beforeCount, growth,
      itemsThisStep, newRows, totalRows: rows.length,
      consecutiveEmpty, endReached, spinnerStillVisible,
    });

    // 5) Pacing.
    //    - Successful step → 0 delay, loop immediately (waitForMoreItems
    //      already resolved the moment new content arrived).
    //    - Empty step but not yet end-reached → short 250 ms breather so
    //      we don't hammer the CPU.
    //    - End reached → idle at a slower cadence to keep watching for
    //      late items without churning.
    const idleDelay = endReached
      ? Math.max(pageDelayMs * 2, 2500)
      : (madeProgress ? 0 : 250);
    if (idleDelay > 0) await delay(idleDelay);
  }

  const reason: AutoScrollProgress['reason'] = shouldCancel()
    ? 'cancelled'
    : (step >= safetyCap ? 'max-steps' : 'progress');

  emit({
    loading: false,
    endReached: true,
    done: true,
    reason,
  });

  console.log('[Maxun] autoScrollAndExtract: done', { reason, totalRows: rows.length, steps: step });
}
