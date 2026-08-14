/**
 * Message Router - Central message dispatch for the extension.
 * Routes messages between side panel, content script, and background services.
 */

import { MSG } from '../shared/messages';
import type { ExtensionState } from '../shared/types';
import {
  cloudScheduleDraftFromApiSchedule,
  configScheduleFromDraft,
  defaultCloudScheduleDraft,
} from '../shared/types';
import { getState, updateState, updateListState, updateTableState, updateTextState, resetState, storeExtractedData } from './stateManager';
import { startExtraction, cancelExtraction, getExtractionStatus, onAutoScrollProgress } from './extractionOrchestrator';
import {
  saveConfigToBackend,
  saveScheduleToBackend,
  getAutomationStatus,
  triggerBackendRun,
  lookupAutomation,
} from './backendApi';

/**
 * Initialize the message router.
 */
export function initMessageRouter() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleMessage(message, sender, sendResponse);
    return true; // keep channel open for async
  });
}

async function handleMessage(
  message: any,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: any) => void
) {
  try {
    switch (message.type) {
      // ── State Management ──
      case MSG.GET_STATE: {
        const state = await getState();
        sendResponse({ ok: true, state });
        break;
      }

      case MSG.RESET_STATE: {
        const tabId = await getActiveTabId();
        if (tabId) {
          await sendToTab(tabId, { type: MSG.CLEAR_HIGHLIGHTS });
        }
        const state = await resetState();
        sendResponse({ ok: true, state });
        break;
      }

      case MSG.APPLY_BACKEND_FROM_WEB: {
        const { backendUrl } = message.payload || {};
        if (typeof backendUrl === 'string' && /^https?:\/\//i.test(backendUrl.trim())) {
          const trimmed = backendUrl.trim().replace(/\/+$/, '');
          const state = await updateState({ backendUrl: trimmed });
          sendResponse({ ok: true, state });
        } else {
          sendResponse({ ok: false, error: 'Invalid backendUrl' });
        }
        break;
      }

      case MSG.SET_EXTENSION_SETTINGS: {
        const { backendUrl, apiKey } = message.payload || {};
        const patch: Record<string, unknown> = {};
        if (typeof backendUrl === 'string') {
          const trimmed = backendUrl.trim().replace(/\/+$/, '');
          patch.backendUrl = trimmed || (await getState()).backendUrl;
        }
        if (typeof apiKey === 'string') {
          patch.apiKey = apiKey;
        }
        const state = await updateState(patch as Partial<ExtensionState>);
        sendResponse({ ok: true, state });
        break;
      }

      case MSG.SET_TOOL: {
        const { tool } = message.payload || {};
        const state = await updateState({ activeTool: tool });
        sendResponse({ ok: true, state });
        break;
      }

      // ── List Extraction (from side panel) ──
      case MSG.START_LIST_MODE: {
        const tabId = await getActiveTabId();
        if (!tabId) {
          sendResponse({ ok: false, error: 'No active tab' });
          break;
        }
        await updateState({ activeTabId: tabId });
        await updateListState({ phase: 'selecting' });

        const injected = await ensureContentScript(tabId);
        if (!injected) {
          await updateListState({ phase: 'idle' });
          sendResponse({ ok: false, error: 'Could not inject content script. This tab may be a restricted page (chrome://, file://, etc). Try refreshing the target page.' });
          break;
        }

        const response = await sendToTab(tabId, { type: MSG.START_LIST_HOVER });
        sendResponse({ ok: true, ...response });
        break;
      }

      case MSG.STOP_SELECTION: {
        const state = await getState();
        if (state.activeTabId) {
          await sendToTab(state.activeTabId, { type: MSG.STOP_LIST_HOVER });
        }
        await updateListState({ phase: 'idle' });
        sendResponse({ ok: true });
        break;
      }

      case MSG.PICK_ELEMENT: {
        const state = await getState();
        const tabId = state.activeTabId ?? (await getActiveTabId());
        if (!tabId) {
          sendResponse({ ok: false, error: 'No active tab' });
          break;
        }
        await updateState({ activeTabId: tabId });

        const injected = await ensureContentScript(tabId);
        if (!injected) {
          sendResponse({ ok: false, error: 'Could not inject content script. Try refreshing the target page.' });
          break;
        }

        const response = await sendToTab(tabId, { type: MSG.PICK_ELEMENT });
        sendResponse({ ok: true, selector: response?.selector || '' });
        break;
      }

      // From content script: list was selected
      case MSG.LIST_SELECTED: {
        const { listSelector, itemCount, fields, previewRows, previewText, previewUrl, pagination } =
          message.payload || {};
        const patch: Record<string, unknown> = {
          phase: 'configuring',
          listSelector,
          itemCount,
          fields,
          previewRows,
          ...(typeof previewUrl === 'string' && previewUrl ? { previewUrl } : {}),
        };
        // Only apply auto-detected pagination when the user hasn't configured one yet
        if (
          pagination &&
          typeof pagination === 'object' &&
          pagination.type &&
          pagination.selector
        ) {
          const cur = (await getState()).list.pagination;
          if (!cur?.type || !cur?.selector) {
            patch.pagination = {
              type: pagination.type,
              selector: pagination.selector,
              confidence: pagination.confidence || 'medium',
              maxPages: pagination.maxPages || 20,
              pageDelayMs: pagination.pageDelayMs || 1500,
            };
          }
        }
        await updateListState(patch as any);
        sendResponse({ ok: true });
        break;
      }

      case MSG.UPDATE_FIELDS: {
        const { fields } = message.payload || {};
        await updateListState({ fields });
        sendResponse({ ok: true });
        break;
      }

      case MSG.UPDATE_PAGINATION: {
        const { pagination } = message.payload || {};
        await updateListState({ pagination });
        sendResponse({ ok: true });
        break;
      }

      case MSG.UPDATE_ROW_CONTEXT: {
        const { rowContext } = message.payload || {};
        if (rowContext && typeof rowContext === 'object') {
          const cur = (await getState()).list.rowContext || { sectorIndustry: '', f500: false };
          const next = {
            sectorIndustry:
              typeof rowContext.sectorIndustry === 'string'
                ? rowContext.sectorIndustry
                : cur.sectorIndustry,
            f500: typeof rowContext.f500 === 'boolean' ? rowContext.f500 : cur.f500,
          };
          await updateListState({ rowContext: next });
        }
        sendResponse({ ok: true });
        break;
      }

      case MSG.UPDATE_CLOUD_SCHEDULE_DRAFT: {
        const draft = message.payload?.draft;
        if (!draft || typeof draft !== 'object') {
          sendResponse({ ok: false, error: 'draft is required' });
          break;
        }
        const cur = await getState();
        const base = cur.list.cloudScheduleDraft ?? defaultCloudScheduleDraft();
        const nextDraft = {
          enabled: typeof draft.enabled === 'boolean' ? draft.enabled : base.enabled,
          cron: draft.cron === undefined ? base.cron : draft.cron,
          timezone: typeof draft.timezone === 'string' && draft.timezone.trim() ? draft.timezone.trim() : base.timezone,
        };
        await updateListState({ cloudScheduleDraft: nextDraft });
        sendResponse({ ok: true });
        break;
      }

      case MSG.RUN_EXTRACTION: {
        const state = await getState();
        if (!state.activeTabId) {
          sendResponse({ ok: false, error: 'No active tab' });
          break;
        }

        // Get current page URL
        const tab = await chrome.tabs.get(state.activeTabId);
        const pageUrl = tab.url || '';

        await startExtraction(
          state.activeTabId,
          state.list.listSelector,
          state.list.fields,
          state.list.pagination,
          pageUrl
        );
        sendResponse({ ok: true });
        break;
      }

      case MSG.CANCEL_EXTRACTION: {
        // For click/url-pattern modes cancelExtraction simply flips the status
        // flag and the loop exits on the next tick; for auto-scroll modes it
        // sends AUTOSCROLL_STOP to the content script and the final phase
        // transition happens in onAutoScrollProgress. We leave the side panel
        // phase alone here (the orchestrator owns that) unless we're not in an
        // active session at all.
        const status = getExtractionStatus();
        cancelExtraction();
        if (!status) {
          await updateListState({ phase: 'complete' });
        }
        sendResponse({ ok: true });
        break;
      }

      // ── Auto-scroll progress (from content script) ──
      case MSG.AUTOSCROLL_PROGRESS: {
        await onAutoScrollProgress(message.payload || {});
        sendResponse({ ok: true });
        break;
      }

      // ── Table Extraction (from side panel) ──
      case MSG.DETECT_TABLES_CMD: {
        const tabId = await getActiveTabId();
        if (!tabId) {
          sendResponse({ ok: false, error: 'No active tab' });
          break;
        }
        await updateState({ activeTabId: tabId });
        await updateTableState({ phase: 'detecting' });

        const injected = await ensureContentScript(tabId);
        if (!injected) {
          await updateTableState({ phase: 'idle' });
          sendResponse({ ok: false, error: 'Could not inject content script. Try refreshing the target page.' });
          break;
        }

        const response = await sendToTab(tabId, { type: MSG.DETECT_TABLES });
        if (response?.tables) {
          await updateTableState({
            phase: 'selecting',
            detectedTables: response.tables,
          });
        }
        sendResponse({ ok: true, tables: response?.tables || [] });
        break;
      }

      case MSG.EXTRACT_TABLE_CMD: {
        const state = await getState();
        const { selector, index } = message.payload || {};
        if (!state.activeTabId) {
          sendResponse({ ok: false, error: 'No active tab' });
          break;
        }

        await updateTableState({ phase: 'extracting', selectedTableIndex: index });
        const response = await sendToTab(state.activeTabId, {
          type: MSG.EXTRACT_TABLE,
          payload: { selector },
        });

        if (response?.ok) {
          const tab = await chrome.tabs.get(state.activeTabId);
          await updateTableState({
            phase: 'complete',
            headers: response.headers,
            rows: response.rows,
          });
          // Store for data table
          await storeExtractedData({
            rows: response.rows.map((row: string[], i: number) => {
              const obj: Record<string, string> = {};
              response.headers.forEach((h: string, j: number) => {
                obj[h] = row[j] || '';
              });
              return obj;
            }),
            headers: response.headers,
            source: 'table-extraction',
            url: tab.url || '',
            timestamp: new Date().toISOString(),
          });
        }
        sendResponse({ ok: true });
        break;
      }

      // ── Text Extraction (from side panel) ──
      case MSG.EXTRACT_TEXT_CMD: {
        const state = await getState();
        const { format } = message.payload || { format: 'plain' };
        const tabId = state.activeTabId || (await getActiveTabId());
        if (!tabId) {
          sendResponse({ ok: false, error: 'No active tab' });
          break;
        }

        await updateState({ activeTabId: tabId });
        await updateTextState({ phase: 'extracting', format });

        const injected = await ensureContentScript(tabId);
        if (!injected) {
          await updateTextState({ phase: 'idle' });
          sendResponse({ ok: false, error: 'Could not inject content script. Try refreshing the target page.' });
          break;
        }

        const response = await sendToTab(tabId, {
          type: MSG.EXTRACT_TEXT,
          payload: { format },
        });

        if (response?.ok) {
          await updateTextState({
            phase: 'complete',
            content: response.content,
          });
        }
        sendResponse({ ok: true, content: response?.content || '' });
        break;
      }

      // ── Data Table ──
      case MSG.OPEN_DATA_TABLE: {
        chrome.tabs.create({
          url: chrome.runtime.getURL('src/datatable/index.html'),
        });
        sendResponse({ ok: true });
        break;
      }

      // ── Export ──
      case MSG.EXPORT_CSV: {
        const { data, filename } = message.payload || {};
        await exportFile(data, filename || 'maxun-export.csv', 'text/csv');
        sendResponse({ ok: true });
        break;
      }

      case MSG.EXPORT_JSON: {
        const { data, filename } = message.payload || {};
        await exportFile(data, filename || 'maxun-export.json', 'application/json');
        sendResponse({ ok: true });
        break;
      }

      // ── Backend Integration ──
      case MSG.LOOKUP_AUTOMATION: {
        const result = await lookupAutomation({
          url: message.payload?.url,
          scoutId: message.payload?.scoutId,
        });
        sendResponse({ ok: true, result });
        break;
      }

      case MSG.SAVE_TO_BACKEND: {
        const st = await getState();
        let startUrl = message.payload?.startUrl as string | undefined;
        const previewUrl =
          (typeof message.payload?.previewUrl === 'string' && message.payload.previewUrl) ||
          st.list.previewUrl ||
          undefined;
        const tabId = st.activeTabId ?? (await getActiveTabId());
        if (tabId) {
          try {
            const tab = await chrome.tabs.get(tabId);
            if (tab.url && /^https?:\/\//i.test(tab.url)) {
              startUrl = tab.url;
            }
          } catch {
            /* keep payload startUrl */
          }
        }
        // Prefer the URL from preview time so client-side filters encoded in the
        // URL at authoring time survive even if the user navigated away later.
        if (previewUrl && /^https?:\/\//i.test(previewUrl)) {
          startUrl = previewUrl;
        }
        // Reuse persisted automationId so subsequent saves update instead of
        // creating duplicates. Explicit payload.automationId still wins.
        const persistedId = st.list.savedAutomation?.id;
        const schedulePayload = configScheduleFromDraft(
          st.list.cloudScheduleDraft ?? defaultCloudScheduleDraft()
        );
        const elementsOnly = message.payload?.elementsOnly === true;
        const result = await saveConfigToBackend({
          ...message.payload,
          automationId: message.payload?.automationId || persistedId,
          startUrl,
          previewUrl,
          schedule: elementsOnly ? undefined : schedulePayload,
          elementsOnly,
        });
        const newId = extractAutomationId(result);
        const scoutId =
          result?.automation?.scoutId ||
          result?.scoutId ||
          message.payload?.scoutId ||
          st.list.savedAutomation?.scoutId ||
          null;
        const companyName =
          result?.automation?.companyName ||
          message.payload?.companyName ||
          st.list.savedAutomation?.companyName ||
          null;
        const serverSchedule =
          result?.automation?.schedule ||
          result?.schedule ||
          result?.result?.automation?.schedule;
        const draftFromServer = cloudScheduleDraftFromApiSchedule(serverSchedule);
        if (newId) {
          let schedulePatch: Record<string, unknown> = {};
          if (serverSchedule && typeof serverSchedule === 'object') {
            const sch = serverSchedule;
            const cronStr = typeof sch.cron === 'string' ? sch.cron.trim() : '';
            const hasEvery = typeof sch.every === 'number' && sch.every > 0;
            schedulePatch = {
              scheduleEnabled: !!(sch.enabled && !sch.paused && (cronStr || hasEvery)),
              schedulePaused: !!(sch.paused || (cronStr && !sch.enabled)),
              cron: cronStr || null,
              timezone: sch.timezone ?? null,
              nextRunAt: sch.nextRunAt ?? null,
            };
          }
          await updateListState({
            savedAutomation: {
              ...(st.list.savedAutomation || { id: newId }),
              id: newId,
              scoutId: scoutId || st.list.savedAutomation?.scoutId || null,
              companyName: companyName || st.list.savedAutomation?.companyName || null,
              name: result?.automation?.name || st.list.savedAutomation?.name,
              fetchedAt: new Date().toISOString(),
              ...schedulePatch,
            },
            ...(draftFromServer ? { cloudScheduleDraft: draftFromServer } : {}),
          });
        } else if (draftFromServer) {
          await updateListState({ cloudScheduleDraft: draftFromServer });
        }
        sendResponse({ ok: true, result, automationId: newId, scoutId });
        break;
      }

      case MSG.SET_SCHEDULE: {
        const { automationId, schedule } = message.payload || {};
        if (!automationId) {
          sendResponse({ ok: false, error: 'automationId is required' });
          break;
        }
        const result = await saveScheduleToBackend(automationId, schedule);
        // Mirror the saved schedule into local state so the UI can show
        // next/last run without another round-trip.
        const current = await getState();
        const mergedSch = result?.schedule || {};
        const mergedCron =
          (typeof mergedSch.cron === 'string' && mergedSch.cron.trim()) ||
          (typeof schedule?.cron === 'string' && schedule.cron.trim()) ||
          '';
        const hasEvery = typeof mergedSch.every === 'number' && mergedSch.every > 0;
        const draftFromSet = cloudScheduleDraftFromApiSchedule({
          enabled: !!mergedSch.enabled,
          cron: mergedCron || mergedSch.cron,
          timezone: mergedSch.timezone || schedule?.timezone,
          paused: mergedSch.paused,
        });
        await updateListState({
          savedAutomation: {
            ...(current.list.savedAutomation || { id: automationId }),
            id: automationId,
            scheduleEnabled: !!(mergedSch.enabled && !mergedSch.paused && (mergedCron || hasEvery)),
            schedulePaused: !!(mergedSch.paused || (mergedCron && !mergedSch.enabled)),
            cron: mergedCron || null,
            timezone: mergedSch.timezone || schedule?.timezone || null,
            nextRunAt: mergedSch.nextRunAt
              ? typeof mergedSch.nextRunAt === 'string'
                ? mergedSch.nextRunAt
                : new Date(mergedSch.nextRunAt).toISOString()
              : null,
            fetchedAt: new Date().toISOString(),
          },
          ...(draftFromSet ? { cloudScheduleDraft: draftFromSet } : {}),
        });
        sendResponse({ ok: true, result });
        break;
      }

      case MSG.SEND_AND_SCHEDULE: {
        const st = await getState();
        let startUrl = message.payload?.startUrl as string | undefined;
        const tabId = st.activeTabId ?? (await getActiveTabId());
        if (tabId) {
          try {
            const tab = await chrome.tabs.get(tabId);
            if (tab.url && /^https?:\/\//i.test(tab.url)) {
              startUrl = tab.url;
            }
          } catch {
            /* keep payload startUrl */
          }
        }
        const persistedId = st.list.savedAutomation?.id;
        const schedulePayload =
          message.payload?.schedule ??
          configScheduleFromDraft(st.list.cloudScheduleDraft ?? defaultCloudScheduleDraft());
        const saveResult = await saveConfigToBackend({
          ...(message.payload?.config || {}),
          automationId: message.payload?.config?.automationId || persistedId,
          startUrl,
          schedule: schedulePayload,
        });
        const newId = extractAutomationId(saveResult) || persistedId;
        if (!newId) {
          sendResponse({ ok: false, error: 'Failed to create automation' });
          break;
        }

        let status: any = null;
        try {
          status = await getAutomationStatus(newId);
        } catch {
          /* non-fatal, just skip status sync */
        }

        const serverSchedule =
          saveResult?.automation?.schedule ||
          saveResult?.schedule ||
          status?.automation?.schedule;
        const draftFromServer = cloudScheduleDraftFromApiSchedule(serverSchedule);
        const sch = status?.automation?.schedule || serverSchedule;
        const cronStr = typeof sch?.cron === 'string' ? sch.cron.trim() : '';
        const hasEvery = typeof sch?.every === 'number' && sch.every > 0;
        const scheduleEnabled = !!(sch?.enabled && !sch?.paused && (cronStr || hasEvery));
        const schedulePaused = !!(sch?.paused || (cronStr && !sch?.enabled));

        await updateListState({
          savedAutomation: {
            id: newId,
            name: saveResult?.automation?.name || status?.automation?.name,
            scheduleEnabled,
            schedulePaused,
            cron: cronStr || null,
            timezone: sch?.timezone ?? null,
            nextRunAt: sch?.nextRunAt ?? null,
            lastRunStatus: status?.automation?.status?.id || null,
            lastRunTime: status?.automation?.lastRunTime || null,
            fetchedAt: new Date().toISOString(),
          },
          ...(draftFromServer ? { cloudScheduleDraft: draftFromServer } : {}),
        });

        sendResponse({
          ok: true,
          automationId: newId,
          save: saveResult,
          schedule: serverSchedule,
          status,
        });
        break;
      }

      case MSG.GET_AUTOMATION_STATUS: {
        const automationId: string | undefined = message.payload?.automationId;
        const st = await getState();
        const id = automationId || st.list.savedAutomation?.id;
        if (!id) {
          sendResponse({ ok: false, error: 'automationId is required' });
          break;
        }
        try {
          const status = await getAutomationStatus(id);
          const a = status?.automation || {};
          const sch = a.schedule;
          const cronStr = typeof sch?.cron === 'string' ? sch.cron.trim() : '';
          const hasEvery = typeof sch?.every === 'number' && sch.every > 0;
          const scheduleEnabled = !!(sch?.enabled && !sch?.paused && (cronStr || hasEvery));
          const schedulePaused = !!(sch?.paused || (cronStr && !sch?.enabled));
          const draftFromServer = cloudScheduleDraftFromApiSchedule(sch);
          await updateListState({
            savedAutomation: {
              ...(st.list.savedAutomation || { id }),
              id,
              name: a.name,
              scheduleEnabled,
              schedulePaused,
              cron: cronStr || null,
              timezone: sch?.timezone ?? null,
              nextRunAt: sch?.nextRunAt ?? null,
              lastRunStatus: a.status?.id || null,
              lastRunTime: a.lastRunTime || null,
              fetchedAt: new Date().toISOString(),
            },
            ...(draftFromServer ? { cloudScheduleDraft: draftFromServer } : {}),
          });
          sendResponse({ ok: true, status });
        } catch (err) {
          sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
        }
        break;
      }

      case MSG.RUN_AUTOMATION_NOW: {
        const st = await getState();
        const id: string | undefined = message.payload?.automationId || st.list.savedAutomation?.id;
        if (!id) {
          sendResponse({ ok: false, error: 'automationId is required' });
          break;
        }
        try {
          const result = await triggerBackendRun(id);
          sendResponse({ ok: true, result });
        } catch (err) {
          sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
        }
        break;
      }

      // ── Extraction Progress (from content script) ──
      case MSG.EXTRACTION_PROGRESS: {
        // Forward to side panel via state update
        sendResponse({ ok: true });
        break;
      }

      default: {
        sendResponse({ ok: false, error: `Unknown message: ${message.type}` });
      }
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('Message handler error:', errorMsg);
    const code = (error as any)?.code;
    const automation = (error as any)?.automation;
    sendResponse({
      ok: false,
      error: errorMsg,
      ...(code ? { code } : {}),
      ...(automation ? { automation } : {}),
    });
  }
}

// ── Helpers ──

/**
 * Extract an automationId from any of the several response shapes the backend
 * returns across /automations and /automations/:id/config.
 */
function extractAutomationId(result: any): string | null {
  return (
    result?.automation?.id ||
    result?.id ||
    result?.result?.automation?.id ||
    result?.result?.id ||
    null
  );
}

async function getActiveTabId(): Promise<number | null> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0]?.id || null;
}

