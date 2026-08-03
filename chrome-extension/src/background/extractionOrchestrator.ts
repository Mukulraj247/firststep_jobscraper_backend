/**
 * Extraction Orchestrator - Coordinates multi-page extraction.
 * Manages the extraction loop: extract -> paginate -> extract -> ...
 */

import { MSG } from '../shared/messages';
import { updateListState, storeExtractedData } from './stateManager';
import type { FieldConfig, ExtractedRow, PaginationConfig } from '../shared/types';

interface ExtractionSession {
  tabId: number;
  listSelector: string;
  fields: Record<string, FieldConfig>;
  pagination: PaginationConfig;
  allRows: ExtractedRow[];
  seenFingerprints: Set<string>;
  currentPage: number;
  maxPages: number;
  status: 'running' | 'paused' | 'done' | 'cancelled';
  pageUrl: string;
  /** Counts consecutive iterations that produced no new rows. Used only for
   *  scroll pagination to tolerate transient empty scroll steps (late loads). */
  emptyStreak: number;
  /** True when the active session is running in long-lived auto-scroll mode
   *  (pagination.type === 'scrollDown' | 'scrollUp'). */
  autoScroll: boolean;
  /** Auto-scroll: number of scroll steps reported by the content script so far. */
  scrollSteps: number;
  /** Auto-scroll: whether end-of-page has been reported. */
  scrollEndReached: boolean;
}

/** Max consecutive empty scroll steps tolerated before we conclude there's no more data. */
const SCROLL_EMPTY_STREAK_LIMIT = 3;

let activeSession: ExtractionSession | null = null;

/**
 * Start a new extraction session.
 */
export async function startExtraction(
  tabId: number,
  listSelector: string,
  fields: Record<string, FieldConfig>,
  pagination: PaginationConfig,
  pageUrl: string
): Promise<void> {
  const isAutoScroll =
    pagination.type === 'scrollDown' || pagination.type === 'scrollUp';

  activeSession = {
    tabId,
    listSelector,
    fields,
    pagination,
    allRows: [],
    seenFingerprints: new Set(),
    currentPage: 1,
    maxPages: pagination.maxPages || 10,
    status: 'running',
    pageUrl,
    emptyStreak: 0,
    autoScroll: isAutoScroll,
    scrollSteps: 0,
    scrollEndReached: false,
  };

  if (isAutoScroll) {
    await startAutoScrollSession();
    return;
  }

  await updateListState({
    phase: 'extracting',
    currentPage: 1,
    maxPages: activeSession.maxPages,
    extractedRows: [],
    progressMessage: `Starting extraction — up to ${activeSession.maxPages} pages…`,
  });

  await sendOverlayToast(tabId, `Scout-X: Starting extraction — up to ${activeSession.maxPages} pages…`, 'running');

  try {
    await extractionLoop();
  } catch (error) {
    console.error('Extraction error:', error);
    if (activeSession) {
      activeSession.status = 'done';
      await finalizeExtraction();
    }
  }
}

/**
 * Kick off a long-running auto-scroll session in the content script. Unlike the
 * page-loop model, this returns control to the side panel immediately and then
 * progress streams back via `AUTOSCROLL_PROGRESS` → `onAutoScrollProgress`.
 *
 * Max pages is repurposed as an optional "max scroll steps" safety cap: a
 * value of 0 (the panel's default) means unlimited.
 */
async function startAutoScrollSession(): Promise<void> {
  if (!activeSession) return;

  const { tabId, listSelector, fields, pagination } = activeSession;
  const maxSteps = pagination.maxPages && pagination.maxPages > 0 ? pagination.maxPages : 0;

  await updateListState({
    phase: 'extracting',
    currentPage: 1,
    maxPages: maxSteps,
    extractedRows: [],
    scrollSteps: 0,
    scrollEndReached: false,
    scrollLoading: false,
    progressMessage: maxSteps
      ? `Auto-scroll starting (safety cap: ${maxSteps} steps)…`
      : 'Auto-scroll starting — press Stop to finish.',
  });

  await sendOverlayToast(
    tabId,
    'Scout-X: Auto-scroll started — press Stop in the side panel to finish.',
    'running'
  );

  chrome.tabs.sendMessage(
    tabId,
    {
      type: MSG.AUTOSCROLL_START,
      payload: {
        listSelector,
        fields,
        direction: pagination.type, // 'scrollDown' | 'scrollUp'
        pageDelayMs: pagination.pageDelayMs || 1500,
        maxSteps: maxSteps || undefined,
      },
    },
    () => {
      if (chrome.runtime.lastError) {
        console.warn(
          '[Maxun] AUTOSCROLL_START failed to reach content script:',
          chrome.runtime.lastError.message
        );
      }
    }
  );
}

