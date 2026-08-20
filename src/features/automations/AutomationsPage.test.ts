import { describe, expect, it } from 'vitest';
import { automationQueryOptions } from './automationQueries';
import { FIRSTSTEP, tint } from '../../components/dashboard/ops/dashboardTokens';
import {
  AUTOMATIONS_TABLE_CAPTION,
  CARD_RESTING_SHADOW_DARK,
  CARD_RESTING_SHADOW_LIGHT,
  DESKTOP_CONTROL_MIN_HEIGHT_PX,
  DESKTOP_TABLE_COLUMNS,
  DESKTOP_TABLE_HEADER_BG,
  DESKTOP_TABLE_ROW_HEIGHT_PX,
  DESKTOP_TABLE_ROW_HOVER_BG,
  DESKTOP_TABLE_ROW_MAX_HEIGHT_PX,
  DESKTOP_TABLE_ROW_MIN_HEIGHT_PX,
  DESKTOP_TABLE_SIZE,
  DESKTOP_TABLE_STATUS_MARKER_PX,
  DETAILS_PANEL_FIELDS,
  FAILABLE_ROW_ACTIONS,
  FILTER_CONTROL_ORDER,
  MOBILE_CARD_BODY_LAYOUT,
  MOBILE_CARD_FOOTER_ACTIONS,
  MOBILE_CARD_HEADER_FIELDS,
  MOBILE_CONTROL_MIN_HEIGHT_PX,
  SAFE_EXTERNAL_LINK_REL,
  SAFE_EXTERNAL_LINK_TARGET,
  SOCKET_INVALIDATE_DEBOUNCE_MS,
  activeFilterPills,
  applyFilterChange,
  attemptMutation,
  automationsLiveRegionMessage,
  buildDeleteConfirmPayload,
  canSubmitAction,
  canSubmitCreateAutomationForm,
  buildCreateAutomationRequest,
  normalizeCreateAutomationStartUrl,
  validateCreateAutomationForm,
  EMPTY_CREATE_AUTOMATION_FORM,
  controlMinHeight,
  detailsToggleAriaLabel,
  failedRowActions,
  filterControlSx,
  filterLayoutForWidth,
  freshnessPillLabel,
  hasActiveFilters,
  latestRunHealthLabel,
  mobileCardDefinitionItems,
  namedActionAriaLabel,
  overflowMenuAriaLabel,
  paginationControlSx,
  pendingActionKey,
  releaseMutation,
  resolveAutomationsContentState,
  retryActionAriaLabel,
  rowRetryHandlerName,
  runActionAriaLabel,
  scheduleChipAriaLabel,
  scheduleDisplayState,
  seeAllTagsAriaLabel,
  shouldFadeUp,
  shouldLiftOnHover,
  shouldShowBackgroundRefreshBar,
  shouldShowRowRetry,
  shouldShowSeeAllTagsChip,
  shouldUseMobileCardList,
  statusMarkerColor,
  visibleTagsForCell,
  SEE_ALL_TAGS_LABEL,
  TAGS_CELL_VISIBLE_COUNT,
  automationsPageRootOverflow,
  automationsTableScrollSx,
  configShowsRawListExtractionEditor,
  configShowsPaginationLimits,
  configStartUrlLocked,
  proxySavedChipLabel,
  overflowMenuActions,
  workspaceAriaBusy,
  workspaceNoLiftHover,
} from './automationsPageBehavior';
import { groupTagsForDisplay } from './AutomationTagsModal';

const queryFlags = (
  overrides: Partial<Parameters<typeof resolveAutomationsContentState>[0]> = {},
) => ({
  isLoading: false,
  isFetching: false,
  isError: false,
  hasLoadedData: true,
  rowCount: 0,
  hasActiveFilters: false,
  ...overrides,
});

