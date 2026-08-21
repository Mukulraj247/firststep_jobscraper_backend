/**
 * Content Script Entry Point
 * Uses TWO-CLICK list selection (like Web Scraper.io, Octoparse, ParseHub).
 *
 * Flow:
 *   1. User clicks "Select List" in side panel → enters pick-first mode
 *   2. User hovers elements → single-element highlight, "Click first item" tooltip
 *   3. User clicks first item → marked in pink, mode switches to pick-second
 *   4. User hovers → "Click another similar item"
 *   5. User clicks second item → we compute the common selector pattern that
 *      matches both, find all matching elements, highlight them, auto-confirm.
 *
 * This is more reliable than single-click auto-detection because the user
 * explicitly demonstrates what a "list item" looks like with two examples.
 */

import { MSG } from '../shared/messages';
import { MAXUN_APPLY_BACKEND_URL, isAllowedWebOrigin } from '../shared/webBridge';
import {
  ensureOverlay, ensureBadge, showOverlay, showBadge, showTooltip, hideAll,
  cleanupOverlays, hideOverlay, showFirstPickOverlay, hideFirstPickOverlay,
} from './overlayUI';
import {
  highlightListGroup, highlightTables, markSelected, clearAll,
} from './highlighter';
import { autoDetectFields, fieldsToConfig } from './fieldAutoDetector';
import { extractPageData, clickPaginationButton, scrollForMore, autoScrollAndExtract } from './extractionRunner';
import type { AutoScrollProgress } from './extractionRunner';
import { clientListExtractor } from '../shared/clientListExtractor';
import { clientPaginationDetector } from '../shared/clientPaginationDetector';
import { clientSelectorGenerator } from '../shared/clientSelectorGenerator';
import { detectTables, extractTableData } from './tableDetector';
import { extractPageText } from './textExtractor';

// Guard against double-injection
if (!(window as any).__MAXUN_EXTENSION__) {
  (window as any).__MAXUN_EXTENSION__ = true;
  installWebBridgeListener();
  init();
}

/** Lets the Maxun web app (allowlisted origin) push API base URL into the extension. */
function installWebBridgeListener() {
  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== window) return;
    if (!isAllowedWebOrigin(event.origin)) return;
    const d = event.data as { type?: string; backendUrl?: string };
    if (d?.type === MAXUN_APPLY_BACKEND_URL && typeof d.backendUrl === 'string') {
      const u = d.backendUrl.trim().replace(/\/+$/, '');
      if (/^https?:\/\//i.test(u)) {
        chrome.runtime.sendMessage({
          type: MSG.APPLY_BACKEND_FROM_WEB,
          payload: { backendUrl: u },
        });
      }
    }
  });
}

type SelectionMode = 'idle' | 'pick-first' | 'pick-second' | 'list-selected' | 'table-select' | 'pick-selector';

