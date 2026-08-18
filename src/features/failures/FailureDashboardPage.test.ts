import { describe, expect, it } from 'vitest';
import { failureQueryOptions } from './failureQueries';
import { FIRSTSTEP, tint } from '../../components/dashboard/ops/dashboardTokens';
import {
  CARD_RESTING_SHADOW_DARK,
  CARD_RESTING_SHADOW_LIGHT,
  DESKTOP_CONTROL_MIN_HEIGHT_PX,
  DEFAULT_FAILURE_STATUS_FILTER,
  DESKTOP_TABLE_COLUMNS,
  DESKTOP_TABLE_HEADER_BG,
  DESKTOP_TABLE_ROW_HEIGHT_PX,
  DESKTOP_TABLE_ROW_HOVER_BG,
  DESKTOP_TABLE_ROW_MAX_HEIGHT_PX,
  DESKTOP_TABLE_ROW_MIN_HEIGHT_PX,
  DESKTOP_TABLE_SIZE,
  DESKTOP_TABLE_STATUS_MARKER_PX,
  ERROR_SUMMARY_LINE_CLAMP,
  FAILURES_HAS_DESTRUCTIVE_PRIMARY_CTA,
  FAILURES_TABLE_CAPTION,
  FAILURE_REASON_OPTIONS,
  failureWindowSelectLabel,
  FAILURE_WINDOWS,
  FILTER_CONTROL_IDS,
  FILTER_CONTROL_ORDER,
  FILTER_LABEL_IDS,
  HERO_OVERLINE,
  HERO_REFRESH_VARIANT,
  HERO_TITLE,
  MOBILE_CARD_BODY_SECTIONS,
  MOBILE_CARD_FOOTER_ACTIONS,
  MOBILE_CARD_HEADER_FIELDS,
  MOBILE_CONTROL_MIN_HEIGHT_PX,
  REASON_SUMMARY_ITEMS,
  RETRY_CONFIRM_BODY,
  RETRY_CONFIRM_TITLE,
  SOCKET_INVALIDATE_DEBOUNCE_MS,
  activeFilterPills,
  applyFilterChange,
  attemptMutation,
  beginRetryAttempt,
  canSubmitAction,
  clampPage,
  controlMinHeight,
  detailsActionAriaLabel,
  failureReasonLabel,
  failuresLiveRegionMessage,
  filterControlSx,
  filterLayoutForWidth,
  hasActiveFilters,
  isDangerAccentAllowed,
  labelledSelectContract,
  normalizeReasonCounts,
  paginationControlSx,
  parseRetryConflict,
  pendingActionKey,
  failuresTableScrollSx,
  reasonSelectAriaLabel,
  reasonSelectId,
  reasonSelectLabelId,
  reasonSummaryLayoutForWidth,
  releaseMutation,
  resolveFailuresContentState,
  retryActionAriaLabel,
  retrySuccessHref,
  retrySuccessMessage,
  rowStatusLabel,
  shouldFadeUp,
  shouldLiftOnHover,
  shouldShowBackgroundRefreshBar,
  shouldUseMobileCardList,
  statusMarkerColor,
  windowStatusPillLabel,
  workspaceAriaBusy,
  workspaceNoLiftHover,
} from './failuresPageBehavior';

const queryFlags = (
  overrides: Partial<Parameters<typeof resolveFailuresContentState>[0]> = {},
) => ({
  isLoading: false,
  isFetching: false,
  isError: false,
  hasLoadedData: true,
  rowCount: 0,
  hasActiveFilters: false,
  ...overrides,
});