/**
 * Handle an `AUTOSCROLL_PROGRESS` message from the content script. Merges new
 * rows, pushes a progress message to the side panel, and finalises when the
 * content script signals `done`.
 */
export async function onAutoScrollProgress(
  payload: {
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
): Promise<void> {
  if (!activeSession || !activeSession.autoScroll) return;

  // Merge any rows sent in this update. The content script streams a
  // monotonically-growing row list on every tick; dedup ensures we only push
  // genuinely new items here.
  if (payload.rows && payload.rows.length > 0) {
    const fresh = deduplicateRows(payload.rows);
    if (fresh.length > 0) activeSession.allRows.push(...fresh);
  }

  activeSession.scrollSteps = payload.step;
  activeSession.scrollEndReached = payload.endReached;

  const totalRows = Math.max(payload.totalRows, activeSession.allRows.length);

  let statusLine: string;
  if (payload.done) {
    statusLine = payload.reason === 'cancelled'
      ? `Stopped — ${totalRows} items collected across ${payload.step} scroll steps.`
      : payload.reason === 'max-steps'
        ? `Reached safety cap (${payload.step} steps) — ${totalRows} items collected.`
        : `Auto-scroll finished — ${totalRows} items collected.`;
  } else if (payload.loading) {
    statusLine = `Loading more… (step ${payload.step}, ${totalRows} items)`;
  } else if (payload.endReached) {
    statusLine = `End of page reached — press Stop to finish. (${totalRows} items, step ${payload.step})`;
  } else {
    statusLine = `Scrolling… step ${payload.step}, ${totalRows} items collected`;
  }

  await updateListState({
    currentPage: payload.step,
    extractedRows: activeSession.allRows,
    scrollSteps: payload.step,
    scrollEndReached: payload.endReached,
    scrollLoading: payload.loading,
    progressMessage: statusLine,
  });

  await sendOverlayToast(
    activeSession.tabId,
    `Scout-X: ${statusLine}`,
    payload.done ? 'done' : 'running'
  );

  if (payload.done) {
    activeSession.status = payload.reason === 'cancelled' ? 'cancelled' : 'done';
    // If the content script attached rows, they've already been merged above.
    // If it didn't (e.g. the extraction runner sent `done` with no rows due to
    // an error), we still finalise with whatever we've got.
    await finalizeExtraction();
  }
}

/**
 * Cancel the current extraction. For click/url-pattern modes we simply flip
 * the status flag and the loop exits on the next iteration. For auto-scroll
 * modes we additionally notify the content script so it can exit its own loop
 * and send back a final `done: true` payload.
 */
export function cancelExtraction(): void {
  if (!activeSession) return;
  activeSession.status = 'cancelled';

  if (activeSession.autoScroll) {
    const { tabId } = activeSession;
    try {
      chrome.tabs.sendMessage(tabId, { type: MSG.AUTOSCROLL_STOP }, () => {
        if (chrome.runtime.lastError) {
          console.warn(
            '[Maxun] AUTOSCROLL_STOP failed — finalising locally:',
            chrome.runtime.lastError.message
          );
          // Content script is unreachable (tab closed, navigated, etc.).
          // Finalise with whatever rows we have.
          void finalizeExtraction();
        }
      });
    } catch (err) {
      console.warn('[Maxun] AUTOSCROLL_STOP threw — finalising locally:', err);
      void finalizeExtraction();
    }
  }
}

/**
 * Get current extraction status.
 */
export function getExtractionStatus() {
  if (!activeSession) return null;
  return {
    currentPage: activeSession.currentPage,
    maxPages: activeSession.maxPages,
    totalRows: activeSession.allRows.length,
    status: activeSession.status,
  };
}

// ── Internal ──

async function extractionLoop(): Promise<void> {
  if (!activeSession || activeSession.status !== 'running') return;

  const pageNum = activeSession.currentPage;
  const totalPages = activeSession.maxPages;

  await updateListState({
    currentPage: pageNum,
    maxPages: totalPages,
    progressMessage: `Extracting page ${pageNum} of ${totalPages}…`,
  });
  await sendOverlayToast(
    activeSession.tabId,
    `Scout-X: Extracting page ${pageNum} of ${totalPages}…`,
    'running'
  );

  // Extract current page
  const pageRows = await extractCurrentPage();
  const newRows = deduplicateRows(pageRows);

  console.log(`[Maxun] Page ${pageNum}: ${pageRows.length} raw rows, ${newRows.length} new (after dedup), total: ${activeSession.allRows.length + newRows.length}`);

  activeSession.allRows.push(...newRows);

  const progressMsg = `Page ${pageNum} of ${totalPages} — ${newRows.length} new, ${activeSession.allRows.length} total`;
  await updateListState({
    currentPage: pageNum,
    maxPages: totalPages,
    extractedRows: activeSession.allRows,
    progressMessage: progressMsg,
  });
  await sendOverlayToast(activeSession.tabId, `Scout-X: ${progressMsg}`, 'running');

  // Track empty-iteration streak for scroll pagination so we tolerate transient
  // empty steps caused by debounced infinite-scroll loaders.
  const isScroll =
    activeSession.pagination.type === 'scrollDown' ||
    activeSession.pagination.type === 'scrollUp';
  if (newRows.length === 0) activeSession.emptyStreak += 1;
  else activeSession.emptyStreak = 0;

  // Check if we should paginate.
  // For click/URL pagination: keep going until maxPages even if one page
  // yielded 0 *new* rows after dedupe (duplicate-heavy boards). Scroll still
  // uses emptyStreak so infinite scroll can stop at the end of the feed.
  let shouldPaginate =
    activeSession.status === 'running' &&
    activeSession.pagination.type !== '' &&
    activeSession.currentPage < activeSession.maxPages &&
    (isScroll
      ? activeSession.emptyStreak < SCROLL_EMPTY_STREAK_LIMIT
      : true);

  console.log(
    `[Maxun] shouldPaginate: status=${activeSession.status}, type=${activeSession.pagination.type}, ` +
    `currentPage=${activeSession.currentPage}, maxPages=${activeSession.maxPages}, ` +
    `newRows=${newRows.length}, emptyStreak=${activeSession.emptyStreak}, shouldPaginate=${shouldPaginate}`
  );

  if (shouldPaginate) {
    console.log(`[Maxun] Executing pagination (type=${activeSession.pagination.type})...`);
    // Increment page counter BEFORE clicking — this ensures the next extraction
    // call uses the correct page number. Previously we incremented after the click
    // succeeded, but the page content hadn't changed yet (React SPA), so the next
    // extraction read the OLD page's content again, deduplication returned empty,
    // and the loop exited.
    activeSession.currentPage++;
    console.log(`[Maxun] Navigating to page ${activeSession.currentPage}...`);

    const navMsg = isScroll
      ? `Scrolling for more (step ${activeSession.currentPage} of ${totalPages})…`
      : `Navigating to page ${activeSession.currentPage} of ${totalPages}…`;

    await updateListState({
      currentPage: activeSession.currentPage,
      maxPages: totalPages,
      progressMessage: navMsg,
    });
    await sendOverlayToast(activeSession.tabId, `Scout-X: ${navMsg}`, 'running');

    const paginated = await executePagination();

    if (paginated) {
      console.log(`[Maxun] Page change confirmed, waiting for page ready...`);
      await waitForTabComplete(activeSession.tabId, 15_000);
      // Extra settle time for Naukri-like boards after full reload.
      await delay(Math.max(activeSession.pagination.pageDelayMs || 2000, 2000));
      await extractionLoop();
      return;
    } else {
      // Undo the increment since pagination didn't actually change the page
      activeSession.currentPage--;
      console.log('[Maxun] Pagination returned false — exiting loop');
    }
  }

  // Done
  console.log('[Maxun] Extraction loop complete', { totalRows: activeSession.allRows.length });
  activeSession.status = 'done';
  await finalizeExtraction();
}

async function extractCurrentPage(): Promise<ExtractedRow[]> {
  if (!activeSession) return [];

  // Retry with backoff: after chrome.tabs.update(), the content script re-injects
  // and may not be ready for the first message.
  const attempt = (retries: number): Promise<ExtractedRow[]> => {
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(
        activeSession!.tabId,
        {
          type: MSG.EXTRACT_PAGE,
          payload: {
            listSelector: activeSession!.listSelector,
            fields: activeSession!.fields,
            limit: 0,
          },
        },
        (response) => {
          if (chrome.runtime.lastError) {
            console.log('[Maxun] extractCurrentPage: send error, retries left:', retries, chrome.runtime.lastError.message);
            if (retries > 0) {
              delay(1000).then(() => resolve(attempt(retries - 1)));
            } else {
              resolve([]);
            }
            return;
          }
          if (!response?.ok) {
            console.log('[Maxun] extractCurrentPage: response not ok, retries left:', retries);
            if (retries > 0) {
              delay(1000).then(() => resolve(attempt(retries - 1)));
            } else {
              resolve([]);
            }
            return;
          }
          console.log('[Maxun] extractCurrentPage: got', response.rows?.length ?? 0, 'rows on page', activeSession!.currentPage);
          resolve(response.rows || []);
        }
      );
    });
  };

  return attempt(8);
}

