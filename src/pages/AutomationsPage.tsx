import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box,
  Dialog,
  LinearProgress,
  Paper,
  TablePagination,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  createAutomation,
  deleteAutomation,
  getDashboardAutomations,
  runAutomation,
  updateAutomationSchedule,
  stopAllAutomationSchedules,
  resumeAllAutomationSchedules,
  AutomationSummary,
  DashboardAutomationsSummary,
} from '../api/automation';
import { useCacheInvalidation, useGlobalInfoStore } from '../context/globalInfo';
import { useSocketStore } from '../context/socket';
import { getScheduleLabel } from '../constants/scheduleOptions';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  automationQueryKeys,
  automationQueryOptions,
} from '../features/automations/automationQueries';
import { cardSx, FIRSTSTEP } from '../components/dashboard/ops/dashboardTokens';
import { AutomationsHero } from '../features/automations/AutomationsHero';
import { AutomationStats } from '../features/automations/AutomationStats';
import { AutomationFilters } from '../features/automations/AutomationFilters';
import { AutomationTable } from '../features/automations/AutomationTable';
import { AutomationCardList } from '../features/automations/AutomationCardList';
import { AutomationEmptyState } from '../features/automations/AutomationEmptyState';
import { AutomationSkeleton } from '../features/automations/AutomationSkeleton';
import {
  AutomationDialogs,
  type CreateAutomationForm,
  type ScheduleModalState,
} from '../features/automations/AutomationDialogs';
import type { AutomationRowHandlers } from '../features/automations/AutomationRowActions';
import { AutomationConfigPage } from './AutomationConfigPage';
import { AutomationDataPage } from './AutomationDataPage';
import {
  extractedDataDialogBackdropSx,
  extractedDataDialogPaperSx,
} from '../features/automations/automationDataPageBehavior';
import { pushReturnState } from '../features/navigation/inAppReturn';
import {
  SOCKET_INVALIDATE_DEBOUNCE_MS,
  applyFilterChange,
  attemptMutation,
  automationsLiveRegionMessage,
  automationsPageRootOverflow,
  buildCreateAutomationRequest,
  canSubmitAction,
  EMPTY_CREATE_AUTOMATION_FORM,
  hasActiveFilters,
  paginationControlSx,
  pendingActionKey,
  releaseMutation,
  resolveAutomationsContentState,
  shouldShowBackgroundRefreshBar,
  validateCreateAutomationForm,
  workspaceAriaBusy,
  workspaceNoLiftHoverSx,
  type AutomationMutationAction,
  type CreateAutomationFieldErrors,
  type PendingActions,
  type RowActionErrors,
} from '../features/automations/automationsPageBehavior';

const EMPTY_FORM: CreateAutomationForm = { ...EMPTY_CREATE_AUTOMATION_FORM };