describe('automations view states', () => {
  it('shows a first-load skeleton before any data arrives', () => {
    expect(resolveAutomationsContentState(queryFlags({
      isLoading: true,
      hasLoadedData: false,
    }))).toBe('first-load-skeleton');
  });

  it('shows load-error with retry when the first fetch fails', () => {
    expect(resolveAutomationsContentState(queryFlags({
      isError: true,
      hasLoadedData: false,
    }))).toBe('load-error');
  });

  it('treats zero rows with no filters as account-empty', () => {
    expect(resolveAutomationsContentState(queryFlags({
      rowCount: 0,
      hasActiveFilters: false,
    }))).toBe('account-empty');
  });

  it('treats zero rows with active filters as filtered-empty', () => {
    expect(resolveAutomationsContentState(queryFlags({
      rowCount: 0,
      hasActiveFilters: true,
    }))).toBe('filtered-empty');
  });

  it('shows rows when results are present', () => {
    expect(resolveAutomationsContentState(queryFlags({
      rowCount: 8,
    }))).toBe('rows');
  });

  it('does not blank to skeleton while a background refresh is in flight', () => {
    expect(resolveAutomationsContentState(queryFlags({
      isFetching: true,
      hasLoadedData: true,
      rowCount: 4,
    }))).toBe('rows');
    expect(shouldShowBackgroundRefreshBar({
      isFetching: true,
      isLoading: false,
      hasLoadedData: true,
    })).toBe(true);
    expect(shouldShowBackgroundRefreshBar({
      isFetching: true,
      isLoading: true,
      hasLoadedData: false,
    })).toBe(false);
  });
});

describe('filter change retains previous rows', () => {
  it('documents React Query placeholderData so filter changes keep the last rows', () => {
    const options = automationQueryOptions({
      page: 1,
      pageSize: 10,
      q: 'acme',
      id: '',
      tags: [],
      schedule: '',
    });
    expect(typeof options.placeholderData).toBe('function');
    const placeholder = options.placeholderData;
    if (typeof placeholder !== 'function') return;
    const previous = { automations: [{ id: 'kept', name: 'Kept' }] };
    expect(placeholder(previous as never, undefined as never)).toBe(previous);
  });

  it('resets pagination to page 0 in the same filter onChange handler', () => {
    let filter = 'old';
    let page = 4;
    applyFilterChange(
      (next) => { filter = next; },
      (nextPage) => { page = nextPage; },
      'new',
    );
    expect(filter).toBe('new');
    expect(page).toBe(0);
  });

  it('builds removable active-filter pills and knows when filters are active', () => {
    expect(hasActiveFilters({ q: '', id: '', schedule: '', tags: [] })).toBe(false);
    expect(hasActiveFilters({ q: 'acme', id: '', schedule: '', tags: [] })).toBe(true);
    const pills = activeFilterPills({
      q: 'acme',
      id: 'SX1',
      schedule: '0 * * * *',
      scheduleLabel: 'Hourly',
      tags: ['priority'],
    });
    expect(pills.map((pill) => pill.key)).toEqual(['q', 'id', 'schedule', 'tag:priority']);
  });
});

