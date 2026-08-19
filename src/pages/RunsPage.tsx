import * as React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box,
  LinearProgress,
  Paper,
  TablePagination,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { useLocation, useNavigate } from 'react-router-dom';
import { useCacheInvalidation, useCachedRunGroups, useGlobalInfoStore } from '../context/globalInfo';
import type { SaasRunGroup } from '../api/automation';
import { durationFilterParamsFromValue, jobsFilterParamsFromValue } from '../components/run/runDisplay';
import { hasActiveRunFilters, RunsFilters } from '../components/run/RunsFilters';
import { RunGroupAccordion } from '../components/run/RunGroupAccordion';
import { subscribeRunBrowserSocket } from '../components/run/useRunBrowserSocket';
import { cardSx, FIRSTSTEP } from '../components/dashboard/ops/dashboardTokens';
import { RunsHero } from '../features/runs/RunsHero';
import { RunsEmptyState } from '../features/runs/RunsEmptyState';
import { RunsSkeleton } from '../features/runs/RunsSkeleton';
import { clampRunsDate, defaultRunsDate, resolveRunsContentState } from '../features/runs/runsPageBehavior';
import {
  paginationControlSx,
  workspaceAriaBusy,
  workspaceNoLiftHoverSx,
} from '../features/failures/failuresPageBehavior';

interface RunsPageProps {
  currentInterpretationLog: string;
  abortRunHandler: (runId: string, robotName: string, browserId: string) => void;
  runId: string;
  runningRecordingName: string;
}

