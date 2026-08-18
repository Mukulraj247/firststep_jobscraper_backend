import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  LinearProgress,
  Paper,
  TablePagination,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  checkRunsForRecording,
  deleteRecordingFromStorage,
  getStoredRecording,
  getStoredRecordings,
} from '../../api/storage';
import { canCreateBrowserInState, getActiveBrowserId, stopRecording } from '../../api/recording';
import {
  useCachedRecordings,
  useCachedRecordingsSummary,
  useGlobalInfoStore,
} from '../../context/globalInfo';
import { useSocketStore } from '../../context/socket';
import { cardSx, FIRSTSTEP } from '../../components/dashboard/ops/dashboardTokens';
import { ScrapersHero } from './ScrapersHero';
import { ScrapersStats } from './ScrapersStats';
import { ScrapersSkeleton } from './ScrapersSkeleton';
import { ScrapersEmptyState } from './ScrapersEmptyState';
import { ScrapersTable } from './ScrapersTable';
import { ScrapersCardList } from './ScrapersCardList';
import { ScrapersDialogs } from './ScrapersDialogs';
import type { ScrapersRowHandlers } from './ScrapersRowActions';
import {
  SOCKET_INVALIDATE_DEBOUNCE_MS,
  paginationControlSx,
  resolveScrapersContentState,
  scrapersLiveRegionMessage,
  shouldShowBackgroundRefreshBar,
  workspaceAriaBusy,
  workspaceNoLiftHoverSx,
} from './scrapersPageBehavior';

declare global {
  interface Window {
    openedRecordingWindow?: Window | null;
  }
}

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = window.setTimeout(() => setDebouncedValue(value), delay);
    return () => window.clearTimeout(handler);
  }, [value, delay]);

  return debouncedValue;
}

function extractGotoUrl(robot: any): string | undefined {
  const metaUrl = robot?.recording_meta?.url;
  if (typeof metaUrl === 'string' && metaUrl.trim()) return metaUrl.trim();

  const workflow = robot?.recording?.workflow;
  if (!Array.isArray(workflow) || workflow.length === 0) return undefined;

  const lastPair = workflow[workflow.length - 1];
  if (!lastPair?.what) return undefined;
  const actions = Array.isArray(lastPair.what) ? lastPair.what : [];
  const gotoAction = actions.find(
    (action: any) => action && typeof action === 'object' && action.action === 'goto'
  );
  return gotoAction?.args?.[0];
}

export interface ScrapersPageProps {
  handleRunRecording: (id: string, fileName: string, params: string[]) => void;
  handleScheduleRecording: (id: string, fileName: string, params: string[]) => void;
  handleIntegrateRecording: (id: string, fileName: string, params: string[]) => void;
  handleSettingsRecording: (id: string, fileName: string, params: string[]) => void;
  handleEditRobot: (id: string, name: string, params: string[]) => void;
  handleDuplicateRobot: (id: string, name: string, params: string[]) => void;
}