function init() {
  let mode: SelectionMode = 'idle';
  let firstPick: HTMLElement | null = null;
  let firstPickSignature: string = ''; // CSS signature for re-finding after React re-renders
  let currentListSelector: string = '';
  let currentListElements: HTMLElement[] = [];

  // Auto-scroll session state (shared across messages for the lifetime of this tab)
  let autoScrollActive = false;
  let autoScrollCancelFlag = false;

  // ── Message Handler ──
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    handleMessage(message, sendResponse);
    return true;
  });

  function handleMessage(message: any, sendResponse: (response: any) => void) {
    switch (message.type) {
      case MSG.START_LIST_HOVER: {
        startListSelection();
        sendResponse({ ok: true });
        break;
      }

      case MSG.STOP_LIST_HOVER: {
        stopListMode();
        sendResponse({ ok: true });
        break;
      }

      case MSG.EXTRACT_PAGE: {
        const { listSelector, fields, limit } = message.payload || {};

        // Wait for job list to appear (max 6s) — handles SPAs that render content asynchronously
        const waitForContent = (): Promise<number> => {
          return new Promise((resolve) => {
            const deadline = Date.now() + 6000;
            const check = () => {
              const count = clientListExtractor.countListItems(document, listSelector);
              if (count > 0) { resolve(count); return; }
              if (Date.now() >= deadline) { resolve(0); return; }
              setTimeout(check, 500);
            };
            check();
          });
        };

        waitForContent().then((itemCount) => {
          if (itemCount > 0) {
            console.log(`[Maxun] Content loaded: ${itemCount} items found before extraction`);
          }
          const rows = extractPageData(listSelector, fields, limit);
          sendResponse({ ok: true, rows, count: rows.length });
        });
        break;
      }

      case MSG.CLICK_NEXT: {
        const { selector, hint, targetPage, listSelector } = message.payload || {};
        clickPaginationButton(selector, hint || 'next', targetPage, listSelector)
          .then((changed) => sendResponse({ ok: true, changed }));
        break;
      }

      case MSG.SCROLL_DOWN: {
        const { direction, listSelector, timeoutMs } = message.payload || {};
        const dir: 'down' | 'up' = direction === 'scrollUp' ? 'up' : 'down';
        scrollForMore(dir, listSelector, timeoutMs)
          .then((changed) => sendResponse({ ok: true, changed }));
        break;
      }

      case MSG.AUTOSCROLL_START: {
        if (autoScrollActive) {
          sendResponse({ ok: false, error: 'Auto-scroll already running' });
          break;
        }
        const { listSelector, fields, direction, pageDelayMs, maxSteps } = message.payload || {};
        if (!listSelector || !fields) {
          sendResponse({ ok: false, error: 'Missing listSelector or fields' });
          break;
        }
        autoScrollActive = true;
        autoScrollCancelFlag = false;

        // Acknowledge immediately so the background isn't blocked; progress is
        // streamed back via chrome.runtime.sendMessage(AUTOSCROLL_PROGRESS).
        sendResponse({ ok: true });

        autoScrollAndExtract({
          listSelector,
          fields,
          direction: direction === 'scrollUp' ? 'up' : 'down',
          pageDelayMs: typeof pageDelayMs === 'number' && pageDelayMs > 0 ? pageDelayMs : 1500,
          maxSteps: typeof maxSteps === 'number' && maxSteps > 0 ? maxSteps : undefined,
          shouldCancel: () => autoScrollCancelFlag,
          onProgress: (progress: AutoScrollProgress) => {
            try {
              chrome.runtime.sendMessage(
                { type: MSG.AUTOSCROLL_PROGRESS, payload: progress },
                () => {
                  // Swallow "Receiving end does not exist" when side panel is closed
                  void chrome.runtime.lastError;
                }
              );
            } catch {
              /* ignore */
            }
          },
        })
          .catch((err) => {
            console.error('[Maxun] autoScrollAndExtract threw:', err);
            try {
              chrome.runtime.sendMessage(
                {
                  type: MSG.AUTOSCROLL_PROGRESS,
                  payload: {
                    step: 0, itemsThisStep: 0, newRows: 0, totalRows: 0,
                    loading: false, endReached: true, done: true,
                    rows: [], reason: 'progress',
                    error: err instanceof Error ? err.message : String(err),
                  },
                },
                () => { void chrome.runtime.lastError; }
              );
            } catch { /* ignore */ }
          })
          .finally(() => {
            autoScrollActive = false;
            autoScrollCancelFlag = false;
          });
        break;
      }

      case MSG.AUTOSCROLL_STOP: {
        if (autoScrollActive) {
          autoScrollCancelFlag = true;
          sendResponse({ ok: true, stopping: true });
        } else {
          sendResponse({ ok: true, stopping: false });
        }
        break;
      }

      case MSG.GOTO_URL: {
        const { url } = message.payload || {};
        if (url && typeof url === 'string') {
          window.location.href = url;
          sendResponse({ ok: true });
        } else {
          sendResponse({ ok: false, error: 'Invalid URL' });
        }
        break;
      }

      case MSG.DETECT_TABLES: {
        const tables = detectTables(document);
        if (tables.length > 0) {
          const tableElements = tables.map((t) => document.querySelector(t.selector)).filter(Boolean) as Element[];
          highlightTables(tableElements);
          mode = 'table-select';
        }
        sendResponse({ ok: true, tables });
        break;
      }

      case MSG.EXTRACT_TABLE: {
        const { selector } = message.payload || {};
        const data = extractTableData(document, selector);
        sendResponse({ ok: true, ...data });
        break;
      }

      case MSG.EXTRACT_TEXT: {
        const { format } = message.payload || { format: 'plain' };
        const content = extractPageText(document, format);
        sendResponse({ ok: true, content });
        break;
      }

      case MSG.CLEAR_HIGHLIGHTS: {
        stopListMode();
        clearAll();
        cleanupOverlays();
        sendResponse({ ok: true });
        break;
      }

      case MSG.PICK_ELEMENT: {
        startElementPick((selector) => {
          sendResponse({ ok: true, selector });
        });
        break;
      }

      case MSG.PING: {
        sendResponse({ ok: true, alive: true });
        break;
      }

      case MSG.EXTRACTION_PROGRESS: {
        const { text, status } = message.payload || {};
        showProgressToast(text || '', status || 'running');
        sendResponse({ ok: true });
        break;
      }

      default: {
        sendResponse({ ok: false, error: `Unknown message: ${message.type}` });
      }
    }
  }

  // ── Selection flow ──

  function startListSelection() {
    mode = 'pick-first';
    firstPick = null;
    firstPickSignature = '';
    currentListSelector = '';
    currentListElements = [];

    ensureOverlay();
    ensureBadge();
    showBadge('Click the FIRST item in the list');

    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('click', onPickClick, true);
    // Hiring Cafe (and similar SPAs) select/open cards on mousedown before click.
    // Block those early events so the second pick is not stolen by the page.
    document.addEventListener('pointerdown', onPickSuppress, true);
    document.addEventListener('mousedown', onPickSuppress, true);
    document.addEventListener('mouseup', onPickSuppress, true);
  }

  function onPickSuppress(event: Event) {
    if (mode !== 'pick-first' && mode !== 'pick-second') return;
    const t = event.target;
    if (t instanceof Element && isOurElement(t)) return;
    // Do NOT preventDefault — that can suppress the subsequent click in Chromium.
    // Stopping propagation is enough to keep Hiring Cafe from selecting/opening cards.
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  function onMouseMove(event: MouseEvent) {
    if (mode !== 'pick-first' && mode !== 'pick-second') return;

    const mx = event.clientX;
    const my = event.clientY;
    const raw = document.elementFromPoint(mx, my) as HTMLElement | null;
    if (!raw || isOurElement(raw)) return;

    // Highlight the list-item card, not Save/Share/icon chrome inside it.
    const target = resolveListItemCandidate(raw);
    showOverlay(target.getBoundingClientRect());

    if (mode === 'pick-first') {
      showTooltip('Click the FIRST item in the list', mx, my);
    } else {
      showTooltip('Click ANOTHER similar item', mx, my);
    }
  }

  function onPickClick(event: MouseEvent) {
    if (mode !== 'pick-first' && mode !== 'pick-second') return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    // Use elementFromPoint to get the actual visible element (bypasses our
    // pointer-events:none overlays and gets what the user actually sees).
    const raw = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;

    console.log('[Maxun] Click raw target:', raw, 'mode:', mode);

    if (!raw || !(raw instanceof HTMLElement)) {
      console.log('[Maxun] Invalid click target');
      return;
    }
    if (isOurElement(raw)) {
      console.log('[Maxun] Ignoring click on extension UI');
      return;
    }
    if (!document.body.contains(raw)) {
      console.log('[Maxun] Target not in document');
      return;
    }

    const target = resolveListItemCandidate(raw);
    console.log('[Maxun] Resolved list item:', target);

    if (mode === 'pick-first') {
      firstPick = target;
      // Store a CSS signature for re-finding the first pick if React re-renders it.
      firstPickSignature = buildQuickSelector(target);
      // Use overlay to highlight WITHOUT mutating the target class
      // (mutating className triggers React re-renders that detach the node).
      showFirstPickOverlay(target.getBoundingClientRect());
      mode = 'pick-second';
      showBadge('Click ANOTHER item of the same type');
      console.log('[Maxun] First pick:', target);
      console.log('[Maxun] First pick signature:', firstPickSignature);
      return;
    }

    // mode === 'pick-second'
    const secondPick = target;
    console.log('[Maxun] Second pick:', secondPick);

    // Re-find the first pick using the stored signature, in case React re-rendered.
    // Do NOT re-run resolveListItemCandidate on a still-live first pick — that can
    // climb to a different ancestor than the one the user actually selected.
    let liveFirstPick: HTMLElement | null = null;
    if (firstPick && document.body.contains(firstPick)) {
      liveFirstPick = firstPick;
      console.log('[Maxun] First pick still live');
    } else if (firstPickSignature) {
      try {
        const candidates = Array.from(
          document.querySelectorAll(firstPickSignature)
        ) as HTMLElement[];
        // Never fall back to a candidate that contains the second pick —
        // that made "Pick a DIFFERENT item" stick forever on Hiring Cafe.
        liveFirstPick =
          candidates.find(
            (c) => c !== secondPick && !c.contains(secondPick) && !secondPick.contains(c)
          ) || null;
        if (liveFirstPick) {
          liveFirstPick = resolveListItemCandidate(liveFirstPick);
        }
        console.log(
          '[Maxun] Re-found first pick via signature:', firstPickSignature,
          '→ candidates:', candidates.length, 'picked:', liveFirstPick
        );
      } catch (err) {
        console.warn('[Maxun] Failed to re-find first pick:', err);
      }
    }

    if (!liveFirstPick) {
      showTooltip('Lost track of first item. Please restart and try again.', event.clientX, event.clientY);
      return;
    }

    // Don't allow picking the same element twice
    if (liveFirstPick === secondPick || liveFirstPick.contains(secondPick) || secondPick.contains(liveFirstPick)) {
      showTooltip('Pick a DIFFERENT item than the first', event.clientX, event.clientY);
      return;
    }

    // Compute the selector pattern that matches both
    const { selector, elements } = computeCommonListSelector(liveFirstPick, secondPick);

    if (!selector || elements.length < 2) {
      showTooltip('Could not find a common pattern. Try different items.', event.clientX, event.clientY);
      return;
    }

    // Show the final list
    currentListSelector = selector;
    currentListElements = elements;

    hideFirstPickOverlay();
    highlightListGroup(elements);
    hideOverlay();
    showTooltip(`List with ${elements.length} items selected`, event.clientX, event.clientY);

    mode = 'list-selected';
    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('click', onPickClick, true);
    document.removeEventListener('pointerdown', onPickSuppress, true);
    document.removeEventListener('mousedown', onPickSuppress, true);
    document.removeEventListener('mouseup', onPickSuppress, true);

    // Auto-detect fields
    const detectedFields = autoDetectFields(document, selector);
    const fieldConfig = fieldsToConfig(detectedFields);

    // Extract preview rows
    const previewRows = extractPageData(selector, fieldConfig, 5);

    const previewText = (elements[0]?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120);

    // Auto-detect Load More / Next so Oracle-style boards paginate without manual setup
    let pagination: {
      type: string;
      selector: string | null;
      confidence: string;
      maxPages: number;
      pageDelayMs: number;
    } | null = null;
    try {
      const detected = clientPaginationDetector.autoDetectPagination(
        document,
        selector,
        clientSelectorGenerator
      );
      if (detected.type && detected.selector) {
        pagination = {
          type: detected.type,
          selector: detected.selector,
          confidence: detected.confidence || 'medium',
          maxPages: 2,
          pageDelayMs: detected.type === 'clickLoadMore' ? 2000 : 1500,
        };
        console.log('[Maxun] Auto-detected pagination:', pagination);
      }
    } catch (err) {
      console.warn('[Maxun] Pagination auto-detect failed:', err);
    }

    chrome.runtime.sendMessage({
      type: MSG.LIST_SELECTED,
      payload: {
        listSelector: selector,
        itemCount: elements.length,
        fields: fieldConfig,
        previewRows,
        previewText,
        previewUrl: window.location.href,
        ...(pagination ? { pagination } : {}),
      },
    });
  }

  function stopListMode() {
    mode = 'idle';
    firstPick = null;
    firstPickSignature = '';
    currentListSelector = '';
    currentListElements = [];
    hideAll();
    hideFirstPickOverlay();
    clearAll();
    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('click', onPickClick, true);
    document.removeEventListener('pointerdown', onPickSuppress, true);
    document.removeEventListener('mousedown', onPickSuppress, true);
    document.removeEventListener('mouseup', onPickSuppress, true);
  }

  /**
   * Enter single-element pick mode for selectors (e.g. next button, pagination button).
   * User clicks an element, we return its CSS selector.
   */
  function startElementPick(onPicked: (selector: string) => void) {
    mode = 'pick-selector';
    ensureOverlay();
    ensureBadge();
    showBadge('Click the element — I will return its selector');

    const onHover = (event: MouseEvent) => {
      if (mode !== 'pick-selector') return;
      const target = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
      if (!target || isOurElement(target)) return;
      showOverlay(target.getBoundingClientRect());
    };

    const onClick = (event: MouseEvent) => {
      if (mode !== 'pick-selector') return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      const target = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
      if (!target || isOurElement(target)) return;

      // Walk up to the nearest clickable ancestor (button, anchor, role=button),
      // then build a selector that's specific enough to disambiguate Next from
      // Previous/page-number siblings that share the same class.
      const clickable = findClickableAncestor(target) || target;
      const selector = buildPaginationAwareSelector(clickable);

      mode = 'idle';
      showOverlay(target.getBoundingClientRect());
      showTooltip(`Selector: ${selector.slice(0, 60)}${selector.length > 60 ? '…' : ''}`, event.clientX, event.clientY);

      hideAll();
      cleanupOverlays();
      document.removeEventListener('mousemove', onHover, true);
      document.removeEventListener('click', onClick, true);

      onPicked(selector);
    };

    document.addEventListener('mousemove', onHover, true);
    document.addEventListener('click', onClick, true);
  }

  function isOurElement(element: Element): boolean {
    return !!(
      (element as HTMLElement).id?.startsWith('__maxun_') ||
      element.closest('[id^="__maxun_"]')
    );
  }
}