export const RunsPage: React.FC<RunsPageProps> = ({
  currentInterpretationLog,
  abortRunHandler,
  runId,
  runningRecordingName,
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'), { noSsr: true });

  const getUrlParams = () => {
    const path = location.pathname.replace(/\/{2,}/g, '/');
    const match = path.match(/\/runs\/([^\/]+)(?:\/run\/([^\/]+))?/);
    const robotMetaId = match?.[1]?.trim() || null;
    const urlRunId = match?.[2]?.trim() || null;
    return {
      robotMetaId: robotMetaId && robotMetaId !== 'undefined' ? robotMetaId : null,
      urlRunId: urlRunId && urlRunId !== 'undefined' ? urlRunId : null,
    };
  };

  const { robotMetaId: urlRobotMetaId, urlRunId } = getUrlParams();

  const [listPage, setListPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(20);
  const [searchInput, setSearchInput] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [dateFilter, setDateFilter] = useState(() => defaultRunsDate());
  const [statusFilter, setStatusFilter] = useState('');
  const [jobsAddedFilter, setJobsAddedFilter] = useState('');
  const [durationFilter, setDurationFilter] = useState('');
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [expandedAccordions, setExpandedAccordions] = useState<Set<string>>(new Set());

  useEffect(() => {
    const timer = setTimeout(() => setSearchDebounced(searchInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    setListPage(0);
  }, [searchDebounced, dateFilter, statusFilter, jobsAddedFilter, durationFilter]);

  const jobsFilterParams = useMemo(
    () => jobsFilterParamsFromValue(jobsAddedFilter),
    [jobsAddedFilter],
  );
  const durationFilterParams = useMemo(
    () => durationFilterParamsFromValue(durationFilter),
    [durationFilter],
  );

  const filterParams = useMemo(() => ({
    q: searchDebounced || undefined,
    date: dateFilter,
    status: statusFilter || undefined,
    ...jobsFilterParams,
    ...durationFilterParams,
  }), [searchDebounced, dateFilter, statusFilter, jobsFilterParams, durationFilterParams]);

  const {
    data: groupsPage,
    isLoading,
    isFetching,
    error,
    refetch,
  } = useCachedRunGroups({
    page: listPage + 1,
    limit: rowsPerPage,
    ...filterParams,
  });

  const { data: pinnedPage } = useCachedRunGroups({
    page: 1,
    limit: 1,
    robotMetaId: urlRobotMetaId,
    ...filterParams,
    enabled: Boolean(urlRobotMetaId),
  });

  const groups = groupsPage?.groups ?? [];
  const serverPagination = groupsPage?.pagination;
  const totalGroups = serverPagination?.total ?? groups.length;

  const displayGroups = useMemo(() => {
    const pinned = pinnedPage?.groups?.[0];
    if (!pinned || !urlRobotMetaId) return groups;
    if (groups.some((group) => group.robotMetaId === pinned.robotMetaId)) return groups;
    return [pinned, ...groups];
  }, [groups, pinnedPage, urlRobotMetaId]);

  const { notify, rerenderRuns, setRerenderRuns } = useGlobalInfoStore();
  const { invalidateRuns } = useCacheInvalidation();

  const handleAccordionChange = useCallback((robotMetaId: string, isExpanded: boolean) => {
    if (!robotMetaId) return;
    setExpandedAccordions((prev) => {
      const next = new Set(prev);
      if (isExpanded) next.add(robotMetaId);
      else next.delete(robotMetaId);
      return next;
    });
    if (isExpanded) {
      if (urlRunId) {
        navigate(`/runs/${robotMetaId}/run/${urlRunId}`);
      } else {
        navigate(`/runs/${robotMetaId}`);
      }
    } else if (urlRobotMetaId === robotMetaId) {
      navigate('/runs');
    }
  }, [navigate, urlRobotMetaId, urlRunId]);

  const handleRowExpand = useCallback((rowRunId: string, robotMetaId: string, shouldExpand: boolean) => {
    if (!rowRunId || !robotMetaId) return;
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (shouldExpand) next.add(rowRunId);
      else next.delete(rowRunId);
      return next;
    });
    navigate(
      shouldExpand
        ? `/runs/${robotMetaId}/run/${rowRunId}`
        : `/runs/${robotMetaId}`,
    );
  }, [navigate]);

  useEffect(() => {
    if (urlRunId) {
      setExpandedRows((prev) => {
        const next = new Set(prev);
        next.add(urlRunId);
        return next;
      });
    }
    if (urlRobotMetaId) {
      setExpandedAccordions((prev) => {
        const next = new Set(prev);
        next.add(urlRobotMetaId);
        return next;
      });
    }
  }, [urlRunId, urlRobotMetaId]);

  useEffect(() => {
    if (!runId) return;
    const matching = displayGroups.find((group) => group.latestRun?.runId === runId);
    if (matching?.robotMetaId) {
      setExpandedAccordions((prev) => {
        const next = new Set(prev);
        next.add(matching.robotMetaId);
        return next;
      });
      setExpandedRows((prev) => {
        const next = new Set(prev);
        next.add(runId);
        return next;
      });
    }
  }, [runId, displayGroups]);

  useEffect(() => {
    if (rerenderRuns) {
      refetch();
      setRerenderRuns(false);
    }
  }, [rerenderRuns, refetch, setRerenderRuns]);

  useEffect(() => {
    const activeIds = displayGroups
      .map((group) => group.latestRun)
      .filter((run) => run?.status === 'running' && run?.browserId)
      .slice(0, 3)
      .map((run) => String(run.browserId));

    const unsubscribers = activeIds.map((browserId) =>
      subscribeRunBrowserSocket(browserId, 'run-completed', (data: any) => {
        invalidateRuns();
        setRerenderRuns(true);
        const name = data.robotName || runningRecordingName;
        if (data.status === 'success') {
          notify('success', t('main_page.notifications.interpretation_success', { name }));
        } else if (data.status === 'anomaly') {
          notify('warning', `${name}: run finished with anomaly (${data.anomaly || 'row_drop'})`);
        } else {
          notify('error', t('main_page.notifications.interpretation_failed', { name }));
        }
      }),
    );

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [displayGroups, invalidateRuns, notify, runningRecordingName, setRerenderRuns, t]);

  const handleDelete = useCallback(() => {
    notify('success', t('runstable.notifications.delete_success', 'Run deleted successfully'));
    invalidateRuns();
    refetch();
  }, [notify, t, invalidateRuns, refetch]);

  const clearAllFilters = () => {
    setSearchInput('');
    setSearchDebounced('');
    setDateFilter(defaultRunsDate());
    setStatusFilter('');
    setJobsAddedFilter('');
    setDurationFilter('');
    setListPage(0);
  };

  const filtersValue = {
    searchInput,
    date: dateFilter,
    status: statusFilter,
    jobsAdded: jobsAddedFilter,
    duration: durationFilter,
  };
  const filtersActive = hasActiveRunFilters(filtersValue);
  const from = totalGroups === 0 ? 0 : listPage * rowsPerPage + 1;
  const to = Math.min(totalGroups, (listPage + 1) * rowsPerPage);
  const hasLoadedData = Boolean(groupsPage);
  const isRefreshing = isFetching && !isLoading;
  const contentState = resolveRunsContentState({
    isLoading,
    isError: Boolean(error),
    hasLoadedData,
    rowCount: displayGroups.length,
    hasActiveFilters: filtersActive,
  });
  const showRefreshBar = isRefreshing && hasLoadedData && contentState === 'rows';

  return (
    <Box
      sx={{
        p: { xs: 2, md: 3 },
        minHeight: '100%',
        bgcolor: (muiTheme) => (muiTheme.palette.mode === 'dark' ? '#000' : FIRSTSTEP.surface),
      }}
    >
      <RunsHero
        automationCount={totalGroups}
        isRefreshing={isRefreshing}
        isLoading={isLoading}
        isMobile={isMobile}
        onRefresh={() => { void refetch(); }}
      />

      {contentState === 'first-load-skeleton' ? (
        <RunsSkeleton />
      ) : (
        <>
          <RunsFilters
            value={filtersValue}
            resultCount={totalGroups}
            resultFrom={from}
            resultTo={to}
            isFetching={isRefreshing}
            onSearchChange={setSearchInput}
            onDateChange={(value) => { setDateFilter(clampRunsDate(value)); setListPage(0); }}
            onStatusChange={(value) => { setStatusFilter(value); setListPage(0); }}
            onJobsAddedChange={(value) => { setJobsAddedFilter(value); setListPage(0); }}
            onDurationChange={(value) => { setDurationFilter(value); setListPage(0); }}
            onClearAll={clearAllFilters}
          />

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
              <RunsEmptyState variant="load-error" onRetry={() => { void refetch(); }} />
            ) : contentState === 'account-empty' ? (
              <RunsEmptyState variant="account-empty" />
            ) : contentState === 'filtered-empty' ? (
              <RunsEmptyState variant="filtered-empty" onClearFilters={clearAllFilters} />
            ) : (
              <>
                {displayGroups.map((group: SaasRunGroup) => (
                  <RunGroupAccordion
                    key={group.robotMetaId}
                    group={group}
                    expanded={expandedAccordions.has(group.robotMetaId)}
                    onToggle={(isExpanded) => handleAccordionChange(group.robotMetaId, isExpanded)}
                    filterParams={filterParams}
                    expandedRows={expandedRows}
                    onRowExpand={handleRowExpand}
                    currentInterpretationLog={currentInterpretationLog}
                    abortRunHandler={abortRunHandler}
                    runningRecordingName={runningRecordingName}
                    urlRunId={urlRunId}
                    onDelete={handleDelete}
                  />
                ))}

                <TablePagination
                  component="div"
                  count={totalGroups}
                  page={listPage}
                  rowsPerPage={rowsPerPage}
                  onPageChange={(_event, newPage) => setListPage(newPage)}
                  onRowsPerPageChange={(event) => {
                    setRowsPerPage(+event.target.value);
                    setListPage(0);
                  }}
                  rowsPerPageOptions={[10, 20, 50, 100]}
                  labelRowsPerPage="Automations per page"
                  sx={paginationControlSx(isMobile)}
                />
              </>
            )}
          </Paper>
        </>
      )}
    </Box>
  );
};
