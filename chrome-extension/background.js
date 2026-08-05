const DEFAULT_API_BASE = "http://174.138.34.210:8080/api";
const DEFAULT_FIELD_TYPES = ["title", "price", "link", "image"];

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      if (message.type === "ensure-content-script") {
        const tabId = message.tabId;
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ["content.js"],
        });
        sendResponse({ ok: true });
        return;
      }

      if (message.type === "start-selection") {
        const tabId = message.tabId;
        await chrome.tabs.sendMessage(tabId, {
          type: "maxun-start-selection",
          fieldType: message.fieldType || "title",
        });
        sendResponse({ ok: true });
        return;
      }

      if (message.type === "stop-selection") {
        await chrome.tabs.sendMessage(message.tabId, { type: "maxun-stop-selection" });
        sendResponse({ ok: true });
        return;
      }

      if (message.type === "get-state") {
        const state = await chrome.storage.local.get(["maxunExtensionState"]);
        sendResponse({ ok: true, state: state.maxunExtensionState || buildEmptyState() });
        return;
      }

      if (message.type === "clear-state") {
        const nextState = buildEmptyState();
        await chrome.storage.local.set({ maxunExtensionState: nextState });
        if (message.tabId) {
          await chrome.tabs.sendMessage(message.tabId, { type: "maxun-clear-selection" }).catch(() => {});
        }
        sendResponse({ ok: true, state: nextState });
        return;
      }

      if (message.type === "save-selection") {
        const current = await chrome.storage.local.get(["maxunExtensionState"]);
        const nextState = normalizeStateUpdate(current.maxunExtensionState || buildEmptyState(), message.payload || {});
        await chrome.storage.local.set({ maxunExtensionState: nextState });
        sendResponse({ ok: true, state: nextState });
        return;
      }

      if (message.type === "save-config") {
        const response = await saveConfigToBackend(message.payload || {});
        sendResponse({ ok: true, response });
        return;
      }

      sendResponse({ ok: false, error: `Unknown message type: ${message.type}` });
    } catch (error) {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  })();

  return true;
});

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get(["maxunExtensionState"]);
  if (!current.maxunExtensionState) {
    await chrome.storage.local.set({ maxunExtensionState: buildEmptyState() });
  }
});

function buildEmptyState() {
  return {
    listSelector: "",
    listXPath: "",
    listPreviewText: "",
    listPreviewCount: 0,
    pagination: {
      mode: "none",
      selector: "",
    },
    fields: DEFAULT_FIELD_TYPES.reduce((acc, key) => {
      acc[key] = null;
      return acc;
    }, {}),
    previewRows: [],
    lastUpdatedAt: null,
  };
}

function normalizeStateUpdate(previousState, patch) {
  const nextState = {
    ...buildEmptyState(),
    ...previousState,
    ...patch,
    fields: {
      ...buildEmptyState().fields,
      ...(previousState?.fields || {}),
      ...(patch?.fields || {}),
    },
    pagination: {
      ...buildEmptyState().pagination,
      ...(previousState?.pagination || {}),
      ...(patch?.pagination || {}),
    },
    lastUpdatedAt: new Date().toISOString(),
  };
  return nextState;
}

async function saveConfigToBackend(payload) {
  const {
    apiBaseUrl = DEFAULT_API_BASE,
    automationId,
    automationName,
    startUrl,
    webhookUrl,
    previewRows = [],
    selectionState = buildEmptyState(),
  } = payload;

  if (!automationId) {
    throw new Error("automationId is required");
  }

  const listExtraction = {
    itemSelector: selectionState.listSelector,
    fields: buildFieldMap(selectionState.fields),
    uniqueKey: getSuggestedUniqueKey(selectionState.fields),
    maxItems: 200,
    autoScroll: selectionState.pagination?.mode === "infinite-scroll",
    pagination: mapPagination(selectionState.pagination),
  };

  if (!listExtraction.itemSelector) {
    throw new Error("List selector is required before saving");
  }

  if (Object.keys(listExtraction.fields).length === 0) {
    throw new Error("At least one field must be selected before saving");
  }

  const body = {
    name: automationName,
    startUrl,
    webhookUrl,
    config: {
      webhookUrl: webhookUrl || "",
      listExtraction,
      previewRows,
    },
  };

  const normalizedBase = apiBaseUrl.replace(/\/+$/, "");
  const response = await fetch(`${normalizedBase}/automations/${automationId}/config`, {
    method: "PUT",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Backend request failed with ${response.status}`);
  }

  return response.json();
}

function buildFieldMap(fields) {
  const result = {};
  Object.entries(fields || {}).forEach(([fieldName, value]) => {
    if (value?.selector) {
      result[fieldName] = value.attribute && value.attribute !== "innerText"
        ? `${value.selector}@${value.attribute}`
        : value.selector;
    }
  });
  return result;
}

function getSuggestedUniqueKey(fields) {
  if (fields?.link?.selector) return "link";
  if (fields?.image?.selector) return "image";
  if (fields?.title?.selector) return "title";
  return "";
}

function mapPagination(pagination) {
  switch (pagination?.mode) {
    case "next-button":
      return {
        mode: "next-button",
        nextButtonSelector: pagination.selector || "",
        maxPages: 10,
        pageDelayMs: 1200,
      };
    case "infinite-scroll":
      return {
        mode: "infinite-scroll",
        maxPages: 10,
        pageDelayMs: 1200,
      };
    case "page-number-loop":
      return {
        mode: "page-number-loop",
        maxPages: 10,
        pageParam: pagination.pageParam || "page",
        pageDelayMs: 1200,
      };
    default:
      return {
        mode: "none",
      };
  }
}
