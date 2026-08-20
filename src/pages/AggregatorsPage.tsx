import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Paper,
  Stack,
  TablePagination,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import RefreshIcon from '@mui/icons-material/Refresh';
import WorkOutlineIcon from '@mui/icons-material/WorkOutline';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createAutomation,
  deleteAutomation,
  getDashboardAggregators,
  runAutomation,
  updateAutomationSchedule,
  type AutomationSummary,
  type DashboardAutomationsSummary,
} from '../api/automation';
import { useGlobalInfoStore } from '../context/globalInfo';
import { useSocketStore } from '../context/socket';
import { getScheduleLabel } from '../constants/scheduleOptions';
import {
  aggregatorQueryKeys,
  aggregatorQueryOptions,
} from '../features/automations/automationQueries';
import {
  cardSx,
  fadeUpSx,
  FIRSTSTEP,
  heroGlassGhostButtonSx,
  heroGlassOverlineSx,
  heroGlassPanelSx,
  heroGlassPrimaryButtonSx,
  heroGlassSubtitleSx,
  heroGlassTitleSx,
  METRIC_COLORS,
} from '../components/dashboard/ops/dashboardTokens';
import { OpsHeroBackdrop } from '../components/dashboard/ops/OpsHeroBackdrop';
import { StatCard } from '../components/dashboard/ops/StatCard';
import { AutomationStats } from '../features/automations/AutomationStats';
import { AutomationFilters } from '../features/automations/AutomationFilters';
import { AutomationTable } from '../features/automations/AutomationTable';
import { AutomationCardList } from '../features/automations/AutomationCardList';
import { AutomationEmptyState } from '../features/automations/AutomationEmptyState';
import { AutomationSkeleton } from '../features/automations/AutomationSkeleton';
import {
  AutomationDialogs,
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
  EMPTY_CREATE_AUTOMATION_FORM,
  hasActiveFilters,
  paginationControlSx,
  pendingActionKey,
  releaseMutation,
  resolveAutomationsContentState,
  shouldShowBackgroundRefreshBar,
  workspaceAriaBusy,
  workspaceNoLiftHoverSx,
  type AutomationMutationAction,
  type PendingActions,
  type RowActionErrors,
} from '../features/automations/automationsPageBehavior';

const HOURLY_CRON = '0 * * * *';

type AggregatorSummary = DashboardAutomationsSummary & { jobsAddedToBoardTotal?: number };