async function executePagination(): Promise<boolean> {
  if (!activeSession) return false;

  const { type, selector } = activeSession.pagination;

  if (type === 'clickNext' || type === 'clickLoadMore') {
    if (!selector) return false;

    const hint = type === 'clickLoadMore' ? 'loadMore' : 'next';
    const targetPage = activeSession.currentPage;
    const tabId = activeSession.tabId;

    // Snapshot URL before click. Naukri (and many boards) do a full document
    // navigation on Next — that destroys the content script mid-click so
    // sendResponse never returns `changed: true`, and the old code aborted
    // after page 1 even though the tab had already moved.
    let oldUrl = activeSession.pageUrl || '';
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.url) oldUrl = tab.url;
    } catch {
      /* keep session url */
    }

    const contentSaidChanged = await new Promise<boolean>((resolve) => {
      chrome.tabs.sendMessage(
        tabId,
        {
          type: MSG.CLICK_NEXT,
          payload: {
            selector,
            hint,
            targetPage,
            listSelector: activeSession!.listSelector,
          },
        },
        (response) => {
          if (chrome.runtime.lastError) {
            // Expected on full navigations — port closes as the document unloads.
            console.log(
              '[Maxun] CLICK_NEXT runtime error (often OK on full reload):',
              chrome.runtime.lastError.message
            );
            resolve(false);
            return;
          }
          console.log('[Maxun] CLICK_NEXT response:', JSON.stringify(response));
          resolve(!!response?.changed);
        }
      );
    });

    if (contentSaidChanged) {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.url) activeSession.pageUrl = tab.url;
      } catch {
        /* ignore */
      }
      return true;
    }

    // Content script died or reported no change — confirm via tab URL / load.
    const navigated = await waitForAnyUrlChange(tabId, oldUrl, 12_000);
    if (navigated) {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.url) activeSession.pageUrl = tab.url;
      } catch {
        /* ignore */
      }
      console.log('[Maxun] CLICK_NEXT: confirmed via tab URL change →', activeSession.pageUrl);
      await waitForTabComplete(tabId, 15_000);
      return true;
    }

    // Last resort for Naukri-style path pages: …-bangalore → …-bangalore-2
    if (type === 'clickNext') {
      const pathUrl = buildPathPageUrl(oldUrl, targetPage);
      if (pathUrl && pathUrl !== oldUrl) {
        console.log('[Maxun] CLICK_NEXT: path-URL fallback →', pathUrl);
        const ok = await navigateTabAndWait(tabId, pathUrl, oldUrl, 12_000);
        if (ok) {
          activeSession.pageUrl = pathUrl;
          return true;
        }
      }
    }

    return false;
  }

  if (type === 'scrollDown' || type === 'scrollUp') {
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(
        activeSession!.tabId,
        {
          type: MSG.SCROLL_DOWN,
          payload: {
            direction: type,
            listSelector: activeSession!.listSelector,
            timeoutMs: Math.max(2000, activeSession!.pagination.pageDelayMs || 3000),
          },
        },
        (response) => {
          if (chrome.runtime.lastError) {
            console.log('[Maxun] SCROLL runtime error:', chrome.runtime.lastError.message);
            resolve(false);
            return;
          }
          console.log('[Maxun] SCROLL response:', JSON.stringify(response));
          resolve(response?.changed || false);
        }
      );
    });
  }

  if (type === 'pageNumber') {
    const { pageParam, startPage = 0, pageDelayMs = 3000 } = (activeSession.pagination as any);
    if (!pageParam) return false;

    return new Promise((resolve) => {
      // Build the target URL: start from origin + pathname, then add all current params
      // except pagination-related ones, replacing pageParam with the next value.
      const currentUrl = activeSession!.pageUrl;
      let baseUrl: string;
      try {
        const url = new URL(currentUrl);
        // Remove ALL occurrences of pagination params (delete only removes the first)
        const paramsToDelete = [pageParam, 'page', 'offset', 'pg'];
        for (const key of paramsToDelete) {
          while (url.searchParams.has(key)) {
            url.searchParams.delete(key);
          }
        }
        // Rebuild from origin + pathname only (not url.search) to avoid duplication
        baseUrl = url.origin + url.pathname + url.hash;
      } catch {
        baseUrl = currentUrl.split('?')[0]; // strip all query params on error
      }

      // Next offset = startPage + (currentPage - 1)
      // currentPage=1 → start=0, currentPage=2 → start=10, etc.
      const nextPage = startPage + activeSession!.currentPage - 1;
      const nextUrl = new URL(baseUrl.includes('?') ? baseUrl : baseUrl + '?');
      nextUrl.searchParams.set(pageParam, String(nextPage));
      const navUrl = nextUrl.toString();

      console.log(`[Maxun] pageNumber: navigating to ${navUrl}`);

      const oldUrl = currentUrl;
      // Navigate using chrome.tabs.update — this keeps the content script alive
      // so it can respond to MSG.EXTRACT_PAGE after the page loads.
      // window.location.href in the content script destroys the tab context before
      // sendResponse can fire, breaking the extraction loop.
      chrome.tabs.update(
        activeSession!.tabId,
        { url: navUrl },
        (tab) => {
          if (chrome.runtime.lastError || !tab) {
            console.error('[Maxun] tab.update failed:', chrome.runtime.lastError?.message);
            resolve(false);
            return;
          }
          // Poll to confirm URL actually changed to the expected value
          waitForUrlChange(activeSession!.tabId, navUrl, oldUrl, 8000).then((changed) => {
            console.log(`[Maxun] URL change confirmed: ${changed} (expected: ${navUrl})`);
            resolve(changed);
          });
        }
      );
    });
  }

  function waitForUrlChange(tabId: number, expectedUrl: string, oldUrl: string, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const deadline = Date.now() + timeoutMs;
      const check = async () => {
        if (Date.now() > deadline) { resolve(false); return; }
        try {
          const tab = await chrome.tabs.get(tabId);
          const tabUrl = tab.url || '';
          // Confirm the URL contains the expected param value
          if (tabUrl.includes(expectedUrl.split('?')[1] || '')) {
            resolve(true); return;
          }
          // Also accept if the tab navigated away from the old URL
          if (tabUrl !== oldUrl && tabUrl !== activeSession!.pageUrl) {
            resolve(true); return;
          }
        } catch {
          // tab may be gone
        }
        setTimeout(check, 400);
      };
      check();
    });
  }

  return false;
}