/**
 * Promote a click/hover target up to the list-item "card" when the user hits
 * nested chrome (Save, Share, icons, titles). Without this, Hiring Cafe second
 * picks often land on Save/Share and fail containment / common-pattern checks.
 *
 * Important: many list cards ARE the `<a>` (or a heading/`li`). Never climb out
 * of an already card-sized node — that made the overlay jump to a different
 * item and caused bare-tag selectors to match the whole page.
 */
function isCardSizedRect(rect: DOMRectReadOnly): boolean {
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;
  return (
    rect.width >= 160 &&
    rect.height >= 72 &&
    rect.width < viewportW * 0.95 &&
    rect.height < viewportH * 0.85
  );
}

function resolveListItemCandidate(el: HTMLElement): HTMLElement {
  // Pure chrome — always climb. `<a>` is handled separately (cards are often links).
  const INTERACTIVE = new Set([
    'BUTTON', 'SVG', 'PATH', 'INPUT', 'SELECT', 'TEXTAREA', 'IMG', 'USE',
  ]);
  const INLINE = new Set([
    'SPAN', 'STRONG', 'EM', 'B', 'I', 'LABEL', 'TIME', 'SMALL',
  ]);
  // Title / list-text nodes: climb only while they are NOT card-sized.
  const TEXTUAL = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI']);

  let cur: HTMLElement | null = el;

  // Climb out of icons / buttons / tiny inline text — stop at card-sized nodes.
  while (cur && cur.parentElement && cur !== document.body) {
    if (isCardSizedRect(cur.getBoundingClientRect())) {
      break;
    }

    const svg = (cur as Element).closest('svg');
    if (svg?.parentElement) {
      cur = svg.parentElement as HTMLElement;
      continue;
    }

    if (cur.tagName === 'A') {
      // Tiny action links (Save/Share) → climb. Card-sized anchors → keep.
      cur = cur.parentElement;
      continue;
    }

    if (INTERACTIVE.has(cur.tagName) || INLINE.has(cur.tagName)) {
      cur = cur.parentElement;
      continue;
    }

    if (TEXTUAL.has(cur.tagName)) {
      cur = cur.parentElement;
      continue;
    }

    const role = cur.getAttribute('role');
    if (role === 'button' || role === 'link' || role === 'img') {
      cur = cur.parentElement;
      continue;
    }
    break;
  }

  if (!cur || cur === document.body || cur === document.documentElement) {
    return el;
  }

  let best = cur;
  let walk: HTMLElement | null = cur;

  for (let i = 0; i < 14 && walk && walk !== document.body; i++) {
    const rect = walk.getBoundingClientRect();

    if (isCardSizedRect(rect)) {
      best = walk;
      const parent = walk.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(
          (c): c is HTMLElement => c instanceof HTMLElement
        );
        const similar = siblings.filter((s) => {
          if (s === walk) return true;
          const r = s.getBoundingClientRect();
          if (r.width < 120 || r.height < 60) return false;
          const widthRatio =
            Math.abs(r.width - rect.width) / Math.max(rect.width, r.width);
          return widthRatio < 0.35;
        });
        // Parent has multiple card-sized children → this is the list-item level.
        if (similar.length >= 2) {
          return walk;
        }
      }
    }
    walk = walk.parentElement;
  }

  return best;
}

