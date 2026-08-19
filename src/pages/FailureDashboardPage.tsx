import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  LinearProgress,
  Paper,
  TablePagination,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  retryRun,
  updateRunFailureReason,
} from '../api/automation';
import { generateUUID } from '../helpers/uuid';
import { useGlobalInfoStore } from '../context/globalInfo';
import { useSocketStore } from '../context/socket';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  failureQueryKeys,
  failureQueryOptions,
} from '../features/failures/failureQueries';
import { cardSx, FIRSTSTEP } from '../components/dashboard/ops/dashboardTokens';
import { FailuresHero } from '../features/failures/FailuresHero';
import { FailureReasonSummary } from '../features/failures/FailureReasonSummary';
import { FailureFilters } from '../features/failures/FailureFilters';
import { FailureTable } from '../features/failures/FailureTable';
import { FailureCardList } from '../features/failures/FailureCardList';
import { FailureEmptyState } from '../features/failures/FailureEmptyState';
import { FailureSkeleton } from '../features/failures/FailureSkeleton';
import {
  RetryConfirmDialog,
  type FailureRowHandlers,
  type FailureRun,
} from '../features/failures/FailureRowActions';
import {
  DEFAULT_FAILURE_STATUS_FILTER,
  SOCKET_INVALIDATE_DEBOUNCE_MS,
  applyFilterChange,
  attemptMutation,
  clampPage,
  failuresLiveRegionMessage,
  hasActiveFilters,
  paginationControlSx,
  parseFailureDashboardSearch,
  parseRetryConflict,
  pendingActionKey,
  releaseMutation,
  resolveFailuresContentState,
  retrySuccessHref,
  retrySuccessMessage,
  runDisplayName,
  runIdentity,
  shouldShowBackgroundRefreshBar,
  workspaceAriaBusy,
  workspaceNoLiftHoverSx,
  type FailureMutationAction,
  type FailureTimeWindow,
  type PendingActions,
  type RowActionErrors,
} from '../features/failures/failuresPageBehavior';

type RetryNotice = {
  kind: 'success' | 'conflict';
  message: string;
  href: string | null;
  linkLabel: string;
} | null;