export function ScrapersPage({
  handleRunRecording,
  handleScheduleRecording,
  handleIntegrateRecording,
  handleSettingsRecording,
  handleEditRobot,
  handleDuplicateRobot,
}: ScrapersPageProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'), { noSsr: true });
  const { queueSocket } = useSocketStore();

  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [searchTerm, setSearchTerm] = useState('');
  const debouncedSearchTerm = useDebounce(searchTerm, 300);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);
  const [hasBackgroundUpdates, setHasBackgroundUpdates] = useState(false);

  const [isWarningModalOpen, setWarningModalOpen] = useState(false);
  const [isDeleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [pendingRetrain, setPendingRetrain] = useState<{
    id: string;
    name: string;
    url?: string;
  } | null>(null);
  const [activeBrowserId, setActiveBrowserId] = useState('');

  const {
    notify,
    setRecordings,
    setBrowserId,
    setInitialUrl,
    setRecordingUrl,
    recordingUrl,
    rerenderRobots,
    setRerenderRobots,
    setRecordingName,
    setRecordingId,
  } = useGlobalInfoStore();

  const listQuery = useCachedRecordings({
    page: page + 1,
    limit: rowsPerPage,
    q: debouncedSearchTerm || undefined,
  });

  const summaryQuery = useCachedRecordingsSummary();

  const {
    data,
    isLoading,
    isFetching,
    isError,
    dataUpdatedAt,
    refetch,
  } = listQuery;

  const rows = data?.robots ?? [];
  const totalCount = data?.total ?? 0;
  const hasLoadedData = data != null;
  const hasActiveSearch = Boolean(debouncedSearchTerm.trim());

  const contentState = resolveScrapersContentState({
    isLoading,
    isError,
    hasLoadedData,
    rowCount: rows.length,
    hasActiveSearch,
  });

  const showRefreshBar = shouldShowBackgroundRefreshBar({
    isFetching,
    isLoading,
    hasLoadedData,
  });

  const latestSnapshotRef = useRef('');
  const buildListSignature = useCallback((payload: { total: number; rows: typeof rows }) => {
    return payload.rows
      .map((row) =>
        [
          row.id,
          row.updatedAt,
          row.lastRun?.status || '',
          row.lastRun?.finishedAt || row.lastRun?.startedAt || '',
          row.schedule.enabled ? '1' : '0',
          row.schedule.cron || '',
        ].join('|')
      )
      .concat(String(payload.total))
      .sort()
      .join('::');
  }, []);

  useEffect(() => {
    if (!hasLoadedData) return;
    latestSnapshotRef.current = buildListSignature({ total: totalCount, rows });
  }, [buildListSignature, hasLoadedData, rows, totalCount]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || !event.data) return;

      if (event.data.type === 'recording-notification') {
        const notificationData = event.data.notification;
        if (notificationData) {
          notify(notificationData.type, notificationData.message);
          if (
            (notificationData.type === 'success' &&
              (notificationData.message.includes('saved') ||
                notificationData.message.includes('retrained'))) ||
            (notificationData.type === 'warning' &&
              notificationData.message.includes('terminated'))
          ) {
            setRerenderRobots(true);
          }
        }
      }

      if (event.data.type === 'session-data-clear') {
        window.sessionStorage.removeItem('browserId');
        window.sessionStorage.removeItem('robotToRetrain');
        window.sessionStorage.removeItem('robotName');
        window.sessionStorage.removeItem('recordingUrl');
        window.sessionStorage.removeItem('recordingSessionId');
        window.sessionStorage.removeItem('pendingSessionData');
        window.sessionStorage.removeItem('nextTabIsRecording');
        window.sessionStorage.removeItem('initialUrl');
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [notify, setRerenderRobots]);

  useEffect(() => {
    if (rows.length > 0) {
      setRecordings(rows.map((row) => row.name));
    }
  }, [rows, setRecordings]);

  useEffect(() => {
    if (!rerenderRobots) return;
    void refetch();
    void summaryQuery.refetch();
    setRerenderRobots(false);
  }, [rerenderRobots, refetch, setRerenderRobots, summaryQuery]);

  useEffect(() => {
    if (!queueSocket) return;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      window.clearTimeout(timeout);
      timeout = window.setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: ['cached-recordings'] });
      }, SOCKET_INVALIDATE_DEBOUNCE_MS);
    };
    queueSocket.on('run-started', refresh);
    queueSocket.on('run-completed', refresh);
    return () => {
      window.clearTimeout(timeout);
      queueSocket.off('run-started', refresh);
      queueSocket.off('run-completed', refresh);
    };
  }, [queueSocket, queryClient]);

  useEffect(() => {
    let controller: AbortController | null = null;
    const id = window.setInterval(() => {
      if (document.hidden || isLoading || isManualRefreshing || hasBackgroundUpdates) return;
      controller?.abort();
      controller = new AbortController();
      getStoredRecordings({
        page: page + 1,
        limit: rowsPerPage,
        q: debouncedSearchTerm || undefined,
      })
        .then((fresh) => {
          const freshSig = buildListSignature({ total: fresh.total, rows: fresh.robots });
          if (freshSig && freshSig !== latestSnapshotRef.current) {
            setHasBackgroundUpdates(true);
          }
        })
        .catch(() => {
          // Silent background poll failures.
        });
    }, 180000);
    return () => {
      window.clearInterval(id);
      controller?.abort();
    };
  }, [
    buildListSignature,
    debouncedSearchTerm,
    hasBackgroundUpdates,
    isLoading,
    isManualRefreshing,
    page,
    rowsPerPage,
  ]);

  const handleManualRefresh = useCallback(async () => {
    setIsManualRefreshing(true);
    setHasBackgroundUpdates(false);
    try {
      await Promise.all([refetch(), summaryQuery.refetch()]);
    } finally {
      setIsManualRefreshing(false);
    }
  }, [refetch, summaryQuery]);

  const handleCreate = useCallback(() => {
    navigate('/robots/create');
  }, [navigate]);

  const notifyRecordingTabsToClose = (browserId: string) => {
    const closeMessage = {
      action: 'close-recording-tab',
      browserId,
      timestamp: Date.now(),
    };
    window.sessionStorage.setItem('recordingTabCloseMessage', JSON.stringify(closeMessage));

    if (window.openedRecordingWindow && !window.openedRecordingWindow.closed) {
      try {
        window.openedRecordingWindow.close();
      } catch {
        /* ignore */
      }
    }
  };

  const startRetrainRecording = (id: string, name: string, url?: string) => {
    setBrowserId('new-recording');
    setRecordingName(name);
    setRecordingId(id);

    window.sessionStorage.setItem('browserId', 'new-recording');
    window.sessionStorage.setItem('robotToRetrain', id);
    window.sessionStorage.setItem('robotName', name);
    window.sessionStorage.setItem('recordingUrl', url || recordingUrl || '');

    const sessionId = Date.now().toString();
    window.sessionStorage.setItem('recordingSessionId', sessionId);
    window.openedRecordingWindow = window.open(`/recording-setup?session=${sessionId}`, '_blank');
    window.sessionStorage.setItem('nextTabIsRecording', 'true');
  };

  const handleRetrainRobot = useCallback(
    async (id: string, name: string, listUrl: string | null) => {
      let targetUrl = listUrl || undefined;
      if (!targetUrl) {
        const detail = await getStoredRecording(id);
        targetUrl = extractGotoUrl(detail);
      }

      if (targetUrl) {
        setInitialUrl(targetUrl);
        setRecordingUrl(targetUrl);
        window.sessionStorage.setItem('initialUrl', targetUrl);
      }

      const canCreateRecording = await canCreateBrowserInState('recording');
      if (!canCreateRecording) {
        const activeId = await getActiveBrowserId();
        if (activeId) {
          setActiveBrowserId(activeId);
          setPendingRetrain({ id, name, url: targetUrl });
          setWarningModalOpen(true);
        } else {
          notify('warning', t('recordingtable.notifications.browser_limit_warning'));
        }
      } else {
        startRetrainRecording(id, name, targetUrl);
      }
    },
    [
      notify,
      setInitialUrl,
      setRecordingUrl,
      t,
      recordingUrl,
      setBrowserId,
      setRecordingName,
      setRecordingId,
    ]
  );

  const handleDiscardAndRetrain = async () => {
    if (activeBrowserId) {
      await stopRecording(activeBrowserId);
      notify('warning', t('browser_recording.notifications.terminated'));
      notifyRecordingTabsToClose(activeBrowserId);
    }
    setWarningModalOpen(false);
    if (pendingRetrain) {
      startRetrainRecording(pendingRetrain.id, pendingRetrain.name, pendingRetrain.url);
      setPendingRetrain(null);
    }
  };

  const openDeleteConfirm = useCallback((id: string) => {
    setPendingDeleteId(String(id));
    setDeleteConfirmOpen(true);
  }, []);

  const confirmDeleteRecording = useCallback(async () => {
    if (!pendingDeleteId) return;
    const hasRuns = await checkRunsForRecording(pendingDeleteId);
    if (hasRuns) {
      notify('warning', t('recordingtable.notifications.delete_warning'));
      setDeleteConfirmOpen(false);
      setPendingDeleteId(null);
      return;
    }

    const success = await deleteRecordingFromStorage(pendingDeleteId);
    if (success) {
      notify('success', t('recordingtable.notifications.delete_success'));
      await Promise.all([refetch(), summaryQuery.refetch()]);
    } else {
      notify('error', t('recordingtable.notifications.delete_failed'));
    }
    setDeleteConfirmOpen(false);
    setPendingDeleteId(null);
  }, [pendingDeleteId, notify, t, refetch, summaryQuery]);

  const pendingRow = pendingDeleteId ? rows.find((row) => row.id === pendingDeleteId) : null;

  const handlers = useMemo<ScrapersRowHandlers>(
    () => ({
      onRun: handleRunRecording,
      onSchedule: handleScheduleRecording,
      onIntegrate: handleIntegrateRecording,
      onSettings: handleSettingsRecording,
      onRetrain: handleRetrainRobot,
      onEdit: handleEditRobot,
      onDuplicate: handleDuplicateRobot,
      onDelete: openDeleteConfirm,
    }),
    [
      handleDuplicateRobot,
      handleEditRobot,
      handleIntegrateRecording,
      handleRetrainRobot,
      handleRunRecording,
      handleScheduleRecording,
      handleSettingsRecording,
      openDeleteConfirm,
    ]
  );

  const liveMessage = scrapersLiveRegionMessage({
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
        overflow: 'visible',
        gap: { xs: 1.5, md: 2 },
        p: { xs: 2, md: 3 },
        bgcolor: (muiTheme) => (muiTheme.palette.mode === 'dark' ? '#000' : FIRSTSTEP.surface),
      }}
    >
      <Box sx={{ flexShrink: 0 }}>
        <ScrapersHero
          totalCount={summaryQuery.data?.total ?? totalCount}
          dataUpdatedAt={hasLoadedData ? dataUpdatedAt : null}
          nowMs={nowMs}
          searchTerm={searchTerm}
          isRefreshing={isManualRefreshing}
          isLoading={isLoading}
          hasBackgroundUpdates={hasBackgroundUpdates}
          onSearchChange={(value) => {
            setSearchTerm(value);
            setPage(0);
          }}
          onRefresh={() => {
            void handleManualRefresh();
          }}
          onCreate={handleCreate}
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
        <ScrapersSkeleton />
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', flex: 'none', minHeight: 0, gap: 2 }}>
          {contentState !== 'load-error' ? (
            <Box sx={{ flexShrink: 0 }}>
              <ScrapersStats summary={summaryQuery.data} />
            </Box>
          ) : null}

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
              <ScrapersEmptyState
                variant="load-error"
                onRetry={() => {
                  void handleManualRefresh();
                }}
              />
            ) : contentState === 'account-empty' ? (
              <ScrapersEmptyState variant="account-empty" onCreate={handleCreate} />
            ) : contentState === 'filtered-empty' ? (
              <ScrapersEmptyState
                variant="filtered-empty"
                onClearSearch={() => {
                  setSearchTerm('');
                  setPage(0);
                }}
              />
            ) : isMobile ? (
              <ScrapersCardList rows={rows} handlers={handlers} />
            ) : (
              <ScrapersTable rows={rows} handlers={handlers} />
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
                    '& .MuiTablePagination-selectLabel, & .MuiTablePagination-displayedRows': {
                      fontVariantNumeric: 'tabular-nums',
                    },
                  },
                ]}
              />
            ) : null}
          </Paper>
        </Box>
      )}

      <ScrapersDialogs
        warningOpen={isWarningModalOpen}
        deleteOpen={isDeleteConfirmOpen}
        pendingDeleteName={pendingRow?.name}
        onCloseWarning={() => setWarningModalOpen(false)}
        onConfirmDiscardAndRetrain={() => {
          void handleDiscardAndRetrain();
        }}
        onCloseDelete={() => {
          setDeleteConfirmOpen(false);
          setPendingDeleteId(null);
        }}
        onConfirmDelete={() => {
          void confirmDeleteRecording();
        }}
      />
    </Box>
  );
}
