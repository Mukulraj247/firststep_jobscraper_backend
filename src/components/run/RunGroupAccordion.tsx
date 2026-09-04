import { useCallback, useMemo, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import WorkOutlineIcon from '@mui/icons-material/WorkOutline';
import RepeatIcon from '@mui/icons-material/Repeat';
import TimerOutlinedIcon from '@mui/icons-material/TimerOutlined';
import { ArrowDownward, ArrowUpward, UnfoldMore } from '@mui/icons-material';
import type { SaasRunGroup } from '../../api/automation';
import { useCachedRunsForAutomation } from '../../context/globalInfo';
import { FIRSTSTEP, tint } from '../dashboard/ops/dashboardTokens';
import { GROUP_META_CHIP_SX, groupMetaLabel } from '../../features/runs/runsPageBehavior';
import { CollapsibleRow } from './CollapsibleRow';
import { RunStatusChip } from './RunStatusChip';
import { formatDuration, formatRelativeTime } from './runDisplay';
import { columns, type Column, type Data, type SortDirection } from './runTypes';

function parseDateString(dateStr: string): Date {
  try {
    if (!dateStr) return new Date(0);
    if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
      return new Date(dateStr);
    }
    const candidates: number[] = [];
    const add = (ms: number) => {
      if (!Number.isNaN(ms)) candidates.push(ms);
    };
    add(Date.parse(dateStr));
    const slash = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})([\s,].*)?$/i);
    if (slash && slash[1] !== slash[2]) {
      add(Date.parse(`${slash[2]}/${slash[1]}/${slash[3]}${slash[4] || ''}`));
    }
    if (!candidates.length) return new Date(0);
    const now = Date.now();
    candidates.sort((a, b) => Math.abs(now - a) - Math.abs(now - b));
    return new Date(candidates[0]);
  } catch {
    return new Date(0);
  }
}

