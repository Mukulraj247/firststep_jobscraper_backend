// ── Message Types ──
// All messages between content script <-> background <-> side panel

// Background -> Content Script
export const MSG = {
  // List extraction
  START_LIST_HOVER: 'maxun:start-list-hover',
  STOP_LIST_HOVER: 'maxun:stop-list-hover',
  EXTRACT_PAGE: 'maxun:extract-page',
  CLICK_NEXT: 'maxun:click-next',
  SCROLL_DOWN: 'maxun:scroll-down',
  /** Background -> Content: begin long-running auto-scroll session */
  AUTOSCROLL_START: 'maxun:autoscroll-start',
  /** Background -> Content: stop the running auto-scroll session */
  AUTOSCROLL_STOP: 'maxun:autoscroll-stop',
  /** Content -> Background: incremental auto-scroll progress + final payload */
  AUTOSCROLL_PROGRESS: 'maxun:autoscroll-progress',
  GOTO_URL: 'maxun:goto-url',
  CLEAR_HIGHLIGHTS: 'maxun:clear-highlights',
  PICK_ELEMENT: 'maxun:pick-element',
  ELEMENT_PICKED: 'maxun:element-picked',

  // Table extraction
  DETECT_TABLES: 'maxun:detect-tables',
  SELECT_TABLE: 'maxun:select-table',
  EXTRACT_TABLE: 'maxun:extract-table',

  // Text extraction
  EXTRACT_TEXT: 'maxun:extract-text',

  // Content Script -> Background
  LIST_HOVERED: 'maxun:list-hovered',
  LIST_SELECTED: 'maxun:list-selected',
  EXTRACTION_RESULT: 'maxun:extraction-result',
  EXTRACTION_PROGRESS: 'maxun:extraction-progress',
  PAGINATION_DONE: 'maxun:pagination-done',
  TABLES_DETECTED: 'maxun:tables-detected',
  TABLE_EXTRACTED: 'maxun:table-extracted',
  TEXT_EXTRACTED: 'maxun:text-extracted',

  // Side Panel -> Background
  SET_TOOL: 'maxun:set-tool',
  START_LIST_MODE: 'maxun:start-list-mode',
  STOP_SELECTION: 'maxun:stop-selection',
  UPDATE_FIELDS: 'maxun:update-fields',
  UPDATE_PAGINATION: 'maxun:update-pagination',
  /** Side panel → background: update per-automation metadata (sectorIndustry, f500). */
  UPDATE_ROW_CONTEXT: 'maxun:update-row-context',
  RUN_EXTRACTION: 'maxun:run-extraction',
  CANCEL_EXTRACTION: 'maxun:cancel-extraction',
  OPEN_DATA_TABLE: 'maxun:open-data-table',
  EXPORT_CSV: 'maxun:export-csv',
  EXPORT_JSON: 'maxun:export-json',
  SAVE_TO_BACKEND: 'maxun:save-to-backend',
  DETECT_TABLES_CMD: 'maxun:detect-tables-cmd',
  EXTRACT_TABLE_CMD: 'maxun:extract-table-cmd',
  EXTRACT_TEXT_CMD: 'maxun:extract-text-cmd',
  RESET_STATE: 'maxun:reset-state',
  SET_EXTENSION_SETTINGS: 'maxun:set-extension-settings',
  SET_SCHEDULE: 'maxun:set-schedule',
  /** Side panel → background: update persisted list cloud schedule draft. */
  UPDATE_CLOUD_SCHEDULE_DRAFT: 'maxun:update-cloud-schedule-draft',
  /** Side panel → background: combined save-or-update automation + save-schedule. */
  SEND_AND_SCHEDULE: 'maxun:send-and-schedule',
  /** Side panel → background: fetch backend status (last/next run, schedule) for a saved automation. */
  GET_AUTOMATION_STATUS: 'maxun:get-automation-status',
  /** Side panel → background: trigger an on-demand run. */
  RUN_AUTOMATION_NOW: 'maxun:run-automation-now',
  /** Content script → background: apply API base from trusted web page postMessage */
  APPLY_BACKEND_FROM_WEB: 'maxun:apply-backend-from-web',

  // Background -> Side Panel
  STATE_UPDATED: 'maxun:state-updated',
  ERROR: 'maxun:error',

  // General
  GET_STATE: 'maxun:get-state',
  PING: 'maxun:ping',
} as const;

export type MessageType = (typeof MSG)[keyof typeof MSG];

export interface ExtensionMessage {
  type: MessageType;
  payload?: any;
}