describe('per-row pending actions and duplicate Run', () => {
  it('keys pending state by {automationId, action}', () => {
    expect(pendingActionKey('auto-1', 'run')).toBe('auto-1:run');
    expect(pendingActionKey('auto-1', 'delete')).toBe('auto-1:delete');
  });

  it('rejects a duplicate Run click while the same row is already running', () => {
    const first = attemptMutation({}, 'auto-1', 'run');
    expect(first.accepted).toBe(true);
    if (!first.accepted) return;
    expect(canSubmitAction(first.pending, 'auto-1', 'run')).toBe(false);

    const duplicate = attemptMutation(first.pending, 'auto-1', 'run');
    expect(duplicate.accepted).toBe(false);
    if (duplicate.accepted) return;
    expect(duplicate.reason).toBe('already-pending');
  });

  it('keeps unrelated rows interactive while one row action is pending', () => {
    const started = attemptMutation({}, 'auto-1', 'run');
    expect(started.accepted).toBe(true);
    if (!started.accepted) return;
    expect(canSubmitAction(started.pending, 'auto-2', 'run')).toBe(true);
    expect(canSubmitAction(started.pending, 'auto-1', 'delete')).toBe(true);
  });

  it('clears pending after release so a later Run can submit', () => {
    const started = attemptMutation({}, 'auto-1', 'run');
    expect(started.accepted).toBe(true);
    if (!started.accepted) return;
    const cleared = releaseMutation(started.pending, 'auto-1', 'run');
    expect(canSubmitAction(cleared, 'auto-1', 'run')).toBe(true);
  });

  it('shows inline retry only for the failed row action', () => {
    const errors = { [pendingActionKey('auto-1', 'run')]: 'Failed to run automation' };
    expect(shouldShowRowRetry(errors, 'auto-1', 'run')).toBe(true);
    expect(shouldShowRowRetry(errors, 'auto-1', 'delete')).toBe(false);
    expect(shouldShowRowRetry(errors, 'auto-2', 'run')).toBe(false);
  });

  it('shows inline retry for pause, resume, and delete failures, not Run-only', () => {
    expect([...FAILABLE_ROW_ACTIONS]).toEqual(['run', 'pause-schedule', 'resume-schedule', 'delete']);

    const pauseErrors = { [pendingActionKey('auto-1', 'pause-schedule')]: 'Failed to pause schedule' };
    expect(shouldShowRowRetry(pauseErrors, 'auto-1', 'pause-schedule')).toBe(true);
    expect(failedRowActions(pauseErrors, 'auto-1')).toEqual(['pause-schedule']);
    expect(failedRowActions(pauseErrors, 'auto-2')).toEqual([]);

    const resumeErrors = { [pendingActionKey('auto-1', 'resume-schedule')]: 'Failed to resume schedule' };
    expect(failedRowActions(resumeErrors, 'auto-1')).toEqual(['resume-schedule']);

    const deleteErrors = { [pendingActionKey('auto-1', 'delete')]: 'Failed to delete automation' };
    expect(failedRowActions(deleteErrors, 'auto-1')).toEqual(['delete']);
  });

  it('maps retry clicks to the failed action handler and names the automation', () => {
    expect(rowRetryHandlerName('run')).toBe('onRun');
    expect(rowRetryHandlerName('pause-schedule')).toBe('onPauseSchedule');
    expect(rowRetryHandlerName('resume-schedule')).toBe('onResumeSchedule');
    expect(rowRetryHandlerName('delete')).toBe('onDelete');
    expect(retryActionAriaLabel('run', 'Acme Scout')).toBe('Retry run Acme Scout');
    expect(retryActionAriaLabel('pause-schedule', 'Acme Scout')).toBe('Retry pause schedule Acme Scout');
    expect(retryActionAriaLabel('resume-schedule', 'Acme Scout')).toBe('Retry resume schedule Acme Scout');
    expect(retryActionAriaLabel('delete', 'Acme Scout')).toBe('Retry delete Acme Scout');
  });
});

describe('delete confirmation', () => {
  it('requires confirmation and includes the automation name in the payload', () => {
    const payload = buildDeleteConfirmPayload({ id: 'auto-9', name: 'Acme Scout' });
    expect(payload.requiresConfirmation).toBe(true);
    expect(payload.automationId).toBe('auto-9');
    expect(payload.automationName).toBe('Acme Scout');
    expect(payload.title).toBe('Delete automation?');
    expect(payload.confirmLabel).toBe('Delete everything');
  });
});

describe('live region', () => {
  it('announces skeleton, error, empty, filtered-empty, counts, and background updates', () => {
    expect(automationsLiveRegionMessage({
      contentState: 'first-load-skeleton',
      resultCount: 0,
      isFetching: true,
    })).toBe('Loading automations');
    expect(automationsLiveRegionMessage({
      contentState: 'load-error',
      resultCount: 0,
      isFetching: false,
    })).toMatch(/retry/i);
    expect(automationsLiveRegionMessage({
      contentState: 'account-empty',
      resultCount: 0,
      isFetching: false,
    })).toMatch(/no automations yet/i);
    expect(automationsLiveRegionMessage({
      contentState: 'filtered-empty',
      resultCount: 0,
      isFetching: false,
    })).toMatch(/no automations match/i);
    expect(automationsLiveRegionMessage({
      contentState: 'rows',
      resultCount: 80,
      isFetching: false,
    })).toBe('Showing 80 automations');
    expect(automationsLiveRegionMessage({
      contentState: 'rows',
      resultCount: 80,
      isFetching: true,
    })).toBe('Updating 80 automations');
  });
});