describe('normalized reason counts', () => {
  it('fills missing codes with 0 and sums All from canonical reasons only', () => {
    const normalized = normalizeReasonCounts({
      captcha: 4,
      timeout: 2,
      leftover: 99,
    });
    expect(normalized.byCode).toEqual({
      layout_change: 0,
      captcha: 4,
      browser_closed: 0,
      navigation_error: 0,
      timeout: 2,
      circuit_open: 0,
      unknown: 0,
    });
    expect(normalized.all).toBe(6);
    expect(normalized.byCode).not.toHaveProperty('leftover');
  });

  it('uses human labels, not internal codes', () => {
    expect(FAILURE_REASON_OPTIONS.map((option) => option.label)).toEqual([
      'Layout change',
      'CAPTCHA',
      'Browser closed',
      'Navigation',
      'Timeout',
      'Host circuit',
      'Unknown',
    ]);
    expect(failureReasonLabel('browser_closed')).toBe('Browser closed');
    expect(failureReasonLabel('circuit_open')).toBe('Host circuit');
    expect(failureReasonLabel('navigation_error')).toBe('Navigation');
    expect(REASON_SUMMARY_ITEMS.map((item) => item.label)).toEqual([
      'All',
      'Layout change',
      'CAPTCHA',
      'Browser closed',
      'Navigation',
      'Timeout',
      'Host circuit',
      'Unknown',
    ]);
  });
});

describe('labelled selects', () => {
  it('connects every filter InputLabel to its Select', () => {
    expect(labelledSelectContract('status')).toEqual({
      id: FILTER_CONTROL_IDS.status,
      labelId: FILTER_LABEL_IDS.status,
      label: 'Status',
    });
    expect(labelledSelectContract('reason')).toEqual({
      id: FILTER_CONTROL_IDS.reason,
      labelId: FILTER_LABEL_IDS.reason,
      label: 'Failure reason',
    });
    expect(labelledSelectContract('anomaly')).toEqual({
      id: FILTER_CONTROL_IDS.anomaly,
      labelId: FILTER_LABEL_IDS.anomaly,
      label: 'Anomaly',
    });
    expect(labelledSelectContract('window')).toEqual({
      id: FILTER_CONTROL_IDS.window,
      labelId: FILTER_LABEL_IDS.window,
      label: 'Window',
    });
    expect(FILTER_CONTROL_IDS.search).toBe('failures-filter-search');
  });

  it('uniquely labels each row reason control', () => {
    expect(reasonSelectId('run-1')).toBe('failure-reason-run-1');
    expect(reasonSelectLabelId('run-1')).toBe('failure-reason-run-1-label');
    expect(reasonSelectAriaLabel('Acme Scout', 'run-1')).toBe(
      'Failure reason for Acme Scout (run-1)',
    );
    expect(reasonSelectAriaLabel('Acme Scout', 'run-2')).not.toBe(
      reasonSelectAriaLabel('Acme Scout', 'run-1'),
    );
  });
});

describe('page clamping after mutation', () => {
  it('clamps to the last valid page when totals shrink', () => {
    expect(clampPage(4, 25, 10)).toBe(2);
    expect(clampPage(2, 10, 10)).toBe(0);
    expect(clampPage(1, 25, 10)).toBe(1);
    expect(clampPage(3, 0, 10)).toBe(0);
  });
});