/** True when the tab URL differs from `oldUrl` (full document navigations). */
function waitForAnyUrlChange(tabId: number, oldUrl: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const check = async () => {
      if (Date.now() > deadline) {
        resolve(false);
        return;
      }
      try {
        const tab = await chrome.tabs.get(tabId);
        const tabUrl = tab.url || '';
        if (tabUrl && oldUrl && tabUrl !== oldUrl && !tabUrl.startsWith('chrome://')) {
          // Prefer waiting until load completes so content script can reinject.
          if (tab.status === 'complete') {
            resolve(true);
            return;
          }
        }
      } catch {
        /* tab may be mid-navigation */
      }
      setTimeout(check, 300);
    };
    check();
  });
}

function waitForTabComplete(tabId: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const check = async () => {
      if (Date.now() > deadline) {
        resolve();
        return;
      }
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.status === 'complete') {
          resolve();
          return;
        }
      } catch {
        /* ignore */
      }
      setTimeout(check, 300);
    };
    check();
  });
}

/** Naukri-style `...-bangalore` / `...-bangalore-2` → next path page. */
function buildPathPageUrl(currentUrl: string, nextPage: number): string | null {
  if (!nextPage || nextPage < 2) return null;
  try {
    const url = new URL(currentUrl);
    const path = url.pathname;
    const suffixRe = /-(\d+)\/?$/;
    if (suffixRe.test(path)) {
      url.pathname = path.replace(suffixRe, `-${nextPage}`);
      return url.toString();
    }
    if (!/jobs|careers|search|portals|vacancies|openings/i.test(path)) return null;
    url.pathname = path.replace(/\/?$/, '') + `-${nextPage}`;
    return url.toString();
  } catch {
    return null;
  }
}