export function RunGroupAccordion({
  group,
  expanded,
  onToggle,
  filterParams,
  expandedRows,
  onRowExpand,
  currentInterpretationLog,
  abortRunHandler,
  runningRecordingName,
  urlRunId,
  onDelete,
}: {
  group: SaasRunGroup;
  expanded: boolean;
  onToggle: (expanded: boolean) => void;
  filterParams: {
    q?: string;
    date?: string;
    status?: string;
    minJobsAdded?: number;
    jobsAddedExact?: number;
    minDurationMs?: number;
    maxDurationMs?: number;
  };
  expandedRows: Set<string>;
  onRowExpand: (runId: string, robotMetaId: string, shouldExpand: boolean) => void;
  currentInterpretationLog: string;
  abortRunHandler: (runId: string, robotName: string, browserId: string) => void;
  runningRecordingName: string;
  urlRunId: string | null;
  onDelete: () => void;
}) {
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [sortField, setSortField] = useState<keyof Data | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>('none');

  const {
    data: runsPage,
    isLoading,
    isFetching,
    error,
    refetch,
  } = useCachedRunsForAutomation(group.robotMetaId, {
    page: page + 1,
    limit: rowsPerPage,
    ...filterParams,
    enabled: expanded,
  });

  const rows = runsPage?.runs ?? [];
  const total = runsPage?.pagination?.total ?? group.runCount;

  const translatedColumns = useMemo(
    () => columns.map((column) => ({ ...column })),
    [],
  );

  const handleSort = (columnId: keyof Data) => {
    const nextDirection: SortDirection =
      sortField !== columnId ? 'asc'
        : sortDirection === 'none' ? 'asc'
          : sortDirection === 'asc' ? 'desc'
            : 'none';
    setSortField(nextDirection === 'none' ? null : columnId);
    setSortDirection(nextDirection);
  };

  const sortedRows = useMemo(() => {
    if (sortField !== 'startedAt' && sortField !== 'finishedAt') return rows;
    if (sortDirection === 'none') return rows;
    return [...rows].sort((a, b) => {
      const dateA = parseDateString(a[sortField] as string);
      const dateB = parseDateString(b[sortField] as string);
      return sortDirection === 'asc'
        ? dateA.getTime() - dateB.getTime()
        : dateB.getTime() - dateA.getTime();
    });
  }, [rows, sortField, sortDirection]);

  const renderSortIcon = useCallback((column: Column) => {
    if (column.id !== 'startedAt' && column.id !== 'finishedAt') return null;
    if (sortField !== column.id) {
      return <UnfoldMore fontSize="small" sx={{ opacity: 0.3 }} />;
    }
    if (sortDirection === 'asc') return <ArrowUpward fontSize="small" />;
    if (sortDirection === 'desc') return <ArrowDownward fontSize="small" />;
    return <UnfoldMore fontSize="small" />;
  }, [sortField, sortDirection]);

  const latest = group.latestRun || {};
  const jobsAdded =
    typeof latest.jobsBoardReady === 'number'
      ? latest.jobsBoardReady
      : typeof latest.jobsAddedToBoard === 'number'
        ? latest.jobsAddedToBoard
        : 0;
  const durationMs = latest.durationMs ?? latest.duration ?? null;

  return (
    <Accordion
      expanded={expanded}
      onChange={(_event, isExpanded) => onToggle(isExpanded)}
      TransitionProps={{ unmountOnExit: true }}
      disableGutters
      sx={{
        '&:before': { display: 'none' },
        borderBottom: '1px solid',
        borderColor: 'divider',
        transition: 'background-color 0.15s ease',
        '&:hover': {
          backgroundColor: tint(FIRSTSTEP.teal, 0.03),
        },
        '&.Mui-expanded': {
          backgroundColor: tint(FIRSTSTEP.teal, 0.06),
        },
      }}
    >
      <AccordionSummary
        expandIcon={<ExpandMoreIcon />}
        sx={{
          '& .MuiAccordionSummary-content': {
            my: 1.25,
            overflow: 'hidden',
          },
        }}
      >
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1.5}
          alignItems={{ sm: 'center' }}
          justifyContent="space-between"
          sx={{ width: '100%', pr: 1 }}
        >
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, color: FIRSTSTEP.navy }} noWrap>
              {group.name || 'Untitled automation'}
            </Typography>
            {group.companyName ? (
              <Typography variant="body2" color="text.secondary" noWrap>
                {group.companyName}
              </Typography>
            ) : null}
          </Box>
          <Stack
            direction="row"
            spacing={0.75}
            alignItems="center"
            flexWrap="wrap"
            useFlexGap
            sx={{ maxWidth: '100%', justifyContent: { xs: 'flex-start', sm: 'flex-end' } }}
          >
            <RunStatusChip status={latest.status} anomaly={latest.anomaly} anomalyMeta={latest.anomalyMeta} />
            <Chip
              size="small"
              icon={<AccessTimeIcon sx={{ fontSize: '0.9rem !important' }} />}
              label={groupMetaLabel('lastRun', formatRelativeTime(latest.startedAt))}
              sx={GROUP_META_CHIP_SX}
            />
            <Chip
              size="small"
              icon={<WorkOutlineIcon sx={{ fontSize: '0.9rem !important' }} />}
              label={groupMetaLabel('jobs', jobsAdded)}
              sx={GROUP_META_CHIP_SX}
            />
            {durationMs != null ? (
              <Chip
                size="small"
                icon={<TimerOutlinedIcon sx={{ fontSize: '0.9rem !important' }} />}
                label={formatDuration(durationMs)}
                sx={GROUP_META_CHIP_SX}
              />
            ) : null}
            <Chip
              size="small"
              icon={<RepeatIcon sx={{ fontSize: '0.9rem !important' }} />}
              label={groupMetaLabel('runCount', group.runCount)}
              sx={GROUP_META_CHIP_SX}
            />
          </Stack>
        </Stack>
      </AccordionSummary>
      <AccordionDetails sx={{ pt: 0 }}>
        {error ? (
          <Alert
            severity="error"
            action={
              <Button color="inherit" size="small" onClick={() => refetch()}>
                Retry
              </Button>
            }
            sx={{ mb: 2 }}
          >
            Failed to load runs. Please try again.
          </Alert>
        ) : null}

        {isLoading && !runsPage ? (
          <Stack spacing={1} py={1}>
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} variant="rounded" height={44} />
            ))}
          </Stack>
        ) : (
          <>
            {isFetching && !isLoading ? (
              <Box display="flex" justifyContent="flex-end" mb={1}>
                <CircularProgress size={16} />
              </Box>
            ) : null}
            <TableContainer sx={{ overflowX: 'auto', maxWidth: '100%' }}>
              <Table stickyHeader aria-label="sticky table" size="small">
                <TableHead>
                  <TableRow>
                    <TableCell />
                    {translatedColumns.map((column) => (
                      <TableCell
                        key={column.id}
                        align={column.align}
                        style={{
                          minWidth: column.minWidth,
                          cursor: column.id === 'startedAt' || column.id === 'finishedAt' ? 'pointer' : 'default',
                        }}
                        onClick={() => {
                          if (column.id === 'startedAt' || column.id === 'finishedAt') {
                            handleSort(column.id);
                          }
                        }}
                      >
                        <Tooltip
                          title={
                            column.id === 'startedAt' || column.id === 'finishedAt'
                              ? 'Click to sort'
                              : ''
                          }
                        >
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            {column.label}
                            {renderSortIcon(column)}
                          </Box>
                        </Tooltip>
                      </TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {sortedRows.map((row) => (
                    <CollapsibleRow
                      key={`row-${row.runId || row.id}`}
                      row={row}
                      handleDelete={onDelete}
                      isOpen={expandedRows.has(row.runId)}
                      onToggleExpanded={(shouldExpand) => onRowExpand(row.runId, row.robotMetaId, shouldExpand)}
                      currentLog={currentInterpretationLog}
                      abortRunHandler={abortRunHandler}
                      runningRecordingName={runningRecordingName}
                      urlRunId={urlRunId}
                    />
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            <TablePagination
              component="div"
              count={total}
              rowsPerPage={rowsPerPage}
              page={page}
              onPageChange={(_, newPage) => setPage(newPage)}
              onRowsPerPageChange={(event) => {
                setRowsPerPage(parseInt(event.target.value, 10));
                setPage(0);
              }}
              rowsPerPageOptions={[5, 10, 25, 50]}
              labelRowsPerPage="Runs per page"
            />
          </>
        )}
      </AccordionDetails>
    </Accordion>
  );
}