describe('keyboard, a11y, and layout contracts', () => {
  it('includes the automation name on Run and overflow actions', () => {
    expect(runActionAriaLabel('Acme Scout')).toBe('Run Acme Scout');
    expect(overflowMenuAriaLabel('Acme Scout')).toBe('More actions for Acme Scout');
    expect(namedActionAriaLabel('Delete', 'Acme Scout')).toBe('Delete Acme Scout');
    expect(namedActionAriaLabel('Schedule', 'Acme Scout')).toBe('Schedule Acme Scout');
  });

  it('includes the automation name on Show/Hide details and schedule chips', () => {
    expect(detailsToggleAriaLabel(false, 'Acme Scout')).toBe('Show details for Acme Scout');
    expect(detailsToggleAriaLabel(true, 'Acme Scout')).toBe('Hide details for Acme Scout');
    expect(scheduleChipAriaLabel('active', 'Acme Scout')).toBe('Schedule Acme Scout (Active)');
    expect(scheduleChipAriaLabel('paused', 'Acme Scout')).toBe('Schedule Acme Scout (Paused)');
    expect(scheduleChipAriaLabel('manual', 'Acme Scout')).toBe('Schedule Acme Scout (Manual)');
  });

  it('exposes a table caption and aria-busy while fetching', () => {
    expect(AUTOMATIONS_TABLE_CAPTION.toLowerCase()).toContain('automation');
    expect(workspaceAriaBusy(true)).toBe(true);
    expect(workspaceAriaBusy(false)).toBe(false);
  });

  it('uses mobile cards below MUI md 900 and a table at 900+', () => {
    expect(shouldUseMobileCardList(375)).toBe(true);
    expect(shouldUseMobileCardList(899)).toBe(true);
    expect(shouldUseMobileCardList(900)).toBe(false);
  });

  it('lays filters out in one column, two rows, then one row', () => {
    expect(filterLayoutForWidth(375)).toBe('one-column');
    expect(filterLayoutForWidth(800)).toBe('two-row');
    expect(filterLayoutForWidth(1280)).toBe('one-row');
    expect(FILTER_CONTROL_ORDER).toEqual(['search', 'scout-id', 'schedule', 'tags']);
  });

  it('shows all desktop columns inline with compact actions in overflow', () => {
    expect([...DESKTOP_TABLE_COLUMNS]).toEqual([
      'name',
      'id',
      'company',
      'tags',
      'targetUrl',
      'lastRun',
      'rows',
      'nextRun',
      'schedule',
      'actions',
    ]);
    expect([...DETAILS_PANEL_FIELDS]).toEqual([]);
  });

  it('opens the target URL as a safe external link', () => {
    expect(SAFE_EXTERNAL_LINK_TARGET).toBe('_blank');
    expect(SAFE_EXTERNAL_LINK_REL).toBe('noopener noreferrer');
  });

  it('labels latest-run health and schedule states explicitly', () => {
    expect(latestRunHealthLabel('completed')).toMatch(/succeeded/i);
    expect(latestRunHealthLabel('failed')).toMatch(/failed/i);
    expect(latestRunHealthLabel('idle')).toMatch(/no latest run/i);
    expect(scheduleDisplayState({ enabled: true, cron: '0 * * * *' })).toBe('active');
    expect(scheduleDisplayState({ enabled: false, cron: '0 * * * *' })).toBe('paused');
    expect(scheduleDisplayState(null)).toBe('manual');
  });

  it('formats the hero freshness pill as count plus relative update', () => {
    const now = Date.parse('2026-08-18T10:02:00.000Z');
    const updated = Date.parse('2026-08-18T10:00:00.000Z');
    expect(freshnessPillLabel(80, updated, now)).toBe('80 automations · updated 2m ago');
    expect(freshnessPillLabel(1, null, now)).toBe('1 automation');
  });

  it('keeps the 400ms socket invalidate debounce from Task 7', () => {
    expect(SOCKET_INVALIDATE_DEBOUNCE_MS).toBe(400);
  });
});