// ── On-page progress toast ──

let progressToast: HTMLDivElement | null = null;
let progressToastTimer: number | null = null;

function showProgressToast(text: string, status: 'running' | 'done' | 'error') {
  if (!progressToast || !document.documentElement.contains(progressToast)) {
    progressToast = document.createElement('div');
    progressToast.id = '__maxun_progress_toast';
    Object.assign(progressToast.style, {
      position: 'fixed',
      top: '16px',
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: '2147483647',
      background: 'linear-gradient(135deg, #1f2937 0%, #0f172a 100%)',
      color: '#fff',
      padding: '10px 18px',
      borderRadius: '10px',
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      fontSize: '13px',
      fontWeight: '600',
      boxShadow: '0 10px 25px rgba(0,0,0,0.35), 0 0 0 1px rgba(255,255,255,0.08)',
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      pointerEvents: 'none',
      transition: 'opacity 0.25s ease, transform 0.25s ease',
    });
    document.documentElement.appendChild(progressToast);
  }

  const spinner = status === 'running' ? `
    <span aria-hidden="true" style="
      display:inline-block;width:14px;height:14px;
      border:2px solid rgba(255,255,255,0.25);
      border-top-color:#ff00c3;
      border-radius:50%;
      animation:__maxun_spin 0.8s linear infinite;
    "></span>` : (status === 'done'
      ? '<span style="color:#4ade80;font-size:16px;">✓</span>'
      : '<span style="color:#f87171;font-size:16px;">⚠</span>');

  if (!document.getElementById('__maxun_spin_kf')) {
    const style = document.createElement('style');
    style.id = '__maxun_spin_kf';
    style.textContent = '@keyframes __maxun_spin { to { transform: rotate(360deg); } }';
    document.documentElement.appendChild(style);
  }

  progressToast.innerHTML = `${spinner}<span>${escapeHtml(text)}</span>`;
  progressToast.style.opacity = '1';

  if (progressToastTimer) { window.clearTimeout(progressToastTimer); progressToastTimer = null; }
  if (status !== 'running') {
    progressToastTimer = window.setTimeout(() => {
      if (progressToast) {
        progressToast.style.opacity = '0';
        window.setTimeout(() => progressToast?.remove(), 300);
        progressToast = null;
      }
    }, 4000);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));
}