function navigateTabAndWait(
  tabId: number,
  navUrl: string,
  oldUrl: string,
  timeoutMs: number
): Promise<boolean> {
  return new Promise((resolve) => {
    chrome.tabs.update(tabId, { url: navUrl }, (tab) => {
      if (chrome.runtime.lastError || !tab) {
        console.error('[Maxun] tab.update failed:', chrome.runtime.lastError?.message);
        resolve(false);
        return;
      }
      waitForAnyUrlChange(tabId, oldUrl, timeoutMs).then(async (changed) => {
        if (changed) await waitForTabComplete(tabId, timeoutMs);
        resolve(changed);
      });
    });
  });
}

function deduplicateRows(rows: ExtractedRow[]): ExtractedRow[] {
  if (!activeSession) return rows;

  const newRows: ExtractedRow[] = [];
  for (const row of rows) {
    const fingerprint = JSON.stringify(
      Object.values(row).map((v) => (v || '').toLowerCase().trim())
    );
    if (!activeSession.seenFingerprints.has(fingerprint)) {
      activeSession.seenFingerprints.add(fingerprint);
      newRows.push(row);
    }
  }
  return newRows;
}

async function finalizeExtraction(): Promise<void> {
  if (!activeSession) return;

  const headers = activeSession.allRows.length > 0
    ? Object.keys(activeSession.allRows[0])
    : [];

  await storeExtractedData({
    rows: activeSession.allRows,
    headers,
    source: 'list-extraction',
    url: activeSession.pageUrl,
    timestamp: new Date().toISOString(),
  });

  await updateListState({
    phase: 'complete',
    extractedRows: activeSession.allRows,
    currentPage: activeSession.currentPage,
    progressMessage: `Done — ${activeSession.allRows.length} items across ${activeSession.currentPage} page(s).`,
  });

  await sendOverlayToast(
    activeSession.tabId,
    `Scout-X: Done — ${activeSession.allRows.length} items across ${activeSession.currentPage} page(s).`,
    'done'
  );

  activeSession = null;
}

async function sendOverlayToast(
  tabId: number,
  text: string,
  status: 'running' | 'done' | 'error' = 'running'
): Promise<void> {
  try {
    await new Promise<void>((resolve) => {
      chrome.tabs.sendMessage(
        tabId,
        { type: MSG.EXTRACTION_PROGRESS, payload: { text, status } },
        () => {
          // Swallow chrome.runtime.lastError — page may be reloading between pages
          void chrome.runtime.lastError;
          resolve();
        }
      );
    });
  } catch {
    // no-op
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