export const AggregatorsPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'), { noSsr: true });
  const { notify } = useGlobalInfoStore();
  const { queueSocket } = useSocketStore();

  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [hasBackgroundUpdates, setHasBackgroundUpdates] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [nameFilter, setNameFilter] = useState('');
  const [nameFilterDebounced, setNameFilterDebounced] = useState('');
  const [idFilter, setIdFilter] = useState('');
  const [idFilterDebounced, setIdFilterDebounced] = useState('');
  const [scheduleCronFilter, setScheduleCronFilter] = useState('');
  const [pendingActions, setPendingActions] = useState<PendingActions>({});
  const [rowActionErrors, setRowActionErrors] = useState<RowActionErrors>({});
  const [copiedTargetUrl, setCopiedTargetUrl] = useState<string | null>(null);
  const [copiedScoutId, setCopiedScoutId] = useState<string | null>(null);
  const [configTargetId, setConfigTargetId] = useState<string | null>(null);
  const [dataTargetId, setDataTargetId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AutomationSummary | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createUrl, setCreateUrl] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [scheduleModal, setScheduleModal] = useState<ScheduleModalState>({
    open: false,
    automationId: '',
    automationName: '',
    currentCron: null,
    currentTimezone: 'UTC',
  });

  useEffect(() => {
    const t = setTimeout(() => setNameFilterDebounced(nameFilter.trim()), 300);
    return () => clearTimeout(t);
  }, [nameFilter]);

  useEffect(() => {
    const t = setTimeout(() => setIdFilterDebounced(idFilter.trim()), 300);
    return () => clearTimeout(t);
  }, [idFilter]);

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

  const buildSnapshot = useCallback((rows: AutomationSummary[]) => {
    return rows
      .map((automation) =>
        [
          automation.id,
          automation.updatedAt || '',
          automation.status || '',
          String(automation.rowsExtracted || 0),
          String(automation.jobsAddedToBoard || 0),
          automation.lastRunTime || '',
          automation.schedule?.enabled ? '1' : '0',
          automation.schedule?.cron || '',
          automation.schedule?.nextRunAt || '',
        ].join('|')
      )
      .sort()
      .join('||');
  }, []);

  const latestSnapshotRef = useRef('');

  const aggregatorQuery = {
    page: page + 1,
    pageSize: rowsPerPage,
    q: nameFilterDebounced,
    id: idFilterDebounced,
    tags: tagFilter,
    schedule: scheduleCronFilter,
    provider: 'hiring_cafe',
  };

  const {
    data: aggregatorData,
    error: aggregatorError,
    isLoading,
    isFetching,
    dataUpdatedAt,
    refetch: refetchAggregators,
  } = useQuery(aggregatorQueryOptions(aggregatorQuery));

  const searches = aggregatorData?.searches ?? [];
  const summary: AggregatorSummary | null = aggregatorData?.summary ?? null;
  const totalCount = aggregatorData?.pagination.total ?? 0;
  const isRefreshing = isFetching && !isLoading;
  const filtersActive = hasActiveFilters({
    q: nameFilterDebounced,
    id: idFilterDebounced,
    schedule: scheduleCronFilter,
    tags: tagFilter,
  });
  const hasLoadedData = Boolean(aggregatorData);
  const contentState = resolveAutomationsContentState({
    isLoading,
    isFetching,
    isError: Boolean(aggregatorError),
    hasLoadedData,
    rowCount: searches.length,
    hasActiveFilters: filtersActive,
  });
  const showRefreshBar = shouldShowBackgroundRefreshBar({
    isFetching,
    isLoading,
    hasLoadedData,
  });

  useEffect(() => {
    if (!aggregatorData) return;
    latestSnapshotRef.current = [
      JSON.stringify(aggregatorData.summary),
      String(aggregatorData.pagination.total),
      buildSnapshot(aggregatorData.searches),
    ].join('||');
    setHasBackgroundUpdates(false);
  }, [aggregatorData, buildSnapshot]);

  useEffect(() => {
    if (!aggregatorError || (aggregatorError as { response?: { status?: number } })?.response?.status === 429) {
      return;
    }
    notify(
      'error',
      (aggregatorError as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        'Failed to load aggregators'
    );
  }, [aggregatorError, notify]);

  const loadAggregators = useCallback(async () => {
    await refetchAggregators();
  }, [refetchAggregators]);

  useEffect(() => {
    if (isLoading) return;
    const maxPage = Math.max(0, Math.ceil(totalCount / (rowsPerPage || 1)) - 1);
    if (totalCount > 0 && page > maxPage) setPage(maxPage);
    if (totalCount === 0 && page !== 0) setPage(0);
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
      getDashboardAggregators(
        {
          page: page + 1,
          limit: rowsPerPage,
          provider: 'hiring_cafe',
          ...(tagFilter.length ? { tags: tagFilter } : {}),
          ...(nameFilterDebounced ? { q: nameFilterDebounced } : {}),
          ...(idFilterDebounced ? { id: idFilterDebounced } : {}),
          ...(scheduleCronFilter ? { scheduleCron: scheduleCronFilter } : {}),
        },
        controller.signal
      )
        .then((fresh) => {
          const freshSig = [
            JSON.stringify(fresh.summary),
            String(fresh.pagination.total),
            buildSnapshot(fresh.searches),
          ].join('||');
          if (freshSig && freshSig !== latestSnapshotRef.current) {
            setHasBackgroundUpdates(true);
          }
        })
        .catch(() => {});
    }, 180000);
    return () => {
      clearInterval(id);
      controller?.abort();
    };
  }, [
    buildSnapshot,
    hasBackgroundUpdates,
    isLoading,
    isRefreshing,
    page,
    rowsPerPage,
    tagFilter,
    nameFilterDebounced,
    idFilterDebounced,
    scheduleCronFilter,
  ]);

  useEffect(() => {
    if (!queueSocket) return;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: aggregatorQueryKeys.all });
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

  const runGuardedMutation = useCallback(
    async (
      automation: AutomationSummary,
      action: AutomationMutationAction,
      work: () => Promise<void>,
      fallbackMessage: string
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
          (error as { response?: { data?: { error?: string } } })?.response?.data?.error ||
          fallbackMessage;
        notify('error', message);
        setRowActionErrors((prev) => ({
          ...prev,
          [pendingActionKey(automation.id, action)]: message,
        }));
      } finally {
        setPendingActions((prev) => releaseMutation(prev, automation.id, action));
      }
    },
    [notify]
  );

  const handleCreate = async () => {
    const trimmedName = createName.trim();
    const trimmedUrl = createUrl.trim();
    if (!trimmedName || !trimmedUrl) {
      setCreateError('Name and Hiring Cafe search URL are required.');
      return;
    }
    if (creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      await createAutomation({
        name: trimmedName,
        startUrl: trimmedUrl,
        companyName: 'Hiring Cafe',
        tags: ['aggregator', 'hiring_cafe'],
        config: {
          aggregatorProvider: 'hiring_cafe',
          preferAtsCollection: false,
          schedule: {
            enabled: true,
            cron: HOURLY_CRON,
            timezone: 'UTC',
          },
        },
      });
      setCreateOpen(false);
      setCreateName('');
      setCreateUrl('');
      notify('success', 'Hiring Cafe search created — scheduled hourly');
      await loadAggregators();
    } catch (e: unknown) {
      setCreateError(
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error ||
          'Failed to create search'
      );
    } finally {
      setCreating(false);
    }
  };

  const handleRun = (automation: AutomationSummary) => {
    void runGuardedMutation(
      automation,
      'run',
      async () => {
        const result = await runAutomation(automation.id);
        notify('info', 'Search queued — check Run History for status');
        await loadAggregators();
        if (result.runId) {
          navigate(`/run/${result.runId}`, { state: pushReturnState(location) });
        }
      },
      'Failed to run search'
    );
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
        !!automation.schedule?.paused ||
        (!!automation.schedule?.cron && !automation.schedule?.enabled),
    });
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    await runGuardedMutation(
      deleteTarget,
      'delete',
      async () => {
        await deleteAutomation(deleteTarget.id);
        notify(
          'success',
          `Deleted “${deleteTarget.name}” (in-flight scrapes aborted) and related runs, data, and jobs`
        );
        setDeleteTarget(null);
        await loadAggregators();
      },
      'Failed to delete search'
    );
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
      await loadAggregators();
    } catch (error: unknown) {
      notify(
        'error',
        (error as { response?: { data?: { error?: string } } })?.response?.data?.error ||
          'Failed to save schedule'
      );
      throw error;
    }
  };

  const handleStopSchedule = (automation: AutomationSummary) => {
    void runGuardedMutation(
      automation,
      'pause-schedule',
      async () => {
        const tz = automation.schedule?.timezone || 'UTC';
        await updateAutomationSchedule(automation.id, {
          enabled: false,
          cron: null,
          timezone: tz,
        });
        notify('success', `Schedule paused for “${automation.name}” — use Resume to turn it back on`);
        await loadAggregators();
      },
      'Failed to pause schedule'
    );
  };

  const handleResumeSchedule = (automation: AutomationSummary) => {
    const cron = automation.schedule?.cron;
    const tz = automation.schedule?.timezone || 'UTC';
    if (!cron?.trim()) {
      notify('error', 'No saved interval — open Schedule and pick a cadence first');
      return;
    }
    void runGuardedMutation(
      automation,
      'resume-schedule',
      async () => {
        await updateAutomationSchedule(automation.id, {
          enabled: true,
          cron,
          timezone: tz,
        });
        notify('success', `Schedule resumed for “${automation.name}”`);
        await loadAggregators();
      },
      'Failed to resume schedule'
    );
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
      if (automation.latestRunId) {
        navigate(`/run/${automation.latestRunId}`, { state: pushReturnState(location) });
      }
    },
    onCopyScoutId: (scoutId) => {
      void copyScoutId(scoutId);
    },
    onCopyTargetUrl: (url) => {
      void copyTargetUrl(url);
    },
  };

  const liveMessage = automationsLiveRegionMessage({
    contentState,
    resultCount: totalCount,
    isFetching,
  });

  const freshnessLabel = (() => {
    if (!hasLoadedData || !dataUpdatedAt) return 'Waiting for first load';
    if (hasBackgroundUpdates) return 'Updates available — refresh';
    const ageSec = Math.max(0, Math.round((nowMs - dataUpdatedAt) / 1000));
    if (ageSec < 45) return 'Just updated';
    if (ageSec < 120) return `Updated ${ageSec}s ago`;
    return `Updated ${Math.round(ageSec / 60)}m ago`;
  })();

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
        <Paper
          elevation={0}
          sx={[fadeUpSx(0), heroGlassPanelSx({ shadow: 'soft' }), { p: { xs: 2, md: 2.25 } }]}
        >
          <OpsHeroBackdrop />
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            justifyContent="space-between"
            alignItems={{ xs: 'flex-start', md: 'flex-end' }}
            spacing={2.5}
            sx={{ position: 'relative', zIndex: 1 }}
          >
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="overline" sx={heroGlassOverlineSx}>
                Job aggregators
              </Typography>
              <Typography sx={heroGlassTitleSx('md')}>Aggregators</Typography>
              <Typography variant="body2" sx={{ ...heroGlassSubtitleSx, maxWidth: 560 }}>
                Hiring Cafe searches with the same schedule, next-run, and actions as Automations.
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                {freshnessLabel}
                {summary ? ` · ${summary.totalAutomations} searches` : ''}
                {summary?.activeScheduledCount
                  ? ` · ${summary.activeScheduledCount} scheduled`
                  : ''}
              </Typography>
            </Box>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Button
                size="small"
                startIcon={<RefreshIcon />}
                onClick={() => {
                  void loadAggregators();
                }}
                disabled={isLoading || isRefreshing}
                sx={heroGlassGhostButtonSx}
              >
                Refresh
              </Button>
              <Button
                size="small"
                variant="contained"
                startIcon={<AddIcon />}
                onClick={() => {
                  setCreateError(null);
                  setCreateOpen(true);
                }}
                sx={heroGlassPrimaryButtonSx}
              >
                New search
              </Button>
            </Stack>
          </Stack>
        </Paper>
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
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                  gap: 1.5,
                  mt: 1.5,
                }}
              >
                <StatCard
                  label="On job board"
                  value={summary?.jobsAddedToBoardTotal ?? 0}
                  hint="Jobs added from latest aggregator runs"
                  color={METRIC_COLORS.jobs}
                  icon={<WorkOutlineIcon />}
                  delay={200}
                />
              </Box>
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
              <AutomationEmptyState
                variant="load-error"
                onRetry={() => {
                  void loadAggregators();
                }}
              />
            ) : contentState === 'account-empty' ? (
              <AutomationEmptyState
                variant="account-empty"
                onNewAutomation={() => {
                  setCreateError(null);
                  setCreateOpen(true);
                }}
              />
            ) : contentState === 'filtered-empty' ? (
              <AutomationEmptyState variant="filtered-empty" onClearFilters={handleClearFilters} />
            ) : isMobile ? (
              <AutomationCardList
                automations={searches}
                pending={pendingActions}
                errors={rowActionErrors}
                copiedScoutId={copiedScoutId}
                copiedTargetUrl={copiedTargetUrl}
                handlers={handlers}
                showJobBoard
              />
            ) : (
              <AutomationTable
                automations={searches}
                pending={pendingActions}
                errors={rowActionErrors}
                copiedScoutId={copiedScoutId}
                copiedTargetUrl={copiedTargetUrl}
                handlers={handlers}
                showJobBoardColumn
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
        isCreateOpen={false}
        form={{ ...EMPTY_CREATE_AUTOMATION_FORM }}
        createTags={[]}
        createFormErrors={{}}
        onFormChange={() => {}}
        onCreateTagsChange={() => {}}
        onCloseCreate={() => {}}
        onCreate={() => {}}
        creating={false}
        scheduleModal={scheduleModal}
        onCloseSchedule={() => setScheduleModal((s) => ({ ...s, open: false }))}
        onSaveSchedule={handleScheduleSave}
        deleteTarget={deleteTarget}
        onCloseDelete={() => {
          if (!pendingActions[pendingActionKey(deleteTarget?.id || '', 'delete')]) {
            setDeleteTarget(null);
          }
        }}
        onConfirmDelete={() => {
          void handleDeleteConfirm();
        }}
        deleting={Boolean(
          deleteTarget && pendingActions[pendingActionKey(deleteTarget.id, 'delete')]
        )}
        stopAllOpen={false}
        stoppingAll={false}
        onCloseStopAll={() => {}}
        onConfirmStopAll={() => {}}
        resumeAllOpen={false}
        resumingAll={false}
        onCloseResumeAll={() => {}}
        onConfirmResumeAll={() => {}}
      />

      <Dialog
        open={createOpen}
        onClose={() => {
          if (!creating) setCreateOpen(false);
        }}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>New Hiring Cafe search</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            {createError ? <Alert severity="error">{createError}</Alert> : null}
            <TextField
              label="Name"
              fullWidth
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              autoFocus
            />
            <TextField
              label="Hiring Cafe search URL"
              fullWidth
              value={createUrl}
              onChange={(e) => setCreateUrl(e.target.value)}
              placeholder="https://hiringcafe.com/..."
              helperText="Scheduled hourly by default — change cadence from the Schedule action."
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button disabled={creating} onClick={() => setCreateOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="contained"
            disabled={creating}
            onClick={() => {
              void handleCreate();
            }}
            sx={{ bgcolor: FIRSTSTEP.teal, '&:hover': { bgcolor: FIRSTSTEP.navy } }}
          >
            {creating ? 'Creating…' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>

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