describe('retry idempotency and active-run conflict', () => {
  it('keys pending state by {runId, action} and rejects duplicate Retry clicks', () => {
    expect(pendingActionKey('run-1', 'retry')).toBe('run-1:retry');
    const first = attemptMutation({}, 'run-1', 'retry');
    expect(first.accepted).toBe(true);
    if (!first.accepted) return;
    expect(canSubmitAction(first.pending, 'run-1', 'retry')).toBe(false);

    const duplicate = attemptMutation(first.pending, 'run-1', 'retry');
    expect(duplicate.accepted).toBe(false);
    if (duplicate.accepted) return;
    expect(duplicate.reason).toBe('already-pending');
    expect(canSubmitAction(first.pending, 'run-2', 'retry')).toBe(true);
    expect(canSubmitAction(first.pending, 'run-1', 'update-reason')).toBe(true);
  });

  it('issues one idempotency key per accepted retry and none for duplicates', () => {
    const keys: string[] = [];
    const createKey = () => {
      const key = `key-${keys.length + 1}`;
      keys.push(key);
      return key;
    };
    const first = beginRetryAttempt({}, 'run-1', createKey);
    expect(first.accepted).toBe(true);
    if (!first.accepted) return;
    expect(first.idempotencyKey).toBe('key-1');
    expect(keys).toEqual(['key-1']);

    const duplicate = beginRetryAttempt(first.pending, 'run-1', createKey);
    expect(duplicate.accepted).toBe(false);
    expect(keys).toEqual(['key-1']);

    const released = releaseMutation(first.pending, 'run-1', 'retry');
    const second = beginRetryAttempt(released, 'run-1', createKey);
    expect(second.accepted).toBe(true);
    if (!second.accepted) return;
    expect(second.idempotencyKey).toBe('key-2');
  });

  it('explains that retry creates a new run from current automation config', () => {
    expect(RETRY_CONFIRM_TITLE).toMatch(/retry/i);
    expect(RETRY_CONFIRM_BODY.toLowerCase()).toContain('new run');
    expect(RETRY_CONFIRM_BODY.toLowerCase()).toContain('current automation');
  });

  it('on 409 shows the active run and a details link', () => {
    const conflict = parseRetryConflict({
      response: {
        status: 409,
        data: {
          code: 'AUTOMATION_RUN_ACTIVE',
          error: 'This automation already has an active run',
          activeRunId: 'run-active-9',
        },
      },
    });
    expect(conflict.isConflict).toBe(true);
    expect(conflict.activeRunId).toBe('run-active-9');
    expect(conflict.href).toBe('/run/run-active-9');
    expect(conflict.message.toLowerCase()).toContain('active run');
  });

  it('on success names the new run and retry lineage', () => {
    expect(retrySuccessMessage({
      runId: 'run-new',
      retryOfRunId: 'run-old',
      retrySequence: 2,
    }, 'Acme Scout')).toMatch(/run-new/);
    expect(retrySuccessMessage({
      runId: 'run-new',
      retryOfRunId: 'run-old',
      retrySequence: 2,
    }, 'Acme Scout')).toMatch(/run-old/);
    expect(retrySuccessHref('run-new')).toBe('/run/run-new');
  });
});

describe('stale-response cancellation and load errors', () => {
  it('keeps previous rows via placeholderData and resets page in the same filter handler', () => {
    const options = failureQueryOptions({
      page: 1,
      pageSize: 25,
      q: 'checkout',
      id: '',
      status: DEFAULT_FAILURE_STATUS_FILTER,
      anomaly: '',
      reason: '',
      timeWindow: '1h',
    });
    expect(typeof options.placeholderData).toBe('function');
    const placeholder = options.placeholderData;
    if (typeof placeholder !== 'function') return;
    const previous = { runs: [{ runId: 'kept' }], pagination: { page: 1, limit: 25, total: 1, totalPages: 1 } };
    expect(placeholder(previous as never, undefined as never)).toBe(previous);

    let reason = '';
    let page = 4;
    applyFilterChange(
      (next) => { reason = next; },
      (nextPage) => { page = nextPage; },
      'captcha',
    );
    expect(reason).toBe('captcha');
    expect(page).toBe(0);
  });

  it('shows first-load skeleton, load-error with retry, and empty variants', () => {
    expect(resolveFailuresContentState(queryFlags({
      isLoading: true,
      hasLoadedData: false,
    }))).toBe('first-load-skeleton');
    expect(resolveFailuresContentState(queryFlags({
      isError: true,
      hasLoadedData: false,
    }))).toBe('load-error');
    expect(resolveFailuresContentState(queryFlags({
      rowCount: 0,
      hasActiveFilters: false,
    }))).toBe('account-empty');
    expect(resolveFailuresContentState(queryFlags({
      rowCount: 0,
      hasActiveFilters: true,
    }))).toBe('filtered-empty');
    expect(resolveFailuresContentState(queryFlags({
      rowCount: 3,
    }))).toBe('rows');
    expect(shouldShowBackgroundRefreshBar({
      isFetching: true,
      isLoading: false,
      hasLoadedData: true,
    })).toBe(true);
  });

  it('keeps the 400ms socket invalidate debounce from Task 7', () => {
    expect(SOCKET_INVALIDATE_DEBOUNCE_MS).toBe(400);
  });
});

