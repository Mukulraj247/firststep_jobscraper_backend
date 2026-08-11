import * as React from 'react';
import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { useTranslation } from 'react-i18next';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TablePagination from '@mui/material/TablePagination';
import TableRow from '@mui/material/TableRow';
import { Accordion, AccordionSummary, AccordionDetails, Typography, Box, TextField, Tooltip, CircularProgress, Alert, Button } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import SearchIcon from '@mui/icons-material/Search';
import { useLocation, useNavigate } from 'react-router-dom';
import { useGlobalInfoStore, useCachedRuns, useCacheInvalidation } from "../../context/globalInfo";
import { RunSettings } from "./RunSettings";
import { CollapsibleRow } from "./ColapsibleRow";
import { ArrowDownward, ArrowUpward, UnfoldMore } from '@mui/icons-material';
import { io, Socket } from 'socket.io-client';
import { apiUrl } from '../../apiConfig';

export const columns: readonly Column[] = [
  { id: 'runStatus', label: 'Status', minWidth: 80 },
  { id: 'name', label: 'Name', minWidth: 80 },
  { id: 'startedAt', label: 'Started At', minWidth: 80 },
  { id: 'finishedAt', label: 'Finished At', minWidth: 80 },
  { id: 'duration', label: 'Duration', minWidth: 80 },
  { id: 'settings', label: 'Settings', minWidth: 80 },
  { id: 'delete', label: 'Delete', minWidth: 80 },
];

type SortDirection = 'asc' | 'desc' | 'none';

interface AccordionSortConfig {
  [robotMetaId: string]: {
    field: keyof Data | null;
    direction: SortDirection;
  };
}

interface Column {
  id: 'runStatus' | 'name' | 'startedAt' | 'finishedAt' | 'duration' | 'delete' | 'settings';
  label: string;
  minWidth?: number;
  align?: 'right';
  format?: (value: string) => string;
}

export interface Data {
  id: number;
  status: string;
  name: string;
  startedAt: string;
  finishedAt: string;
  runByUserId?: string;
  runByScheduleId?: string;
  browserId: string;
  runByAPI?: boolean;
  runBySDK?: boolean;
  log: string;
  runId: string;
  robotId: string;
  robotMetaId: string;
  interpreterSettings: RunSettings;
  serializableOutput: any;
  binaryOutput: any;
  duration?: number | null;
}

interface RunsTableProps {
  currentInterpretationLog: string;
  abortRunHandler: (runId: string, robotName: string, browserId: string) => void;
  runId: string;
  runningRecordingName: string;
}

interface PaginationState {
  [robotMetaId: string]: {
    page: number;
    rowsPerPage: number;
  };
}

