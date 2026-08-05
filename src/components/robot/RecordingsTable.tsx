import * as React from 'react';
import { useTranslation } from 'react-i18next';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TablePagination from '@mui/material/TablePagination';
import TableRow from '@mui/material/TableRow';
import { memo, useCallback, useEffect, useMemo } from 'react';
import SearchIcon from '@mui/icons-material/Search';
import {
  IconButton,
  Button,
  Box,
  Typography,
  TextField,
  MenuItem,
  Menu,
  ListItemIcon,
  ListItemText,
  CircularProgress,
  Chip,
  Stack,
} from '@mui/material';
import {
  Schedule,
  DeleteForever,
  Edit,
  PlayCircle,
  Settings,
  Power,
  MoreHoriz,
  Refresh,
  ContentCopy,
  Add,
} from '@mui/icons-material';
import { useGlobalInfoStore, useCachedRecordings } from '../../context/globalInfo';
import {
  checkRunsForRecording,
  deleteRecordingFromStorage,
  getStoredRecording,
} from '../../api/storage';
import { useNavigate } from 'react-router-dom';
import { canCreateBrowserInState, getActiveBrowserId, stopRecording } from '../../api/recording';
import { GenericModal } from '../ui/GenericModal';
import { useTheme } from '@mui/material/styles';
import { RobotListSummary, RobotListType } from '../../types/robotList';

declare global {
  interface Window {
    openedRecordingWindow?: Window | null;
  }
}

interface RecordingsTableProps {
  handleEditRecording: (id: string, fileName: string) => void;
  handleRunRecording: (id: string, fileName: string, params: string[]) => void;
  handleScheduleRecording: (id: string, fileName: string, params: string[]) => void;
  handleIntegrateRecording: (id: string, fileName: string, params: string[]) => void;
  handleSettingsRecording: (id: string, fileName: string, params: string[]) => void;
  handleEditRobot: (id: string, name: string, params: string[]) => void;
  handleDuplicateRobot: (id: string, name: string, params: string[]) => void;
}

const TYPE_LABELS: Record<RobotListType, string> = {
  extract: 'Extract',
  scrape: 'Scrape',
  crawl: 'Crawl',
  search: 'Search',
};

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = React.useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);

  return debouncedValue;
}

function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const diffMs = Date.now() - t;
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return 'Just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr}h ago`;
  const days = Math.round(hr / 24);
  return `${days}d ago`;
}