describe('live region, a11y, and layout contracts', () => {
  it('announces counts, errors, and empty states', () => {
    expect(failuresLiveRegionMessage({
      contentState: 'first-load-skeleton',
      resultCount: 0,
      isFetching: true,
    })).toBe('Loading failed runs');
    expect(failuresLiveRegionMessage({
      contentState: 'load-error',
      resultCount: 0,
      isFetching: false,
    })).toMatch(/retry/i);
    expect(failuresLiveRegionMessage({
      contentState: 'account-empty',
      resultCount: 0,
      isFetching: false,
    })).toMatch(/no failed runs/i);
    expect(failuresLiveRegionMessage({
      contentState: 'filtered-empty',
      resultCount: 0,
      isFetching: false,
    })).toMatch(/no failed runs match/i);
    expect(failuresLiveRegionMessage({
      contentState: 'rows',
      resultCount: 12,
      isFetching: false,
    })).toBe('Showing 12 failed runs');
    expect(failuresLiveRegionMessage({
      contentState: 'rows',
      resultCount: 12,
      isFetching: true,
    })).toBe('Updating 12 failed runs');
  });

  it('exposes a table caption, unique actions, and aria-busy while fetching', () => {
    expect(FAILURES_TABLE_CAPTION.toLowerCase()).toContain('fail');
    expect(workspaceAriaBusy(true)).toBe(true);
    expect(detailsActionAriaLabel('Acme Scout')).toBe('Details for Acme Scout');
    expect(retryActionAriaLabel('Acme Scout')).toBe('Retry Acme Scout');
  });

  it('uses mobile cards below MUI md 900 and a contained table at 900+', () => {
    expect(shouldUseMobileCardList(375)).toBe(true);
    expect(shouldUseMobileCardList(899)).toBe(true);
    expect(shouldUseMobileCardList(900)).toBe(false);
  });

  it('wraps reason summary on tablet and uses two columns on mobile', () => {
    expect(reasonSummaryLayoutForWidth(375)).toBe('two-column');
    expect(reasonSummaryLayoutForWidth(800)).toBe('wrap');
    expect(reasonSummaryLayoutForWidth(1280)).toBe('wrap');
  });

  it('lays filters out in one column, two rows, then one row', () => {
    expect(filterLayoutForWidth(375)).toBe('one-column');
    expect(filterLayoutForWidth(800)).toBe('two-row');
    expect(filterLayoutForWidth(1280)).toBe('one-row');
    expect([...FILTER_CONTROL_ORDER]).toEqual(['search', 'status', 'reason', 'anomaly']);
  });

  it('keeps desktop columns and parks finished time plus diagnostics behind Details', () => {
    expect([...DESKTOP_TABLE_COLUMNS]).toEqual([
      'automation',
      'status',
      'reason',
      'error',
      'anomaly',
      'timing',
      'attempts',
      'actions',
    ]);
    expect(ERROR_SUMMARY_LINE_CLAMP).toBe(2);
    expect(rowStatusLabel('failed')).toBe('Failed');
    expect(rowStatusLabel('dead')).toBe('Dead');
    expect(rowStatusLabel('aborted')).toBe('Aborted');
  });

  it('structures mobile cards as automation/status, reason/error, timing/attempts, Details+Retry', () => {
    expect([...MOBILE_CARD_HEADER_FIELDS]).toEqual(['automation', 'status']);
    expect([...MOBILE_CARD_BODY_SECTIONS]).toEqual(['reason-error', 'timing-attempts']);
    expect([...MOBILE_CARD_FOOTER_ACTIONS]).toEqual(['details', 'retry']);
  });

  it('formats the selected-window status pill and keeps Refresh secondary', () => {
    expect(HERO_OVERLINE).toBe('Run reliability');
    expect(HERO_TITLE).toBe('Failures');
    expect(windowStatusPillLabel(12, '1h')).toBe('12 failures · last 1h');
    expect(windowStatusPillLabel(1, '15m')).toBe('1 failure · last 15m');
    expect(windowStatusPillLabel(5, 'all')).toBe('5 failures · all time');
    expect(failureWindowSelectLabel('all')).toBe('All');
    expect(failureWindowSelectLabel('1h')).toBe('Last 1h');
    expect(FAILURES_HAS_DESTRUCTIVE_PRIMARY_CTA).toBe(false);
    expect(HERO_REFRESH_VARIANT).toBe('outlined');
    expect([...FAILURE_WINDOWS]).toEqual(['15m', '30m', '1h', '3h', '6h', '24h', 'all']);
  });

  it('restrains danger to terminal count, row status, and Retry confirmation', () => {
    expect(isDangerAccentAllowed('hero')).toBe(false);
    expect(isDangerAccentAllowed('page-background')).toBe(false);
    expect(isDangerAccentAllowed('terminal-count')).toBe(true);
    expect(isDangerAccentAllowed('row-status')).toBe(true);
    expect(isDangerAccentAllowed('retry-confirm')).toBe(true);
  });

  it('builds removable active-filter pills', () => {
    expect(hasActiveFilters({
      q: '',
      status: DEFAULT_FAILURE_STATUS_FILTER,
      reason: '',
      anomaly: '',
    })).toBe(false);
    expect(hasActiveFilters({
      q: 'checkout',
      status: DEFAULT_FAILURE_STATUS_FILTER,
      reason: '',
      anomaly: '',
    })).toBe(true);
    const pills = activeFilterPills({
      q: 'checkout',
      status: 'failed',
      statusLabel: 'Failed only',
      reason: 'captcha',
      reasonLabel: 'CAPTCHA',
      anomaly: 'zero_rows',
      anomalyLabel: 'Zero rows',
    });
    expect(pills.map((pill) => pill.key)).toEqual(['q', 'status', 'reason', 'anomaly']);
  });
});