export const RunsTable: React.FC<RunsTableProps> = ({
  currentInterpretationLog,
  abortRunHandler,
  runId,
  runningRecordingName
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();

  const getUrlParams = () => {
    // Normalize accidental double slashes from bad navigations (`/runs//uuid`).
    const path = location.pathname.replace(/\/{2,}/g, '/');
    const match = path.match(/\/runs\/([^\/]+)(?:\/run\/([^\/]+))?/);
    const robotMetaId = match?.[1]?.trim() || null;
    const urlRunId = match?.[2]?.trim() || null;
    // Ignore empty / placeholder segments
    return {
      robotMetaId: robotMetaId && robotMetaId !== 'undefined' ? robotMetaId : null,
      urlRunId: urlRunId && urlRunId !== 'undefined' ? urlRunId : null,
    };
  };

  const { robotMetaId: urlRobotMetaId, urlRunId } = getUrlParams();

  const [listPage, setListPage] = useState(0); // 0-based for MUI TablePagination
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [accordionSortConfigs, setAccordionSortConfigs] = useState<AccordionSortConfig>({});

  const {
    data: runsPage,
    isLoading,
    isFetching,
    error,
    refetch,
  } = useCachedRuns({
    page: listPage + 1,
    limit: rowsPerPage,
    robotMetaId: urlRobotMetaId,
  });
  const rows = runsPage?.runs ?? [];
  const serverPagination = runsPage?.pagination;

  const handleSort = useCallback((columnId: keyof Data, robotMetaId: string) => {
    setAccordionSortConfigs(prevConfigs => {
      const currentConfig = prevConfigs[robotMetaId] || { field: null, direction: 'none' };
      const newDirection: SortDirection =
        currentConfig.field !== columnId ? 'asc' :
        currentConfig.direction === 'none' ? 'asc' :
        currentConfig.direction === 'asc' ? 'desc' : 'none';

      return {
        ...prevConfigs,
        [robotMetaId]: {
          field: newDirection === 'none' ? null : columnId,
          direction: newDirection,
        }
      };
    });
  }, []);

  const translatedColumns = useMemo(() =>
    columns.map(column => ({
      ...column,
      label: t(`runstable.${column.id}`, column.label)
    })),
    [t]
  );

  const { notify, rerenderRuns, setRerenderRuns } = useGlobalInfoStore();
  const { invalidateRuns } = useCacheInvalidation();
  
  const activeSocketsRef = useRef<Map<string, Socket>>(new Map());

  const [searchTerm, setSearchTerm] = useState('');
  const [paginationStates, setPaginationStates] = useState<PaginationState>({});
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [expandedAccordions, setExpandedAccordions] = useState<Set<string>>(new Set());

  const handleAccordionChange = useCallback((robotMetaId: string, isExpanded: boolean) => {
    if (!robotMetaId) return;
    setExpandedAccordions(prev => {
      const newSet = new Set(prev);
      if (isExpanded) {
        newSet.add(robotMetaId);
      } else {
        newSet.delete(robotMetaId);
      }
      return newSet;
    });
    
    navigate(isExpanded ? `/runs/${robotMetaId}` : '/runs');
  }, [navigate]);

  const handleRowExpand = useCallback((runId: string, robotMetaId: string, shouldExpand: boolean) => {
    if (!runId || !robotMetaId) return;
    setExpandedRows(prev => {
      const newSet = new Set(prev);
      if (shouldExpand) {
        newSet.add(runId);
      } else {
        newSet.delete(runId);
      }
      return newSet;
    });
    
    navigate(
      shouldExpand 
        ? `/runs/${robotMetaId}/run/${runId}`
        : `/runs/${robotMetaId}`
    );
  }, [navigate]);

  // Sync expandedRows and expandedAccordions with URL params
  useEffect(() => {
    if (urlRunId) {
      setExpandedRows(prev => {
        const newSet = new Set(prev);
        newSet.add(urlRunId);
        return newSet;
      });
    }
    
    if (urlRobotMetaId) {
      setExpandedAccordions(prev => {
        const newSet = new Set(prev);
        newSet.add(urlRobotMetaId);
        return newSet;
      });
    }
  }, [urlRunId, urlRobotMetaId]);

  // Auto-expand currently running robot (but allow manual collapse)
  useEffect(() => {
    if (runId && runningRecordingName) {
      const currentRunningRow = rows.find(row => 
        row.runId === runId && row.name === runningRecordingName
      );
      
      if (currentRunningRow) {
        setExpandedRows(prev => {
          const newSet = new Set(prev);
          newSet.add(currentRunningRow.runId);
          return newSet;
        });
      }
    }
  }, [runId, runningRecordingName, rows]);

  const handleAccordionPageChange = useCallback((_event: unknown, newPage: number) => {
    setListPage(newPage);
  }, []);
  
  const handleAccordionsPerPageChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setRowsPerPage(+event.target.value);
    setListPage(0);
  }, []);

  // Reset page when deep-link robot changes
  useEffect(() => {
    setListPage(0);
  }, [urlRobotMetaId]);

  const handleChangePage = useCallback((robotMetaId: string, newPage: number) => {
    setPaginationStates(prev => ({
      ...prev,
      [robotMetaId]: {
        ...prev[robotMetaId],
        page: newPage
      }
    }));
  }, []);

  const handleChangeRowsPerPage = useCallback((robotMetaId: string, newRowsPerPage: number) => {
    setPaginationStates(prev => ({
      ...prev,
      [robotMetaId]: {
        page: 0,
        rowsPerPage: newRowsPerPage
      }
    }));
  }, []);

  const getPaginationState = useCallback((robotMetaId: string) => {
    const defaultState = { page: 0, rowsPerPage: 10 };
    
    if (!paginationStates[robotMetaId]) {
      setTimeout(() => {
        setPaginationStates(prev => ({
          ...prev,
          [robotMetaId]: defaultState
        }));
      }, 0);
      return defaultState;
    }
    return paginationStates[robotMetaId];
  }, [paginationStates]);

  const debouncedSearch = useCallback((fn: Function, delay: number) => {
    let timeoutId: NodeJS.Timeout;
    return (...args: any[]) => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => fn(...args), delay);
    };
  }, []);

  const handleSearchChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const debouncedSetSearch = debouncedSearch((value: string) => {
      setSearchTerm(value);
      setListPage(0);
      setPaginationStates(prev => {
        const reset = Object.keys(prev).reduce((acc, robotId) => ({
          ...acc,
          [robotId]: { ...prev[robotId], page: 0 }
        }), {});
        return reset;
      });
    }, 300);
    debouncedSetSearch(event.target.value);
  }, [debouncedSearch]);


  // Handle rerender requests using cache invalidation
  useEffect(() => {
    if (rerenderRuns) {
      // Invalidate cache to force refetch
      refetch();
      setRerenderRuns(false);
    }
  }, [rerenderRuns, refetch, setRerenderRuns]);

  useEffect(() => {
    if (!rows || rows.length === 0) return;

    const activeRuns = rows.filter((row: Data) =>
      row.status === 'running' && row.browserId && row.browserId.trim() !== ''
    );

    const MAX_LIVE_SOCKETS = 3;
    const capped = activeRuns.slice(0, MAX_LIVE_SOCKETS);

    capped.forEach((run: Data) => {
      const { browserId, name } = run;
      if (activeSocketsRef.current.has(browserId)) return;

      try {
        const socket = io(`${apiUrl}/${browserId}`, {
          transports: ['websocket', 'polling'],
          rejectUnauthorized: false,
        });

        socket.on('run-completed', (data: any) => {
          invalidateRuns();
          setRerenderRuns(true);
          if (data.status === 'success') {
            notify('success', t('main_page.notifications.interpretation_success', { name: data.robotName || name }));
          } else if (data.status === 'anomaly') {
            notify('warning', `${data.robotName || name}: run finished with anomaly (${data.anomaly || 'row_drop'})`);
          } else {
            notify('error', t('main_page.notifications.interpretation_failed', { name: data.robotName || name }));
          }
          socket.disconnect();
          activeSocketsRef.current.delete(browserId);
        });

        socket.on('disconnect', () => {
          activeSocketsRef.current.delete(browserId);
        });

        activeSocketsRef.current.set(browserId, socket);
      } catch (error) {
        console.error(`[RunsTable] Error connecting to browser ${browserId}:`, error);
      }
    });

    const activeBrowserIds = new Set(capped.map((run: Data) => run.browserId));
    activeSocketsRef.current.forEach((socket, browserId) => {
      if (!activeBrowserIds.has(browserId)) {
        socket.disconnect();
        activeSocketsRef.current.delete(browserId);
      }
    });
  }, [rows, notify, t, invalidateRuns, setRerenderRuns]);

  useEffect(() => {
    return () => {
      console.log('[RunsTable] Cleaning up all socket connections');
      activeSocketsRef.current.forEach((socket) => {
        socket.disconnect();
      });
      activeSocketsRef.current.clear();
    };
  }, []);

  const handleDelete = useCallback(() => {
    notify('success', t('runstable.notifications.delete_success'));
    refetch();
  }, [notify, t, refetch]);

  // Filter rows based on search term (within the current server page)
  const filteredRows = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((row) =>
      String(row.name || '').toLowerCase().includes(term)
    );
  }, [rows, searchTerm]);

  const parseDateString = (dateStr: string): Date => {
    try {
      if (dateStr.includes('PM') || dateStr.includes('AM')) {
        return new Date(dateStr);
      }
      
      return new Date(dateStr.replace(/(\d+)\/(\d+)\//, '$2/$1/'))
    } catch {
      return new Date(0);
    }
  };

  const groupedRows = useMemo(() => {
    const groupedData = filteredRows.reduce((acc, row) => {
      if (!acc[row.robotMetaId]) {
        acc[row.robotMetaId] = [];
      }
      acc[row.robotMetaId].push(row);
      return acc;
    }, {} as Record<string, Data[]>);
  
    Object.keys(groupedData).forEach(robotId => {
      groupedData[robotId].sort((a: any, b: any) => 
        parseDateString(b.startedAt).getTime() - parseDateString(a.startedAt).getTime()
      );
    });
  
    const robotEntries = Object.entries(groupedData).map(([robotId, runs]) => ({
      robotId,
      runs: runs as Data[],
      latestRunDate: parseDateString((runs as Data[])[0].startedAt).getTime()
    }));
  
    robotEntries.sort((a, b) => b.latestRunDate - a.latestRunDate);
  
    return robotEntries.reduce((acc, { robotId, runs }) => {
      acc[robotId] = runs;
      return acc;
    }, {} as Record<string, Data[]>);
  }, [filteredRows]);

  const renderTableRows = useCallback((data: Data[], robotMetaId: string) => {
    const { page, rowsPerPage } = getPaginationState(robotMetaId);
    const start = page * rowsPerPage;
    const end = start + rowsPerPage;

    let sortedData = [...data];
    const sortConfig = accordionSortConfigs[robotMetaId];
    
    if (sortConfig?.field === 'startedAt' || sortConfig?.field === 'finishedAt') {
      if (sortConfig.direction !== 'none') {
        sortedData.sort((a, b) => {
          const dateA = parseDateString(a[sortConfig.field!]);
          const dateB = parseDateString(b[sortConfig.field!]);
          
          return sortConfig.direction === 'asc' 
            ? dateA.getTime() - dateB.getTime() 
            : dateB.getTime() - dateA.getTime();
        });
      }
    }
    
    return sortedData
      .slice(start, end)
      .map((row) => (
        <CollapsibleRow
          key={`row-${row.id}`}
          row={row}
          handleDelete={handleDelete}
          isOpen={expandedRows.has(row.runId)}
          onToggleExpanded={(shouldExpand) => handleRowExpand(row.runId, row.robotMetaId, shouldExpand)}
          currentLog={currentInterpretationLog}
          abortRunHandler={abortRunHandler}
          runningRecordingName={runningRecordingName}
          urlRunId={urlRunId}
        />
      ));
  }, [paginationStates, runId, runningRecordingName, currentInterpretationLog, abortRunHandler, handleDelete, accordionSortConfigs]);

  const renderSortIcon = useCallback((column: Column, robotMetaId: string) => {
    const sortConfig = accordionSortConfigs[robotMetaId];
    if (column.id !== 'startedAt' && column.id !== 'finishedAt') return null;

    if (sortConfig?.field !== column.id) {
      return (
        <UnfoldMore 
          fontSize="small" 
          sx={{ 
            opacity: 0.3,
            transition: 'opacity 0.2s',
            '.MuiTableCell-root:hover &': {
              opacity: 1
            }
          }} 
        />
      );
    }

    return sortConfig.direction === 'asc' 
      ? <ArrowUpward fontSize="small" />
      : sortConfig.direction === 'desc'
        ? <ArrowDownward fontSize="small" />
        : <UnfoldMore fontSize="small" />;
  }, [accordionSortConfigs]);

  return (
    <React.Fragment>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
        <Typography variant="h6" component="h2">
          {t('runstable.runs', 'Runs')}
          {serverPagination?.total != null ? (
            <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 1.5 }}>
              ({serverPagination.total})
            </Typography>
          ) : null}
        </Typography>
        <TextField
          size="small"
          placeholder={t('runstable.search', 'Search runs...')}
          onChange={handleSearchChange}
          InputProps={{
            startAdornment: <SearchIcon sx={{ color: 'action.active', mr: 1 }} />
          }}
          sx={{ width: '250px' }}
        />
      </Box>

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
          {t('runstable.load_error', 'Failed to load runs. Please try again.')}
        </Alert>
      ) : null}

      {isLoading && !runsPage ? (
        <Box
          display="flex"
          justifyContent="center"
          alignItems="center"
          sx={{
            minHeight: '60vh',
            width: '100%'
          }}
        >
          <CircularProgress size={60} />
        </Box>
      ) : Object.keys(groupedRows).length === 0 ? (
        <Box
          display="flex"
          flexDirection="column"
          alignItems="center"
          justifyContent="center"
          sx={{
            minHeight: 300,
            textAlign: 'center',
            color: 'text.secondary'
          }}
        >
          <Typography variant="h6" gutterBottom>
            {searchTerm ? t('runstable.placeholder.search') : t('runstable.placeholder.title')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {searchTerm
              ? t('recordingtable.search_criteria')
              : t('runstable.placeholder.body')
            }
          </Typography>
        </Box>
      ) : (
        <>
          {isFetching && !isLoading ? (
            <Box display="flex" justifyContent="flex-end" mb={1}>
              <CircularProgress size={18} />
            </Box>
          ) : null}
          <TableContainer component={Paper} sx={{ width: '100%', overflow: 'hidden' }}>
            {Object.entries(groupedRows).map(([robotMetaId, data]) => (
                <Accordion
                  key={robotMetaId}
                  expanded={
                    urlRobotMetaId
                      ? expandedAccordions.has(robotMetaId) || robotMetaId === urlRobotMetaId
                      : expandedAccordions.has(robotMetaId)
                  }
                  onChange={(_event, isExpanded) => handleAccordionChange(robotMetaId, isExpanded)}
                  TransitionProps={{ unmountOnExit: true }}
                >
                  <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <Typography variant="h6">
                      {(data[0]?.name || data[data.length - 1]?.name || 'Automation')}
                      <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 1 }}>
                        ({data.length} on this page)
                      </Typography>
                    </Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <Table stickyHeader aria-label="sticky table">
                      <TableHead>
                        <TableRow>
                          <TableCell />
                          {translatedColumns.map((column) => (
                            <TableCell
                              key={column.id}
                              align={column.align}
                              style={{
                                minWidth: column.minWidth,
                                cursor: column.id === 'startedAt' || column.id === 'finishedAt' ? 'pointer' : 'default'
                              }}
                              onClick={() => {
                                if (column.id === 'startedAt' || column.id === 'finishedAt') {
                                  handleSort(column.id, robotMetaId);
                                }
                              }}
                            >
                              <Tooltip
                                title={
                                  (column.id === 'startedAt' || column.id === 'finishedAt')
                                    ? t('runstable.sort_tooltip')
                                    : ''
                                }
                              >
                                <Box sx={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 1,
                                  '&:hover': {
                                    '& .sort-icon': {
                                      opacity: 1
                                    }
                                  }
                                }}>
                                  {column.label}
                                  <Box className="sort-icon" sx={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    opacity: accordionSortConfigs[robotMetaId]?.field === column.id ? 1 : 0.3,
                                    transition: 'opacity 0.2s'
                                  }}>
                                    {renderSortIcon(column, robotMetaId)}
                                  </Box>
                                </Box>
                              </Tooltip>
                            </TableCell>
                          ))}
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {renderTableRows(data, robotMetaId)}
                      </TableBody>
                    </Table>

                    <TablePagination
                      component="div"
                      count={data.length}
                      rowsPerPage={getPaginationState(robotMetaId).rowsPerPage}
                      page={getPaginationState(robotMetaId).page}
                      onPageChange={(_, newPage) =>
                        handleChangePage(robotMetaId, newPage)
                      }
                      onRowsPerPageChange={(e) =>
                        handleChangeRowsPerPage(robotMetaId, parseInt(e.target.value, 10))
                      }
                      rowsPerPageOptions={[5, 10, 25]}
                    />
                  </AccordionDetails>
                </Accordion>
              ))}
          </TableContainer>

          <TablePagination
            component="div"
            count={serverPagination?.total ?? filteredRows.length}
            page={listPage}
            rowsPerPage={rowsPerPage}
            onPageChange={handleAccordionPageChange}
            onRowsPerPageChange={handleAccordionsPerPageChange}
            rowsPerPageOptions={[10, 25, 50, 100]}
            labelRowsPerPage={t('runstable.rows_per_page', 'Runs per page')}
          />
        </>
      )}
    </React.Fragment>
  );
};