// ── Two-click common selector algorithm ──

/**
 * Given two example elements that the user clicked, compute the CSS selector
 * that matches ALL similar items in the list.
 *
 * New strategy (works even when clicks land on different nested elements):
 *   1. Find the lowest common ancestor (LCA) of the two clicks.
 *   2. Walk each click UP to the DIRECT CHILD of the LCA that contains it.
 *      These are the two "item roots". They should have the same tag and
 *      similar structure - this is the "card level".
 *   3. Compute a CSS selector that matches both item roots:
 *      - If both have the same stable class → `tag.class`
 *      - Otherwise just `tag` under the LCA → catches all siblings
 *   4. Query `LCA > selector` to find all matching items.
 *   5. If that yields too few items, walk UP the LCA one level and try again
 *      (handles the "grid > row > card" case where cards span multiple rows).
 */
function computeCommonListSelector(
  el1: HTMLElement,
  el2: HTMLElement
): { selector: string; elements: HTMLElement[] } {
  const debug = (msg: string, ...rest: unknown[]) => console.log('[Maxun]', msg, ...rest);

  debug('computeCommonListSelector input:', { el1, el2 });
  debug('el1 path:', elementPath(el1));
  debug('el2 path:', elementPath(el2));

  // Step 1: Find LCA
  let lca = findLowestCommonAncestor(el1, el2);
  if (!lca) {
    debug('No LCA found - el1 parents:', listParents(el1));
    debug('No LCA found - el2 parents:', listParents(el2));
    return { selector: '', elements: [] };
  }
  debug('LCA:', lca);

  // Step 2: Walk each click up to the direct child of LCA
  let item1 = walkUpToChildOf(el1, lca);
  let item2 = walkUpToChildOf(el2, lca);

  if (!item1 || !item2) {
    debug('Could not find item roots');
    return { selector: '', elements: [] };
  }
  debug('Item roots:', { item1, item2 });

  // Step 3: Try to build a selector that matches both items
  let result = tryBuildSelector(lca, item1, item2);
  if (result.elements.length >= 2) {
    debug('Found with initial LCA:', result.elements.length, 'items');
    return result;
  }

  // Step 4: Walk LCA up and retry - handles the grid > row > card case
  // where item1/item2 are different "rows" but we actually want "cards" which
  // are 2 levels deeper.
  for (let climb = 0; climb < 4; climb++) {
    const parentEl: HTMLElement | null = lca.parentElement;
    if (!parentEl) break;
    lca = parentEl;

    const next1 = walkUpToChildOf(el1, parentEl);
    const next2 = walkUpToChildOf(el2, parentEl);
    if (!next1 || !next2) continue;

    result = tryBuildSelector(parentEl, next1, next2);
    if (result.elements.length >= 2) {
      debug('Found after climbing LCA:', result.elements.length, 'items');
      return result;
    }
  }

  debug('All attempts failed');
  return { selector: '', elements: [] };
}

