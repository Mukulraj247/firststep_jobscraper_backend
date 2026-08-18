import * as React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Box,
  Button,
  Paper,
  Skeleton,
  Stack,
  TablePagination,
  Typography,
} from '@mui/material';
import { useLocation, useNavigate } from 'react-router-dom';
import { useCacheInvalidation, useCachedRunGroups, useGlobalInfoStore } from '../../context/globalInfo';
import type { SaasRunGroup } from '../../api/automation';
import { durationFilterParamsFromValue, jobsFilterParamsFromValue } from './runDisplay';
import { hasActiveRunFilters, RunsFilters } from './RunsFilters';
import { RunGroupAccordion } from './RunGroupAccordion';
import { subscribeRunBrowserSocket } from './useRunBrowserSocket';
import { columns, type Data } from './runTypes';

export { columns };
export type { Data };

interface RunsTableProps {
  currentInterpretationLog: string;
  abortRunHandler: (runId: string, robotName: string, browserId: string) => void;
  runId: string;
  runningRecordingName: string;
}

export const RunsTable: React.FC<RunsTableProps> = ({
  currentInterpretationLog,
  abortRunHandler,
  runId,
  runningRecordingName,
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();

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
  const [dateFilter, setDateFilter] = useState('');
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
    date: dateFilter || undefined,
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
    notify('success', t('runstable.notifications.delete_success'));
    invalidateRuns();
    refetch();
  }, [notify, t, invalidateRuns, refetch]);

  const clearAllFilters = () => {
    setSearchInput('');
    setSearchDebounced('');
    setDateFilter('');
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

  return (
    <React.Fragment>
      <Stack direction="row" alignItems="baseline" spacing={1.5} mb={2}>
        <Typography variant="h6" component="h2">
          {t('runstable.runs', 'Runs')}
        </Typography>
        {serverPagination?.total != null ? (
          <Typography component="span" variant="body2" color="text.secondary">
            {t('runstable.automation_count', { count: serverPagination.total })}
          </Typography>
        ) : null}
      </Stack>

      <RunsFilters
        value={filtersValue}
        resultCount={totalGroups}
        resultFrom={from}
        resultTo={to}
        isFetching={isFetching && !isLoading}
        onSearchChange={setSearchInput}
        onDateChange={(value) => { setDateFilter(value); setListPage(0); }}
        onStatusChange={(value) => { setStatusFilter(value); setListPage(0); }}
        onJobsAddedChange={(value) => { setJobsAddedFilter(value); setListPage(0); }}
        onDurationChange={(value) => { setDurationFilter(value); setListPage(0); }}
        onClearAll={clearAllFilters}
      />

      {error ? (
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={() => refetch()}>
              {t('runstable.retry', 'Retry')}
            </Button>
          }
          sx={{ mb: 2 }}
        >
          {t('runstable.load_error', 'Failed to load runs. Please try again.')}
        </Alert>
      ) : null}

      {isLoading && !groupsPage ? (
        <Stack spacing={1.25}>
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={index} variant="rounded" height={64} />
          ))}
        </Stack>
      ) : displayGroups.length === 0 ? (
        <Box
          display="flex"
          flexDirection="column"
          alignItems="center"
          justifyContent="center"
          sx={{ minHeight: 300, textAlign: 'center', color: 'text.secondary' }}
        >
          <Typography variant="h6" gutterBottom>
            {filtersActive ? t('runstable.placeholder.search') : t('runstable.placeholder.title')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {filtersActive
              ? t('runstable.placeholder.filtered')
              : t('runstable.placeholder.body')}
          </Typography>
        </Box>
      ) : (
        <>
          <Paper variant="outlined" sx={{ width: '100%', overflow: 'hidden' }}>
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
          </Paper>

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
            labelRowsPerPage={t('runstable.automations_per_page')}
          />
        </>
      )}
    </React.Fragment>
  );
};