describe('task 9 visual contracts mirrored on failures', () => {
  it('does not lift filter or data-workspace cards; resting shadow stays on hover', () => {
    expect(shouldLiftOnHover('reason-summary')).toBe(true);
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
  });

  it('applies fadeUp only to hero and reason-summary cards', () => {
    expect(shouldFadeUp('hero')).toBe(true);
    expect(shouldFadeUp('reason-summary')).toBe(true);
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

  it('keeps a sticky surfaceAlt header, 56–64px rows, and pale teal hover', () => {
    expect(DESKTOP_TABLE_HEADER_BG).toBe(FIRSTSTEP.surfaceAlt);
    expect(DESKTOP_TABLE_SIZE).toBe('medium');
    expect(DESKTOP_TABLE_ROW_HEIGHT_PX).toBeGreaterThanOrEqual(DESKTOP_TABLE_ROW_MIN_HEIGHT_PX);
    expect(DESKTOP_TABLE_ROW_HEIGHT_PX).toBeLessThanOrEqual(DESKTOP_TABLE_ROW_MAX_HEIGHT_PX);
    expect(DESKTOP_TABLE_ROW_MIN_HEIGHT_PX).toBe(56);
    expect(DESKTOP_TABLE_ROW_MAX_HEIGHT_PX).toBe(64);
    expect(DESKTOP_TABLE_STATUS_MARKER_PX).toBe(4);
    expect(DESKTOP_TABLE_ROW_HOVER_BG).toBe(tint(FIRSTSTEP.teal, 0.08));
    expect(statusMarkerColor('failed')).toBe(FIRSTSTEP.danger);
    expect(statusMarkerColor('dead')).toBe(FIRSTSTEP.danger);
    expect(statusMarkerColor('aborted')).toBe(FIRSTSTEP.danger);
  });

  it('grows the failures table with rows instead of locking a compact inner viewport', () => {
    expect(failuresTableScrollSx().flex).toBe('none');
    expect(failuresTableScrollSx().overflowY).toBe('visible');
    expect(failuresTableScrollSx().overflowX).toBe('auto');
    expect(failuresTableScrollSx().scrollbarWidth).toBe('none');
    expect(failuresTableScrollSx().maxHeight).toBeUndefined();
  });
});