describe('create automation form flow', () => {
  it('requires name, company, and a valid start URL before submit', () => {
    expect(canSubmitCreateAutomationForm(EMPTY_CREATE_AUTOMATION_FORM, false)).toBe(false);
    const invalid = validateCreateAutomationForm({
      ...EMPTY_CREATE_AUTOMATION_FORM,
      name: 'Acme',
      companyName: 'Acme Corp',
      startUrl: 'https://',
    });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) {
      expect(invalid.fieldErrors.startUrl).toMatch(/valid start url/i);
    }
  });

  it('normalizes start URLs the same way the server expects', () => {
    expect(normalizeCreateAutomationStartUrl('careers.example.com/jobs')).toBe(
      'https://careers.example.com/jobs',
    );
    expect(normalizeCreateAutomationStartUrl('https://example.com/jobs')).toBe(
      'https://example.com/jobs',
    );
  });

  it('builds a trimmed create payload with optional webhook omitted when blank', () => {
    const payload = buildCreateAutomationRequest(
      {
        name: '  Acme  ',
        companyName: ' Acme Corp ',
        startUrl: 'https://example.com/jobs',
        webhookUrl: '   ',
      },
      ['industry:tech'],
      { pagination: { mode: 'none' } },
    );
    expect(payload).toEqual({
      name: 'Acme',
      companyName: 'Acme Corp',
      startUrl: 'https://example.com/jobs',
      webhookUrl: undefined,
      tags: ['industry:tech'],
      config: { pagination: { mode: 'none' } },
    });
  });

  it('rejects invalid webhook URLs before hitting the API', () => {
    const result = validateCreateAutomationForm({
      name: 'Acme',
      companyName: 'Acme Corp',
      startUrl: 'https://example.com/jobs',
      webhookUrl: 'not-a-url',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors.webhookUrl).toBeTruthy();
    }
  });
});