/**
 * Ensure the content script is injected into the given tab.
 * Pings first, injects if no response.
 */
async function ensureContentScript(tabId: number): Promise<boolean> {
  // Try pinging first
  const alive = await new Promise<boolean>((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, { type: MSG.PING }, (response) => {
        if (chrome.runtime.lastError) {
          resolve(false);
          return;
        }
        resolve(!!response?.ok);
      });
    } catch {
      resolve(false);
    }
  });

  if (alive) return true;

  // Not alive - inject it. Get files from the manifest content_scripts entry.
  const manifest = chrome.runtime.getManifest();
  const contentScripts = (manifest as any).content_scripts as Array<{ js?: string[]; css?: string[] }> | undefined;
  const jsFiles = contentScripts?.[0]?.js || [];
  const cssFiles = contentScripts?.[0]?.css || [];

  if (jsFiles.length === 0) {
    console.error('No content script files in manifest');
    return false;
  }

  try {
    // Inject CSS first
    if (cssFiles.length > 0) {
      await chrome.scripting.insertCSS({
        target: { tabId },
        files: cssFiles,
      });
    }
    await chrome.scripting.executeScript({
      target: { tabId },
      files: jsFiles,
    });
    // Brief delay for the script to initialize
    await new Promise((r) => setTimeout(r, 100));
    return true;
  } catch (err) {
    console.error('Failed to inject content script:', err);
    return false;
  }
}

function sendToTab(tabId: number, message: any): Promise<any> {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        console.warn('Tab message error:', chrome.runtime.lastError.message);
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(response);
    });
  });
}

/**
 * MV3 service workers often omit `URL.createObjectURL` for blobs. `chrome.downloads`
 * accepts UTF-8 data URLs for text/csv and application/json exports.
 */
async function exportFile(content: string, filename: string, mimeType: string) {
  const url = `data:${mimeType};charset=utf-8,${encodeURIComponent(content)}`;

  await chrome.downloads.download({
    url,
    filename,
    saveAs: true,
  });
}