/**
 * Walk up from `el` until we find an ancestor whose parent is `lca`.
 * Returns that ancestor (the "item root" at the LCA level).
 */
function walkUpToChildOf(el: HTMLElement, lca: HTMLElement): HTMLElement | null {
  if (el === lca) return null;
  let cur: HTMLElement | null = el;
  while (cur && cur.parentElement !== lca) {
    cur = cur.parentElement;
    if (!cur) return null;
  }
  return cur;
}

/**
 * Build a selector from `item1` and `item2` that matches both and as many
 * siblings as possible. Queries under the LCA.
 */
function tryBuildSelector(
  lca: HTMLElement,
  item1: HTMLElement,
  item2: HTMLElement
): { selector: string; elements: HTMLElement[] } {
  // Case A: Same tag? Try tag + shared classes
  if (item1.tagName === item2.tagName) {
    const tag = item1.tagName.toLowerCase();
    const classes1 = Array.from(item1.classList).filter(isStableClass);
    const classes2 = Array.from(item2.classList).filter(isStableClass);
    const sharedClasses = classes1.filter((c) => classes2.includes(c));

    // Classed selectors first. Bare tag is last-resort and must not expand to
    // every descendant (that selected the whole page when LCA was too high).
    const candidates: string[] = [];
    if (sharedClasses.length > 0) {
      candidates.push(`${tag}.${sharedClasses.slice(0, 3).map(cssEscape).join('.')}`);
      candidates.push(`${tag}.${cssEscape(sharedClasses[0])}`);
    }
    candidates.push(tag);

    for (const rel of candidates) {
      const isBareTag = rel === tag;
      const elements = queryChildren(lca, rel);
      if (elements.length >= 2 && elements.includes(item1) && elements.includes(item2)) {
        // Bare tag: keep direct children only — never queryAll(div) under LCA.
        if (isBareTag) {
          const similarKids = elements.filter(
            (m) => m === item1 || m === item2 || hasSimilarStructure(m, item1)
          );
          if (similarKids.includes(item1) && similarKids.includes(item2) && similarKids.length >= 2) {
            return {
              selector: buildAbsoluteChildSelector(lca, rel),
              elements: similarKids,
            };
          }
          continue;
        }

        // Classed: allow descendant search, but reject absurd over-matches.
        const allMatches = queryAll(lca, rel);
        const filtered = allMatches.filter(
          (m) =>
            m === item1 ||
            m === item2 ||
            hasSimilarStructure(m, item1)
        );
        if (
          filtered.length >= 2 &&
          filtered.includes(item1) &&
          filtered.includes(item2) &&
          filtered.length <= Math.max(elements.length * 4, 80)
        ) {
          return {
            selector: buildAbsoluteChildSelector(lca, rel),
            elements: filtered,
          };
        }
        return {
          selector: buildAbsoluteChildSelector(lca, rel),
          elements,
        };
      }
    }
  }

  return { selector: '', elements: [] };
}