export const FailureDashboardPage = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const linkedRange = parseFailureDashboardSearch(searchParams);
  const queryClient = useQueryClient();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'), { noSsr: true });
  const { notify } = useGlobalInfoStore();
  const { queueSocket } = useSocketStore();
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [statusFilter, setStatusFilter] = useState<
    typeof DEFAULT_FAILURE_STATUS_FILTER | 'failed,dead' | 'failed' | 'dead' | 'aborted'
  >(DEFAULT_FAILURE_STATUS_FILTER);
  const [anomalyFilter, setAnomalyFilter] = useState('');
  const [reasonFilter, setReasonFilter] = useState('');
  const [window, setWindow] = useState<FailureTimeWindow>(linkedRange.timeWindow);
  const [rangeFrom, setRangeFrom] = useState(linkedRange.from || '');
  const [rangeTo, setRangeTo] = useState(linkedRange.to || '');
  const [q, setQ] = useState('');
  const [qDebounced, setQDebounced] = useState('');
  const [pendingActions, setPendingActions] = useState<PendingActions>({});
  const [rowActionErrors, setRowActionErrors] = useState<RowActionErrors>({});
  const [retryTarget, setRetryTarget] = useState<FailureRun | null>(null);
  const [retryNotice, setRetryNotice] = useState<RetryNotice>(null);

  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const {
    data: failureData,
    error: failureError,
    isLoading,
    isFetching,
    refetch: refetchFailures,
  } = useQuery(failureQueryOptions({
    page: page + 1,
    pageSize: rowsPerPage,
    q: qDebounced,
    id: '',
    status: statusFilter,
    anomaly: anomalyFilter,
    reason: reasonFilter,
    timeWindow: window,
    ...(rangeFrom && rangeTo ? { from: rangeFrom, to: rangeTo } : {}),
  }));
  const runs: FailureRun[] = failureData?.runs ?? [];
  const total = failureData?.pagination?.total ?? 0;
  const countsByReason = failureData?.countsByReason ?? {};
  const isRefreshing = isFetching && !isLoading;
  const filtersActive = hasActiveFilters({
    q: qDebounced,
    status: statusFilter,
    reason: reasonFilter,
    anomaly: anomalyFilter,
  });
  const hasLoadedData = Boolean(failureData);
  const contentState = resolveFailuresContentState({
    isLoading,
    isFetching,
    isError: Boolean(failureError),
    hasLoadedData,
    rowCount: runs.length,
    hasActiveFilters: filtersActive,
  });
  const showRefreshBar = shouldShowBackgroundRefreshBar({
    isFetching,
    isLoading,
    hasLoadedData,
  });

  useEffect(() => {
    if (!failureError || (failureError as { response?: { status?: number } })?.response?.status === 429) return;
    notify(
      'error',
      (failureError as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to load failed runs',
    );
  }, [failureError, notify]);

  const load = useCallback(async () => {
    await refetchFailures();
  }, [refetchFailures]);

  useEffect(() => {
    if (isLoading) return;
    const next = clampPage(page, total, rowsPerPage);
    if (next !== page) setPage(next);
  }, [isLoading, total, rowsPerPage, page]);

  useEffect(() => {
    if (!queueSocket) return;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: failureQueryKeys.all });
      }, SOCKET_INVALIDATE_DEBOUNCE_MS);
    };
    queueSocket.on('run-completed', refresh);
    return () => {
      clearTimeout(timeout);
      queueSocket.off('run-completed', refresh);
    };
  }, [queueSocket, queryClient]);

  const runGuardedMutation = useCallback(async (
    run: FailureRun,
    action: FailureMutationAction,
    work: () => Promise<void>,
    fallbackMessage: string,
  ) => {
    const runId = runIdentity(run);
    if (!runId) {
      notify('error', 'Missing run id');
      return;
    }
    let accepted = false;
    setPendingActions((prev) => {
      const attempt = attemptMutation(prev, runId, action);
      accepted = attempt.accepted;
      return attempt.accepted ? attempt.pending : prev;
    });
    if (!accepted) return;
    setRowActionErrors((prev) => {
      const next = { ...prev };
      delete next[pendingActionKey(runId, action)];
      return next;
    });
    try {
      await work();
    } catch (error: unknown) {
      const conflict = parseRetryConflict(error);
      const message = conflict.isConflict
        ? conflict.message
        : (error as { response?: { data?: { error?: string } } })?.response?.data?.error || fallbackMessage;
      notify('error', message);
      setRowActionErrors((prev) => ({
        ...prev,
        [pendingActionKey(runId, action)]: message,
      }));
      if (conflict.isConflict) {
        setRetryNotice({
          kind: 'conflict',
          message: conflict.message,
          href: conflict.href,
          linkLabel: conflict.activeRunId ? `Open active run ${conflict.activeRunId}` : 'Open active run',
        });
      }
    } finally {
      setPendingActions((prev) => releaseMutation(prev, runId, action));
    }
  }, [notify]);

  const handleRetryConfirm = async () => {
    if (!retryTarget) return;
    const run = retryTarget;
    const runId = runIdentity(run);
    const name = runDisplayName(run);
    await runGuardedMutation(run, 'retry', async () => {
      const result = await retryRun(runId, generateUUID());
      const message = retrySuccessMessage(result, name);
      notify('success', message);
      setRetryNotice({
        kind: 'success',
        message,
        href: result?.runId ? retrySuccessHref(result.runId) : null,
        linkLabel: result?.runId ? `Open new run ${result.runId}` : 'Open new run',
      });
      setRetryTarget(null);
      await load();
    }, 'Failed to retry run');
  };

  const handleReasonOverride = (run: FailureRun, nextReason: string) => {
    const current = run.failureReason || '';
    if (nextReason === current) return;
    void runGuardedMutation(run, 'update-reason', async () => {
      await updateRunFailureReason(runIdentity(run), {
        failureReason: nextReason || null,
        confirmed: false,
      });
      notify('success', 'Failure reason updated');
      await load();
    }, 'Failed to update failure reason');
  };

  const handleClearFilters = () => {
    setQ('');
    setQDebounced('');
    setStatusFilter(DEFAULT_FAILURE_STATUS_FILTER);
    setReasonFilter('');
    setAnomalyFilter('');
    setPage(0);
  };

  const handlers: FailureRowHandlers = {
    onDetails: (run) => {
      const runId = runIdentity(run);
      if (runId) navigate(`/run/${runId}`);
    },
    onRetry: setRetryTarget,
    onReasonChange: handleReasonOverride,
  };

  const liveMessage = failuresLiveRegionMessage({
    contentState,
    resultCount: total,
    isFetching,
  });
  const retryPending = Boolean(
    retryTarget && pendingActions[pendingActionKey(runIdentity(retryTarget), 'retry')],
  );

  return (
    <Box
      sx={{
        p: { xs: 2, md: 3 },
        minHeight: '100%',
        bgcolor: (muiTheme) => (muiTheme.palette.mode === 'dark' ? '#000' : FIRSTSTEP.surface),
      }}
    >
      <FailuresHero
        failureCount={total}
        window={window}
        isRefreshing={isRefreshing}
        isLoading={isLoading}
        isMobile={isMobile}
        onWindowChange={(next) => {
          setRangeFrom('');
          setRangeTo('');
          applyFilterChange(setWindow, setPage, next);
        }}
        onRefresh={() => { void load(); }}
      />

      <Box
        component="span"
        aria-live="polite"
        aria-atomic="true"
        sx={{
          position: 'absolute',
          width: 1,
          height: 1,
          overflow: 'hidden',
          clip: 'rect(0 0 0 0)',
        }}
      >
        {liveMessage}
      </Box>

      {contentState === 'first-load-skeleton' ? (
        <FailureSkeleton />
      ) : (
        <>
          {contentState !== 'load-error' ? (
            <FailureReasonSummary
              countsByReason={countsByReason}
              selectedReason={reasonFilter}
              onSelect={(reason) => applyFilterChange(setReasonFilter, setPage, reason)}
            />
          ) : null}

          <FailureFilters
            q={q}
            status={statusFilter}
            reason={reasonFilter}
            anomaly={anomalyFilter}
            resultCount={total}
            onSearchChange={(value) => applyFilterChange(setQ, setPage, value)}
            onStatusChange={(value) => applyFilterChange(
              (next) => setStatusFilter(next as typeof statusFilter),
              setPage,
              value,
            )}
            onReasonChange={(value) => applyFilterChange(setReasonFilter, setPage, value)}
            onAnomalyChange={(value) => applyFilterChange(setAnomalyFilter, setPage, value)}
            onClearAll={handleClearFilters}
          />

          {retryNotice ? (
            <Alert
              severity={retryNotice.kind === 'conflict' ? 'warning' : 'success'}
              onClose={() => setRetryNotice(null)}
              sx={{ mb: 2, borderRadius: 2 }}
              action={
                retryNotice.href ? (
                  <Button
                    color="inherit"
                    size="small"
                    onClick={() => { if (retryNotice.href) navigate(retryNotice.href); }}
                    sx={{ fontWeight: 700 }}
                  >
                    {retryNotice.linkLabel}
                  </Button>
                ) : null
              }
            >
              {retryNotice.message}
            </Alert>
          ) : null}

          <Paper
            elevation={0}
            aria-busy={workspaceAriaBusy(isFetching)}
            sx={[cardSx(), workspaceNoLiftHoverSx, { overflow: 'hidden', position: 'relative' }]}
          >
            {showRefreshBar ? (
              <LinearProgress
                sx={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  height: 3,
                  bgcolor: 'transparent',
                  '& .MuiLinearProgress-bar': { bgcolor: FIRSTSTEP.teal },
                }}
              />
            ) : null}

            {contentState === 'load-error' ? (
              <FailureEmptyState variant="load-error" onRetry={() => { void load(); }} />
            ) : contentState === 'account-empty' ? (
              <FailureEmptyState variant="account-empty" />
            ) : contentState === 'filtered-empty' ? (
              <FailureEmptyState variant="filtered-empty" onClearFilters={handleClearFilters} />
            ) : isMobile ? (
              <FailureCardList
                runs={runs}
                pending={pendingActions}
                errors={rowActionErrors}
                handlers={handlers}
              />
            ) : (
              <FailureTable
                runs={runs}
                pending={pendingActions}
                errors={rowActionErrors}
                handlers={handlers}
              />
            )}

            {contentState === 'rows' || contentState === 'filtered-empty' ? (
              <TablePagination
                component="div"
                count={total}
                page={page}
                onPageChange={(_event, next) => setPage(next)}
                rowsPerPage={rowsPerPage}
                onRowsPerPageChange={(event) => {
                  setRowsPerPage(parseInt(event.target.value, 10));
                  setPage(0);
                }}
                rowsPerPageOptions={[10, 25, 50, 100]}
                sx={paginationControlSx(isMobile)}
              />
            ) : null}
          </Paper>
        </>
      )}

      <RetryConfirmDialog
        run={retryTarget}
        pending={retryPending}
        onClose={() => { if (!retryPending) setRetryTarget(null); }}
        onConfirm={() => { void handleRetryConfirm(); }}
      />
    </Box>
  );
};