export const AutomationsPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'), { noSsr: true });
  const { notify } = useGlobalInfoStore();
  const { invalidateRuns } = useCacheInvalidation();
  const { queueSocket } = useSocketStore();
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [hasBackgroundUpdates, setHasBackgroundUpdates] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [form, setForm] = useState<CreateAutomationForm>(EMPTY_FORM);
  const [createTags, setCreateTags] = useState<string[]>([]);
  const [createFormErrors, setCreateFormErrors] = useState<CreateAutomationFieldErrors>({});
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [nameFilter, setNameFilter] = useState('');
  const [nameFilterDebounced, setNameFilterDebounced] = useState('');
  const [idFilter, setIdFilter] = useState('');
  const [idFilterDebounced, setIdFilterDebounced] = useState('');
  const [scheduleCronFilter, setScheduleCronFilter] = useState('');
  const [pendingActions, setPendingActions] = useState<PendingActions>({});
  const [rowActionErrors, setRowActionErrors] = useState<RowActionErrors>({});

  useEffect(() => {
    const t = setTimeout(() => setNameFilterDebounced(nameFilter.trim()), 300);
    return () => clearTimeout(t);
  }, [nameFilter]);

  useEffect(() => {
    const t = setTimeout(() => setIdFilterDebounced(idFilter.trim()), 300);
    return () => clearTimeout(t);
  }, [idFilter]);

  const [scheduleModal, setScheduleModal] = useState<ScheduleModalState>({
    open: false,
    automationId: '',
    automationName: '',
    currentCron: null,
    currentTimezone: 'UTC',
  });

  const [deleteTarget, setDeleteTarget] = useState<AutomationSummary | null>(null);
  const [stopAllOpen, setStopAllOpen] = useState(false);
  const [stoppingAll, setStoppingAll] = useState(false);
  const [resumeAllOpen, setResumeAllOpen] = useState(false);
  const [resumingAll, setResumingAll] = useState(false);
  const [creating, setCreating] = useState(false);
  const [copiedTargetUrl, setCopiedTargetUrl] = useState<string | null>(null);
  const [copiedScoutId, setCopiedScoutId] = useState<string | null>(null);
  const [configTargetId, setConfigTargetId] = useState<string | null>(null);
  const [dataTargetId, setDataTargetId] = useState<string | null>(null);

  const copyTargetUrl = useCallback(async (url?: string) => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedTargetUrl(url);
      window.setTimeout(() => {
        setCopiedTargetUrl((current) => (current === url ? null : current));
      }, 1500);
    } catch {
      setCopiedTargetUrl(null);
    }
  }, []);

  const copyScoutId = useCallback(async (scoutId?: string | null) => {
    if (!scoutId) return;
    try {
      await navigator.clipboard.writeText(scoutId);
      setCopiedScoutId(scoutId);
      window.setTimeout(() => {
        setCopiedScoutId((current) => (current === scoutId ? null : current));
      }, 1500);
    } catch {
      setCopiedScoutId(null);
    }
  }, []);

  const buildAutomationSnapshot = useCallback((rows: AutomationSummary[]) => {
    return rows
      .map((automation) => [
        automation.id,
        automation.updatedAt || '',
        automation.status || '',
        String(automation.rowsExtracted || 0),
        automation.lastRunTime || '',
        automation.schedule?.enabled ? '1' : '0',
        automation.schedule?.cron || '',
        automation.schedule?.timezone || '',
        automation.schedule?.paused ? '1' : '0',
      ].join('|'))
      .sort()
      .join('||');
  }, []);

  const buildDashboardListSignature = useCallback(
    (payload: { summary: DashboardAutomationsSummary; total: number; rows: AutomationSummary[] }) =>
      [JSON.stringify(payload.summary), String(payload.total), buildAutomationSnapshot(payload.rows)].join('||'),
    [buildAutomationSnapshot]
  );

  const latestSnapshotRef = useRef<string>('');

  const automationQuery = {
    page: page + 1,
    pageSize: rowsPerPage,
    q: nameFilterDebounced,
    id: idFilterDebounced,
    tags: tagFilter,
    schedule: scheduleCronFilter,
  };
  const {
    data: automationData,
    error: automationError,
    isLoading,
    isFetching,
    dataUpdatedAt,
    refetch: refetchAutomations,
  } = useQuery(automationQueryOptions(automationQuery));
  const automations = automationData?.automations ?? [];
  const summary: DashboardAutomationsSummary | null = automationData?.summary ?? null;
  const totalCount = automationData?.pagination.total ?? 0;
  const isRefreshing = isFetching && !isLoading;
  const activeScheduledCount = summary?.activeScheduledCount ?? 0;
  const pausedScheduleCount = summary?.pausedScheduleCount ?? 0;
  const filtersActive = hasActiveFilters({
    q: nameFilterDebounced,
    id: idFilterDebounced,
    schedule: scheduleCronFilter,
    tags: tagFilter,
  });
  const hasLoadedData = Boolean(automationData);
  const contentState = resolveAutomationsContentState({
    isLoading,
    isFetching,
    isError: Boolean(automationError),
    hasLoadedData,
    rowCount: automations.length,
    hasActiveFilters: filtersActive,
  });
  const showRefreshBar = shouldShowBackgroundRefreshBar({
    isFetching,
    isLoading,
    hasLoadedData,
  });

  useEffect(() => {
    if (!automationData) return;
    latestSnapshotRef.current = buildDashboardListSignature({
      summary: automationData.summary,
      total: automationData.pagination.total,
      rows: automationData.automations,
    });
    setHasBackgroundUpdates(false);
  }, [automationData, buildDashboardListSignature]);

  useEffect(() => {
    if (!automationError || (automationError as { response?: { status?: number } })?.response?.status === 429) return;
    notify(
      'error',
      (automationError as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to load automations',
    );
  }, [automationError, notify]);

  const loadAutomations = useCallback(async () => {
    await refetchAutomations();
  }, [refetchAutomations]);

  useEffect(() => {
    if (isLoading) return;
    const maxPage = Math.max(0, Math.ceil(totalCount / (rowsPerPage || 1)) - 1);
    if (totalCount > 0 && page > maxPage) {
      setPage(maxPage);
    }
    if (totalCount === 0 && page !== 0) {
      setPage(0);
    }
  }, [isLoading, totalCount, rowsPerPage, page]);

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let controller: AbortController | null = null;
    const id = setInterval(() => {
      if (document.hidden || isLoading || isRefreshing || hasBackgroundUpdates) return;
      controller?.abort();
      controller = new AbortController();
      getDashboardAutomations({
        page: page + 1,
        limit: rowsPerPage,
        ...(tagFilter.length ? { tags: tagFilter } : {}),
        ...(nameFilterDebounced ? { q: nameFilterDebounced } : {}),
        ...(idFilterDebounced ? { id: idFilterDebounced } : {}),
        ...(scheduleCronFilter ? { scheduleCron: scheduleCronFilter } : {}),
      }, controller.signal)
        .then((fresh) => {
          const freshSig = buildDashboardListSignature({
            summary: fresh.summary,
            total: fresh.pagination.total,
            rows: fresh.automations,
          });
          if (freshSig && freshSig !== latestSnapshotRef.current) {
            setHasBackgroundUpdates(true);
          }
        })
        .catch(() => {
          // Keep this silent to avoid noisy toasts for background checks.
        });
    }, 180000);
    return () => {
      clearInterval(id);
      controller?.abort();
    };
  }, [buildDashboardListSignature, hasBackgroundUpdates, isLoading, isRefreshing, page, rowsPerPage, tagFilter, nameFilterDebounced, idFilterDebounced, scheduleCronFilter]);

  useEffect(() => {
    if (!queueSocket) return;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: automationQueryKeys.all });
      }, SOCKET_INVALIDATE_DEBOUNCE_MS);
    };
    queueSocket.on('run-started', refresh);
    queueSocket.on('run-completed', refresh);
    return () => {
      clearTimeout(timeout);
      queueSocket.off('run-started', refresh);
      queueSocket.off('run-completed', refresh);
    };
  }, [queueSocket, queryClient]);

  const runGuardedMutation = useCallback(async (
    automation: AutomationSummary,
    action: AutomationMutationAction,
    work: () => Promise<void>,
    fallbackMessage: string,
  ) => {
    let accepted = false;
    setPendingActions((prev) => {
      const attempt = attemptMutation(prev, automation.id, action);
      accepted = attempt.accepted;
      return attempt.accepted ? attempt.pending : prev;
    });
    if (!accepted) return;
    setRowActionErrors((prev) => {
      const next = { ...prev };
      delete next[pendingActionKey(automation.id, action)];
      return next;
    });
    try {
      await work();
    } catch (error: unknown) {
      const message =
        (error as { response?: { data?: { error?: string } } })?.response?.data?.error || fallbackMessage;
      notify('error', message);
      setRowActionErrors((prev) => ({
        ...prev,
        [pendingActionKey(automation.id, action)]: message,
      }));
    } finally {
      setPendingActions((prev) => releaseMutation(prev, automation.id, action));
    }
  }, [notify]);

  const resetCreateForm = useCallback(() => {
    setForm(EMPTY_FORM);
    setCreateTags([]);
    setCreateFormErrors({});
  }, []);

  const handleCreate = async () => {
    const validation = validateCreateAutomationForm(form);
    if (!validation.ok) {
      setCreateFormErrors(validation.fieldErrors);
      notify('error', validation.message);
      return;
    }
    if (creating) return;
    setCreating(true);
    setCreateFormErrors({});
    try {
      const payload = buildCreateAutomationRequest(form, createTags, {
        dataCleanup: {
          removeEmptyRows: true,
          removeDuplicates: true,
        },
        pagination: {
          mode: 'none',
          autoScroll: false,
        },
      });
      await createAutomation(payload);
      setIsCreateOpen(false);
      resetCreateForm();
      notify('success', 'Automation created');
      await loadAutomations();
    } catch (error: unknown) {
      notify('error', (error as { response?: { data?: { error?: string } } })?.response?.data?.error || (error as Error)?.message || 'Failed to create automation');
    } finally {
      setCreating(false);
    }
  };

  const handleRun = (automation: AutomationSummary) => {
    void runGuardedMutation(automation, 'run', async () => {
      const result = await runAutomation(automation.id);
      invalidateRuns();
      notify(
        'info',
        'Automation queued. All Runs lists today’s IST calendar day — open that automation’s group if it is not on the first page.',
      );
      await loadAutomations();
      if (automation.id) {
        navigate(`/runs/${automation.id}`, { state: pushReturnState(location) });
      } else if (result.runId) {
        navigate(`/run/${result.runId}`, { state: pushReturnState(location) });
      }
    }, 'Failed to run automation');
  };

  const openScheduleModal = (automation: AutomationSummary) => {
    setScheduleModal({
      open: true,
      automationId: automation.id,
      automationName: automation.name,
      currentCron: automation.schedule?.cron || null,
      currentTimezone: automation.schedule?.timezone || 'UTC',
      currentEnabled: !!automation.schedule?.enabled,
      currentPaused:
        !!automation.schedule?.paused
        || (!!automation.schedule?.cron && !automation.schedule?.enabled),
    });
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    await runGuardedMutation(deleteTarget, 'delete', async () => {
      await deleteAutomation(deleteTarget.id);
      notify('success', `Deleted “${deleteTarget.name}” (in-flight scrapes aborted) and related runs, data, and jobs`);
      setDeleteTarget(null);
      await loadAutomations();
    }, 'Failed to delete automation');
  };

  const handleScheduleSave = async (
    automationId: string,
    schedule: {
      enabled: boolean;
      cron: string | null;
      timezone: string;
      preferredNextRunAt?: string | null;
    }
  ) => {
    try {
      await updateAutomationSchedule(automationId, schedule);
      notify(
        'success',
        schedule.enabled
          ? `Schedule saved: ${getScheduleLabel(schedule.cron)}`
          : 'Schedule disabled'
      );
      await loadAutomations();
    } catch (error: unknown) {
      notify('error', (error as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to save schedule');
      throw error;
    }
  };

  const handleStopSchedule = (automation: AutomationSummary) => {
    void runGuardedMutation(automation, 'pause-schedule', async () => {
      const tz = automation.schedule?.timezone || 'UTC';
      await updateAutomationSchedule(automation.id, {
        enabled: false,
        cron: null,
        timezone: tz,
      });
      notify('success', `Schedule paused for “${automation.name}” — use Resume to turn it back on`);
      await loadAutomations();
    }, 'Failed to pause schedule');
  };

  const handleResumeSchedule = (automation: AutomationSummary) => {
    const cron = automation.schedule?.cron;
    const tz = automation.schedule?.timezone || 'UTC';
    if (!cron?.trim()) {
      notify('error', 'No saved interval — open Schedule and pick a cadence first');
      return;
    }
    void runGuardedMutation(automation, 'resume-schedule', async () => {
      await updateAutomationSchedule(automation.id, {
        enabled: true,
        cron,
        timezone: tz,
      });
      notify('success', `Schedule resumed for “${automation.name}”`);
      await loadAutomations();
    }, 'Failed to resume schedule');
  };

  const handleStopAllSchedules = async () => {
    setStoppingAll(true);
    try {
      const { stoppedCount } = await stopAllAutomationSchedules();
      notify(
        'success',
        stoppedCount === 0
          ? 'No active schedules to pause'
          : `Paused ${stoppedCount} schedule${stoppedCount === 1 ? '' : 's'} (use Resume to turn them back on)`
      );
      setStopAllOpen(false);
      await loadAutomations();
    } catch (error: unknown) {
      notify('error', (error as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to stop all schedules');
    } finally {
      setStoppingAll(false);
    }
  };

  const handleResumeAllSchedules = async () => {
    setResumingAll(true);
    try {
      const { resumedCount } = await resumeAllAutomationSchedules();
      notify(
        'success',
        resumedCount === 0
          ? 'No paused schedules to resume'
          : `Resumed ${resumedCount} schedule${resumedCount === 1 ? '' : 's'}`
      );
      setResumeAllOpen(false);
      await loadAutomations();
    } catch (error: unknown) {
      notify('error', (error as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to resume all schedules');
    } finally {
      setResumingAll(false);
    }
  };

  const handleManualRefresh = async () => {
    await loadAutomations();
  };

  const handleClearFilters = () => {
    setNameFilter('');
    setNameFilterDebounced('');
    setIdFilter('');
    setIdFilterDebounced('');
    setScheduleCronFilter('');
    setTagFilter([]);
    setPage(0);
  };

  const handlers: AutomationRowHandlers = {
    onRun: handleRun,
    onOpenSchedule: openScheduleModal,
    onPauseSchedule: handleStopSchedule,
    onResumeSchedule: handleResumeSchedule,
    onViewData: (automation) => setDataTargetId(automation.id),
    onRunHistory: (automation) => {
      if (automation.id) navigate(`/runs/${automation.id}`);
    },
    onConfigure: (automation) => setConfigTargetId(automation.id),
    onDelete: setDeleteTarget,
    onOpenLastRun: (automation) => {
      if (automation.latestRunId) navigate(`/run/${automation.latestRunId}`, { state: pushReturnState(location) });
    },
    onCopyScoutId: (scoutId) => { void copyScoutId(scoutId); },
    onCopyTargetUrl: (url) => { void copyTargetUrl(url); },
  };

  const liveMessage = automationsLiveRegionMessage({
    contentState,
    resultCount: totalCount,
    isFetching,
  });

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100%',
        overflow: automationsPageRootOverflow(),
        gap: { xs: 1.5, md: 1.75 },
        p: { xs: 1.5, md: 2 },
        bgcolor: (muiTheme) => (muiTheme.palette.mode === 'dark' ? '#000' : FIRSTSTEP.surface),
      }}
    >
      <Box sx={{ flexShrink: 0 }}>
      <AutomationsHero
        totalCount={summary?.totalAutomations ?? totalCount}
        dataUpdatedAt={hasLoadedData ? dataUpdatedAt : null}
        nowMs={nowMs}
        isRefreshing={isRefreshing}
        isLoading={isLoading}
        hasBackgroundUpdates={hasBackgroundUpdates}
        activeScheduledCount={activeScheduledCount}
        pausedScheduleCount={pausedScheduleCount}
        onRefresh={() => { void handleManualRefresh(); }}
        onPauseAll={() => setStopAllOpen(true)}
        onResumeAll={() => setResumeAllOpen(true)}
        onNewAutomation={() => {
          resetCreateForm();
          setIsCreateOpen(true);
        }}
      />
      </Box>

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
        <AutomationSkeleton />
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', flex: 'none', minHeight: 0, gap: 1.75 }}>
          {contentState !== 'load-error' ? (
            <Box sx={{ flexShrink: 0 }}>
              <AutomationStats summary={summary} />
            </Box>
          ) : null}

          <Box sx={{ flexShrink: 0 }}>
            <AutomationFilters
            nameFilter={nameFilter}
            idFilter={idFilter}
            scheduleCronFilter={scheduleCronFilter}
            tagFilter={tagFilter}
            resultCount={totalCount}
            onNameChange={(value) => applyFilterChange(setNameFilter, setPage, value)}
            onIdChange={(value) => applyFilterChange(setIdFilter, setPage, value)}
            onScheduleChange={(value) => applyFilterChange(setScheduleCronFilter, setPage, value)}
            onTagChange={(next) => applyFilterChange(setTagFilter, setPage, next)}
            onClearAll={handleClearFilters}
            />
          </Box>

          <Paper
            elevation={0}
            aria-busy={workspaceAriaBusy(isFetching)}
            sx={[
              cardSx(),
              workspaceNoLiftHoverSx,
              {
                overflow: 'hidden',
                position: 'relative',
                flex: 'none',
                minWidth: 0,
                width: '100%',
                maxWidth: '100%',
                display: 'flex',
                flexDirection: 'column',
              },
            ]}
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
              <AutomationEmptyState variant="load-error" onRetry={() => { void loadAutomations(); }} />
            ) : contentState === 'account-empty' ? (
              <AutomationEmptyState variant="account-empty" onNewAutomation={() => { resetCreateForm(); setIsCreateOpen(true); }} />
            ) : contentState === 'filtered-empty' ? (
              <AutomationEmptyState variant="filtered-empty" onClearFilters={handleClearFilters} />
            ) : isMobile ? (
              <AutomationCardList
                automations={automations}
                pending={pendingActions}
                errors={rowActionErrors}
                copiedScoutId={copiedScoutId}
                copiedTargetUrl={copiedTargetUrl}
                handlers={handlers}
              />
            ) : (
              <AutomationTable
                automations={automations}
                pending={pendingActions}
                errors={rowActionErrors}
                copiedScoutId={copiedScoutId}
                copiedTargetUrl={copiedTargetUrl}
                handlers={handlers}
              />
            )}

            {contentState === 'rows' || contentState === 'filtered-empty' ? (
              <TablePagination
                component="div"
                count={totalCount}
                page={page}
                onPageChange={(_, newPage) => setPage(newPage)}
                rowsPerPage={rowsPerPage}
                onRowsPerPageChange={(event) => {
                  setRowsPerPage(parseInt(event.target.value, 10));
                  setPage(0);
                }}
                rowsPerPageOptions={[10, 25, 50, 100]}
                sx={[
                  paginationControlSx(isMobile),
                  {
                    flexShrink: 0,
                    borderTop: 1,
                    borderColor: 'divider',
                    bgcolor: 'background.paper',
                  },
                ]}
              />
            ) : null}
          </Paper>
        </Box>
      )}

      <AutomationDialogs
        isCreateOpen={isCreateOpen}
        form={form}
        createTags={createTags}
        createFormErrors={createFormErrors}
        onFormChange={(next) => {
          setForm(next);
          if (Object.keys(createFormErrors).length) {
            const validation = validateCreateAutomationForm(next);
            setCreateFormErrors(validation.ok ? {} : validation.fieldErrors);
          }
        }}
        onCreateTagsChange={setCreateTags}
        onCloseCreate={() => {
          if (creating) return;
          setIsCreateOpen(false);
          resetCreateForm();
        }}
        onCreate={() => { void handleCreate(); }}
        creating={creating}
        scheduleModal={scheduleModal}
        onCloseSchedule={() => setScheduleModal((s) => ({ ...s, open: false }))}
        onSaveSchedule={handleScheduleSave}
        deleteTarget={deleteTarget}
        onCloseDelete={() => { if (!pendingActions[pendingActionKey(deleteTarget?.id || '', 'delete')]) setDeleteTarget(null); }}
        onConfirmDelete={() => { void handleDeleteConfirm(); }}
        deleting={Boolean(deleteTarget && pendingActions[pendingActionKey(deleteTarget.id, 'delete')])}
        stopAllOpen={stopAllOpen}
        stoppingAll={stoppingAll}
        onCloseStopAll={() => setStopAllOpen(false)}
        onConfirmStopAll={() => { void handleStopAllSchedules(); }}
        resumeAllOpen={resumeAllOpen}
        resumingAll={resumingAll}
        onCloseResumeAll={() => setResumeAllOpen(false)}
        onConfirmResumeAll={() => { void handleResumeAllSchedules(); }}
      />

      <Dialog
        open={Boolean(configTargetId)}
        onClose={() => setConfigTargetId(null)}
        fullWidth
        maxWidth="md"
        scroll="paper"
      >
        {configTargetId ? (
          <AutomationConfigPage
            automationId={configTargetId}
            onClose={() => setConfigTargetId(null)}
            embedded
          />
        ) : null}
      </Dialog>
      <Dialog
        open={Boolean(dataTargetId)}
        onClose={() => setDataTargetId(null)}
        fullWidth
        maxWidth={false}
        fullScreen={isMobile}
        scroll="paper"
        PaperProps={{ sx: extractedDataDialogPaperSx() }}
        BackdropProps={{ sx: extractedDataDialogBackdropSx() }}
      >
        {dataTargetId ? (
          <AutomationDataPage
            automationId={dataTargetId}
            onClose={() => setDataTargetId(null)}
            embedded
          />
        ) : null}
      </Dialog>
    </Box>
  );
};