/**
 * Check if two elements have similar structure (same tag, similar child count).
 */
function hasSimilarStructure(a: HTMLElement, b: HTMLElement): boolean {
  if (a.tagName !== b.tagName) return false;
  const diff = Math.abs(a.children.length - b.children.length);
  if (diff > Math.max(3, b.children.length * 0.5)) return false;

  const rectA = a.getBoundingClientRect();
  const rectB = b.getBoundingClientRect();
  if (rectA.width > 0 && rectB.width > 0) {
    const widthRatio = Math.abs(rectA.width - rectB.width) / Math.max(rectA.width, rectB.width);
    if (widthRatio > 0.3) return false;
  }

  return true;
}

/**
 * Query direct children of `parent` matching the tail selector.
 * (:scope > selector)
 */
function queryChildren(parent: HTMLElement, selector: string): HTMLElement[] {
  try {
    return Array.from(parent.querySelectorAll(`:scope > ${selector}`)) as HTMLElement[];
  } catch {
    return [];
  }
}

/**
 * Query all descendants of `parent` matching the selector.
 */
function queryAll(parent: HTMLElement, selector: string): HTMLElement[] {
  try {
    return Array.from(parent.querySelectorAll(selector)) as HTMLElement[];
  } catch {
    return [];
  }
}

function buildAbsoluteChildSelector(lca: HTMLElement, relSelector: string): string {
  const lcaSelector = buildElementSelector(lca);
  // Build path from body down to LCA
  const path: string[] = [];
  let cur: HTMLElement | null = lca;
  while (cur && cur !== document.body && cur !== document.documentElement) {
    path.unshift(buildElementSelector(cur));
    cur = cur.parentElement;
  }
  const fullPath = path.join(' > ');
  return fullPath ? `${fullPath} > ${relSelector}` : `${lcaSelector} > ${relSelector}`;
}

function findLowestCommonAncestor(a: HTMLElement, b: HTMLElement): HTMLElement | null {
  const ancestors = new Set<Element>();
  let cur: Element | null = a;
  while (cur) {
    ancestors.add(cur);
    cur = cur.parentElement;
  }
  cur = b;
  while (cur) {
    if (ancestors.has(cur)) return cur as HTMLElement;
    cur = cur.parentElement;
  }
  return null;
}

function elementPath(el: HTMLElement): string {
  const parts: string[] = [];
  let cur: Element | null = el;
  let depth = 0;
  while (cur && depth < 10) {
    const tag = cur.tagName.toLowerCase();
    const id = cur.id ? `#${cur.id}` : '';
    const cls = cur.classList.length > 0 ? `.${Array.from(cur.classList).slice(0, 2).join('.')}` : '';
    parts.unshift(`${tag}${id}${cls}`);
    cur = cur.parentElement;
    depth++;
  }
  return parts.join(' > ');
}