describe('task 9 visual contracts', () => {
  it('does not lift filter or data-workspace cards; resting shadow stays on hover', () => {
    expect(shouldLiftOnHover('kpi')).toBe(true);
    expect(shouldLiftOnHover('filters')).toBe(false);
    expect(shouldLiftOnHover('data-workspace')).toBe(false);
    expect(workspaceNoLiftHover('light')).toEqual({
      transform: 'none',
      boxShadow: CARD_RESTING_SHADOW_LIGHT,
    });
    expect(workspaceNoLiftHover('dark')).toEqual({
      transform: 'none',
      boxShadow: CARD_RESTING_SHADOW_DARK,
    });
    expect(CARD_RESTING_SHADOW_LIGHT).toBe('0 1px 2px rgba(2, 51, 69, 0.04)');
    expect(CARD_RESTING_SHADOW_DARK).toBe('none');
  });

  it('applies fadeUp only to hero and KPI summary cards', () => {
    expect(shouldFadeUp('hero')).toBe(true);
    expect(shouldFadeUp('kpi')).toBe(true);
    expect(shouldFadeUp('filters')).toBe(false);
    expect(shouldFadeUp('data-workspace')).toBe(false);
  });

  it('uses 40px desktop and 44px mobile minimum control height', () => {
    expect(DESKTOP_CONTROL_MIN_HEIGHT_PX).toBe(40);
    expect(MOBILE_CONTROL_MIN_HEIGHT_PX).toBe(44);
    expect(controlMinHeight(false)).toBe(40);
    expect(controlMinHeight(true)).toBe(44);
    expect(filterControlSx(false)['& .MuiInputBase-root'].minHeight).toBe(40);
    expect(filterControlSx(true)['& .MuiInputBase-root'].minHeight).toBe(44);
    expect(paginationControlSx(false)['& .MuiTablePagination-toolbar'].minHeight).toBe(40);
    expect(paginationControlSx(true)['& .MuiIconButton-root'].minHeight).toBe(44);
    expect(paginationControlSx(true)['& .MuiIconButton-root'].minWidth).toBe(44);
  });

  it('keeps a sticky surfaceAlt header, 52–60px rows, pale teal hover, and a 4px status marker', () => {
    expect(DESKTOP_TABLE_HEADER_BG).toBe(FIRSTSTEP.surfaceAlt);
    expect(DESKTOP_TABLE_SIZE).toBe('medium');
    expect(DESKTOP_TABLE_ROW_HEIGHT_PX).toBeGreaterThanOrEqual(DESKTOP_TABLE_ROW_MIN_HEIGHT_PX);
    expect(DESKTOP_TABLE_ROW_HEIGHT_PX).toBeLessThanOrEqual(DESKTOP_TABLE_ROW_MAX_HEIGHT_PX);
    expect(DESKTOP_TABLE_ROW_MIN_HEIGHT_PX).toBe(52);
    expect(DESKTOP_TABLE_ROW_MAX_HEIGHT_PX).toBe(60);
    expect(DESKTOP_TABLE_STATUS_MARKER_PX).toBe(4);
    expect(DESKTOP_TABLE_ROW_HOVER_BG).toBe(tint(FIRSTSTEP.teal, 0.08));
    expect(statusMarkerColor('failed')).toBe(FIRSTSTEP.danger);
    expect(statusMarkerColor('completed')).toBe(FIRSTSTEP.success);
  });

  it('structures mobile cards as name/status header, two-column metadata, and Run+overflow footer', () => {
    expect([...MOBILE_CARD_HEADER_FIELDS]).toEqual(['name', 'status']);
    expect(MOBILE_CARD_BODY_LAYOUT).toBe('two-column-definition-list');
    expect([...MOBILE_CARD_FOOTER_ACTIONS]).toEqual(['run', 'overflow']);
    expect(mobileCardDefinitionItems({
      scoutId: 'SX-1',
      companyName: 'Acme',
      lastRunTime: null,
      rowsExtracted: 12,
    })).toEqual([
      { term: 'Scout ID', value: 'SX-1' },
      { term: 'Company', value: 'Acme' },
      { term: 'Last run', value: 'Never' },
      { term: 'Rows', value: '12' },
    ]);
  });

  it('grows the table with rows and opens extra tags from a See all tags chip', () => {
    expect(TAGS_CELL_VISIBLE_COUNT).toBe(1);
    expect(SEE_ALL_TAGS_LABEL).toBe('See all tags');
    expect(visibleTagsForCell(['role:Engineer', 'industry:tech', 'city:Seattle'])).toEqual(['role:Engineer']);
    expect(shouldShowSeeAllTagsChip(['role:Engineer'])).toBe(false);
    expect(shouldShowSeeAllTagsChip(['role:Engineer', 'industry:tech'])).toBe(true);
    expect(seeAllTagsAriaLabel('Acme Scout')).toBe('See all tags for Acme Scout');
    expect(automationsPageRootOverflow()).toBe('visible');
    expect(automationsTableScrollSx().flex).toBe('none');
    expect(automationsTableScrollSx().overflowY).toBe('visible');
    expect(automationsTableScrollSx().overflowX).toBe('auto');
    expect(automationsTableScrollSx().scrollbarWidth).toBe('none');
    expect(automationsTableScrollSx().maxHeight).toBeUndefined();
    expect(groupTagsForDisplay(['role:Engineer', 'industry:tech', 'unknown'])).toEqual([
      { label: 'Job Title / Role', tags: ['role:Engineer'] },
      { label: 'Industry', tags: ['industry:tech'] },
      { label: 'Other', tags: ['unknown'] },
    ]);
  });
});

describe('automations configure and overflow', () => {
  it('keeps configure and view data in-place and omits copy target URL from overflow', () => {
    expect([...overflowMenuActions]).toEqual([
      'schedule',
      'view-data',
      'run-history',
      'configure',
      'last-run',
      'copy-scout-id',
      'delete',
    ]);
    expect(overflowMenuActions).not.toContain('copy-target-url');
  });

  it('locks start URL and hides raw list-extraction editors so recorded selectors cannot break', () => {
    expect(configStartUrlLocked()).toBe(true);
    expect(configShowsRawListExtractionEditor()).toBe(false);
    expect(configShowsPaginationLimits()).toBe(true);
    expect(proxySavedChipLabel(true)).toBe('Saved (hidden after reload)');
    expect(proxySavedChipLabel(false)).toBeNull();
  });
});