function statusChip(lastRun: RobotListSummary['lastRun']) {
  if (!lastRun) {
    return <Chip size="small" label="Idle" variant="outlined" />;
  }
  const s = String(lastRun.status || '').toLowerCase();
  if (s === 'running' || s === 'queued' || s === 'scheduled') {
    return <Chip size="small" label={s === 'queued' ? 'Queued' : 'Running'} color="warning" />;
  }
  if (s === 'failed' || s === 'error' || s === 'aborted') {
    return <Chip size="small" label="Failed" color="error" />;
  }
  if (s === 'success' || s === 'completed' || s === 'done') {
    return <Chip size="small" label="Succeeded" color="success" />;
  }
  return <Chip size="small" label={lastRun.status} variant="outlined" />;
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

export const RecordingsTable = ({
  handleRunRecording,
  handleScheduleRecording,
  handleIntegrateRecording,
  handleSettingsRecording,
  handleEditRobot,
  handleDuplicateRobot,
}: RecordingsTableProps) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const [page, setPage] = React.useState(0);
  const [rowsPerPage, setRowsPerPage] = React.useState(10);
  const [searchTerm, setSearchTerm] = React.useState('');
  const debouncedSearchTerm = useDebounce(searchTerm, 300);

  const { data, isLoading: isFetching, refetch } = useCachedRecordings({
    page: page + 1,
    limit: rowsPerPage,
    q: debouncedSearchTerm || undefined,
  });

  const rows = data?.robots ?? [];
  const total = data?.total ?? 0;

  const [isWarningModalOpen, setWarningModalOpen] = React.useState(false);
  const [isDeleteConfirmOpen, setDeleteConfirmOpen] = React.useState(false);
  const [pendingDeleteId, setPendingDeleteId] = React.useState<string | null>(null);
  const [pendingRetrain, setPendingRetrain] = React.useState<{
    id: string;
    name: string;
    url?: string;
  } | null>(null);
  const [activeBrowserId, setActiveBrowserId] = React.useState('');

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
  const navigate = useNavigate();

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
      setRecordings(rows.map((r) => r.name));
    }
  }, [rows, setRecordings]);

  useEffect(() => {
    if (rerenderRobots) {
      refetch();
      setRerenderRobots(false);
    }
  }, [rerenderRobots, setRerenderRobots, refetch]);

  const handleChangePage = useCallback((_: unknown, newPage: number) => {
    setPage(newPage);
  }, []);

  const handleChangeRowsPerPage = (event: React.ChangeEvent<HTMLInputElement>) => {
    setRowsPerPage(+event.target.value);
    setPage(0);
  };

  const handleSearchChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(event.target.value);
    setPage(0);
  }, []);

  const handleNewRecording = useCallback(() => {
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
    [notify, setInitialUrl, setRecordingUrl, t, recordingUrl, setBrowserId, setRecordingName, setRecordingId]
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

  const openDeleteConfirm = React.useCallback((id: string) => {
    setPendingDeleteId(String(id));
    setDeleteConfirmOpen(true);
  }, []);

  const confirmDeleteRecording = React.useCallback(async () => {
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
      refetch();
    }
    setDeleteConfirmOpen(false);
    setPendingDeleteId(null);
  }, [pendingDeleteId, notify, t, refetch]);

  const pendingRow = pendingDeleteId ? rows.find((r) => r.id === pendingDeleteId) : null;

  const columns = useMemo(
    () => [
      { id: 'name', label: t('recordingtable.name'), minWidth: 180 },
      { id: 'type', label: t('recordingtable.type', { defaultValue: 'Type' }), minWidth: 90 },
      { id: 'status', label: t('recordingtable.status', { defaultValue: 'Status' }), minWidth: 100 },
      { id: 'schedule', label: t('recordingtable.schedule'), minWidth: 110 },
      { id: 'lastRun', label: t('recordingtable.last_run', { defaultValue: 'Last run' }), minWidth: 120 },
      { id: 'actions', label: t('recordingtable.actions', { defaultValue: 'Actions' }), minWidth: 120 },
    ],
    [t]
  );

  return (
    <React.Fragment>
      <Box display="flex" justifyContent="space-between" alignItems="flex-end" mb={1} gap={2} flexWrap="wrap">
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 600, mb: 0.25 }}>
            {t('recordingtable.heading')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('recordingtable.heading_subtitle', {
              defaultValue: 'Run, schedule, and monitor extractions',
            })}
            {total > 0 ? ` · ${total}` : ''}
          </Typography>
        </Box>
        <Box display="flex" alignItems="center" gap={2}>
          <TextField
            size="small"
            placeholder={t('recordingtable.search')}
            value={searchTerm}
            onChange={handleSearchChange}
            InputProps={{
              startAdornment: <SearchIcon sx={{ color: 'action.active', mr: 1 }} />,
            }}
            sx={{ width: { xs: '100%', sm: 250 } }}
          />
          <Button
            variant="contained"
            onClick={handleNewRecording}
            startIcon={<Add />}
            sx={{
              bgcolor: '#ff00c3',
              textTransform: 'none',
              whiteSpace: 'nowrap',
              '&:hover': { bgcolor: '#ff00c3' },
            }}
          >
            {t('recordingtable.new')}
          </Button>
        </Box>
      </Box>

      {isFetching && rows.length === 0 ? (
        <Box display="flex" justifyContent="center" alignItems="center" sx={{ minHeight: '60vh', width: '100%' }}>
          <CircularProgress size={60} />
        </Box>
      ) : rows.length === 0 ? (
        <Box
          display="flex"
          flexDirection="column"
          alignItems="center"
          justifyContent="center"
          sx={{ minHeight: 300, textAlign: 'center', color: 'text.secondary' }}
        >
          <Typography variant="h6" gutterBottom>
            {debouncedSearchTerm
              ? t('recordingtable.placeholder.search')
              : t('recordingtable.placeholder.title')}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {debouncedSearchTerm
              ? t('recordingtable.search_criteria')
              : t('recordingtable.placeholder.body')}
          </Typography>
          {!debouncedSearchTerm && (
            <Button
              variant="contained"
              onClick={handleNewRecording}
              startIcon={<Add />}
              sx={{ bgcolor: '#ff00c3', textTransform: 'none', '&:hover': { bgcolor: '#ff00c3' } }}
            >
              {t('recordingtable.new')}
            </Button>
          )}
        </Box>
      ) : (
        <>
          <TableContainer component={Paper} sx={{ width: '100%', overflow: 'hidden', mt: 1.5 }} variant="outlined">
            <Table stickyHeader size="small" aria-label="scrapers">
              <TableHead>
                <TableRow>
                  {columns.map((column) => (
                    <TableCell
                      key={column.id}
                      style={{ minWidth: column.minWidth }}
                      sx={{ fontWeight: 600, color: 'text.secondary', fontSize: '0.75rem' }}
                    >
                      {column.label}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((row) => (
                  <TableRow hover key={row.id} tabIndex={-1}>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {row.name}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {row.updatedAt || '—'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip size="small" label={TYPE_LABELS[row.type] || row.type} variant="outlined" />
                    </TableCell>
                    <TableCell>{statusChip(row.lastRun)}</TableCell>
                    <TableCell>
                      <Typography
                        variant="body2"
                        color={row.schedule.enabled ? 'text.primary' : 'text.secondary'}
                      >
                        {row.schedule.label}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">
                        {formatRelativeTime(row.lastRun?.finishedAt || row.lastRun?.startedAt)}
                      </Typography>
                      {row.lastRun && (
                        <Typography variant="caption" color="text.secondary">
                          {row.lastRun.status}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Stack direction="row" alignItems="center" spacing={0.5}>
                        <IconButton
                          aria-label={t('recordingtable.run')}
                          size="small"
                          color="primary"
                          onClick={() =>
                            handleRunRecording(row.id, row.name, row.params || [])
                          }
                        >
                          <PlayCircle />
                        </IconButton>
                        <RowActionsMenu
                          robotType={row.type}
                          onSchedule={() =>
                            handleScheduleRecording(row.id, row.name, row.params || [])
                          }
                          onIntegrate={() =>
                            handleIntegrateRecording(row.id, row.name, row.params || [])
                          }
                          onSettings={() =>
                            handleSettingsRecording(row.id, row.name, row.params || [])
                          }
                          onRetrain={() => handleRetrainRobot(row.id, row.name, row.url)}
                          onEdit={() => handleEditRobot(row.id, row.name, row.params || [])}
                          onDuplicate={() =>
                            handleDuplicateRobot(row.id, row.name, row.params || [])
                          }
                          onDelete={() => openDeleteConfirm(row.id)}
                        />
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>

          <TablePagination
            component="div"
            count={total}
            page={page}
            rowsPerPage={rowsPerPage}
            onPageChange={handleChangePage}
            onRowsPerPageChange={handleChangeRowsPerPage}
            rowsPerPageOptions={[10, 25, 50]}
          />
        </>
      )}

      <GenericModal isOpen={isWarningModalOpen} onClose={() => setWarningModalOpen(false)} modalStyle={modalStyle}>
        <div style={{ padding: '10px' }}>
          <Typography variant="h6" gutterBottom>
            {t('recordingtable.warning_modal.title')}
          </Typography>
          <Typography variant="body1" style={{ marginBottom: '20px' }}>
            {t('recordingtable.warning_modal.message')}
          </Typography>
          <Box display="flex" justifyContent="space-between" mt={2}>
            <Button onClick={handleDiscardAndRetrain} variant="contained" color="error">
              {t('recordingtable.warning_modal.discard_and_create')}
            </Button>
            <Button onClick={() => setWarningModalOpen(false)} variant="outlined">
              {t('recordingtable.warning_modal.cancel')}
            </Button>
          </Box>
        </div>
      </GenericModal>

      <GenericModal
        isOpen={isDeleteConfirmOpen}
        onClose={() => {
          setDeleteConfirmOpen(false);
          setPendingDeleteId(null);
        }}
        modalStyle={{
          ...modalStyle,
          padding: 0,
          backgroundColor: 'transparent',
          width: 'auto',
          maxWidth: '520px',
        }}
      >
        <Box
          sx={{
            padding: theme.spacing(3),
            borderRadius: 2,
            backgroundColor:
              theme.palette.mode === 'dark'
                ? theme.palette.grey[900]
                : theme.palette.background.paper,
            color: theme.palette.text.primary,
            width: { xs: '90vw', sm: '460px', md: '420px' },
            maxWidth: '90vw',
            boxSizing: 'border-box',
            mx: 'auto',
          }}
        >
          <Typography variant="h6" sx={{ fontWeight: 600 }}>
            {t('recordingtable.delete_confirm.title', {
              name: pendingRow?.name,
              defaultValue: 'Delete {{name}}?',
            })}
          </Typography>
          <Typography variant="body1" sx={{ mb: 2 }}>
            {t('recordingtable.delete_confirm.message', {
              name: pendingRow?.name,
              defaultValue: 'Are you sure you want to delete the robot "{{name}}"?',
            })}
          </Typography>
          <Box display="flex" justifyContent="flex-end" mt={2} gap={1}>
            <Button
              onClick={() => {
                setDeleteConfirmOpen(false);
                setPendingDeleteId(null);
              }}
              variant="outlined"
            >
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button onClick={confirmDeleteRecording} variant="contained" color="primary">
              {t('common.delete', { defaultValue: 'Delete' })}
            </Button>
          </Box>
        </Box>
      </GenericModal>
    </React.Fragment>
  );
};

interface RowActionsMenuProps {
  robotType: string;
  onSchedule: () => void;
  onIntegrate: () => void;
  onSettings: () => void;
  onRetrain: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

const RowActionsMenu = memo(function RowActionsMenu({
  robotType,
  onSchedule,
  onIntegrate,
  onSettings,
  onRetrain,
  onEdit,
  onDuplicate,
  onDelete,
}: RowActionsMenuProps) {
  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);
  const { t } = useTranslation();

  return (
    <>
      <IconButton
        aria-label={t('recordingtable.options')}
        size="small"
        onClick={(e) => setAnchorEl(e.currentTarget)}
      >
        <MoreHoriz />
      </IconButton>
      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={() => setAnchorEl(null)}>
        <MenuItem
          onClick={() => {
            onSchedule();
            setAnchorEl(null);
          }}
        >
          <ListItemIcon>
            <Schedule fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t('recordingtable.schedule')}</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            onIntegrate();
            setAnchorEl(null);
          }}
        >
          <ListItemIcon>
            <Power fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t('recordingtable.integrate')}</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            onSettings();
            setAnchorEl(null);
          }}
        >
          <ListItemIcon>
            <Settings fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t('recordingtable.settings')}</ListItemText>
        </MenuItem>
        {robotType !== 'scrape' && (
          <MenuItem
            onClick={() => {
              onRetrain();
              setAnchorEl(null);
            }}
          >
            <ListItemIcon>
              <Refresh fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t('recordingtable.retrain')}</ListItemText>
          </MenuItem>
        )}
        <MenuItem
          onClick={() => {
            onEdit();
            setAnchorEl(null);
          }}
        >
          <ListItemIcon>
            <Edit fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t('recordingtable.edit')}</ListItemText>
        </MenuItem>
        {robotType === 'extract' && (
          <MenuItem
            onClick={() => {
              onDuplicate();
              setAnchorEl(null);
            }}
          >
            <ListItemIcon>
              <ContentCopy fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t('recordingtable.duplicate')}</ListItemText>
          </MenuItem>
        )}
        <MenuItem
          onClick={() => {
            onDelete();
            setAnchorEl(null);
          }}
        >
          <ListItemIcon>
            <DeleteForever fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t('recordingtable.delete')}</ListItemText>
        </MenuItem>
      </Menu>
    </>
  );
});

const modalStyle = {
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  width: '30%',
  backgroundColor: 'background.paper',
  p: 4,
  height: 'fit-content',
  display: 'block',
  padding: '20px',
};