function listParents(el: HTMLElement): string[] {
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur) {
    parts.push(cur.tagName.toLowerCase() + (cur.id ? '#' + cur.id : ''));
    cur = cur.parentElement;
  }
  return parts;
}

function buildElementSelector(el: HTMLElement): string {
  if (el.id && isStableId(el.id)) return `${el.tagName.toLowerCase()}#${cssEscape(el.id)}`;

  const classes = Array.from(el.classList).filter(isStableClass);
  if (classes.length > 0) {
    return `${el.tagName.toLowerCase()}.${classes.slice(0, 2).map(cssEscape).join('.')}`;
  }

  // Positional
  let index = 1;
  let sib = el.previousElementSibling;
  while (sib) {
    if (sib.tagName === el.tagName) index++;
    sib = sib.previousElementSibling;
  }
  return `${el.tagName.toLowerCase()}:nth-of-type(${index})`;
}

function isStableClass(className: string): boolean {
  return !!className &&
    className.length < 40 &&
    !/^\d/.test(className) &&
    !/\d{4,}/.test(className) &&
    !/active|selected|hover|focus|open|close|show|hide|is-/i.test(className) &&
    !/^[a-z]+-[a-f0-9]{5,}$/i.test(className) && // hashed classes like "css-1dbjc4n"
    !/[A-Fa-f0-9]{8,}/.test(className);
}

function isStableId(id: string): boolean {
  return !!id && id.length < 40 && !/\d{3,}/.test(id) && !/[A-Fa-f0-9]{8,}/.test(id);
}

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(value);
  return value.replace(/([ #;?%&,.+*~':"!^$[\]()=>|/@])/g, '\\$1');
}

/**
 * Build a CSS selector signature from an element that can be used to re-find
 * an equivalent element if this one gets detached from the DOM (React re-render).
 * Uses tag + stable class list.
 */
/**
 * Walk up to find the nearest clickable ancestor (a, button, [role=button], etc.).
 * Users often click an SVG or inner span of a pagination button, and we want to
 * return a selector for the actual clickable element, not the icon.
 */
function findClickableAncestor(el: HTMLElement): HTMLElement | null {
  const CLICKABLE = new Set(['a', 'button', 'input']);
  let cur: HTMLElement | null = el;
  for (let i = 0; i < 8 && cur; i++) {
    const tag = cur.tagName.toLowerCase();
    if (CLICKABLE.has(tag)) return cur;
    const role = cur.getAttribute('role');
    if (role === 'button' || role === 'link' || role === 'menuitem') return cur;
    cur = cur.parentElement;
  }
  return null;
}

/**
 * Build a selector tuned for picking pagination-style controls. Prefers
 * attributes that disambiguate siblings with identical classes (Previous / 1 /
 * 2 / … / Next all share `a.page-link`):
 *
 *   1. stable id
 *   2. rel="next" / rel="prev"
 *   3. aria-label (exact match)
 *   4. data-testid / data-action / data-page
 *   5. tag + stable class + :has(text) pseudo-class is not reliable, so we fall
 *      back to tag + class. The click runner then disambiguates further using
 *      text / aria-label / rel on the JS side.
 */
function buildPaginationAwareSelector(el: HTMLElement): string {
  const tag = el.tagName.toLowerCase();

  if (el.id && isStableId(el.id)) return `${tag}#${cssEscape(el.id)}`;

  const rel = el.getAttribute('rel');
  if (rel && /^(next|prev|previous)$/i.test(rel)) {
    return `${tag}[rel="${rel.toLowerCase()}"]`;
  }

  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel && ariaLabel.trim().length < 40) {
    return `${tag}[aria-label="${ariaLabel.replace(/"/g, '\\"')}"]`;
  }

  for (const attr of ['data-testid', 'data-test', 'data-action', 'data-role']) {
    const v = el.getAttribute(attr);
    if (v && v.length < 40) return `${tag}[${attr}="${v.replace(/"/g, '\\"')}"]`;
  }

  return buildElementSelector(el);
}

function buildQuickSelector(el: HTMLElement): string {
  const tag = el.tagName.toLowerCase();
  const classes = Array.from(el.classList)
    .filter((c) => !c.startsWith('__maxun_'))
    .slice(0, 6); // cap at 6 classes for safety

  if (classes.length === 0) {
    // No classes - use ID or nth-of-type as fallback
    if (el.id) return `${tag}#${cssEscape(el.id)}`;
    return tag;
  }

  return `${tag}.${classes.map(cssEscape).join('.')}`;
}
