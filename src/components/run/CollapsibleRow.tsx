import { useCallback, useEffect, useRef, useState } from 'react';
import * as React from 'react';
import TableRow from '@mui/material/TableRow';
import TableCell from '@mui/material/TableCell';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Link,
  List,
  ListItem,
  ListItemText,
  TextField,
  Typography,
} from '@mui/material';
import { DeleteForever, KeyboardArrowDown, KeyboardArrowUp, Settings } from '@mui/icons-material';
import { deleteSaasRun, getSaasRun, getSaasRunLogs } from '../../api/automation';
import { listJobs, type JobBoardJob } from '../../api/jobs';
import { columns, type Data } from './runTypes';
import { RunContent } from './RunContent';
import { GenericModal } from '../ui/GenericModal';
import { getUserById } from '../../api/auth';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@mui/material/styles';
import { formatDuration } from './runDisplay';
import { RunStatusChip } from './RunStatusChip';
import { useRunBrowserSocket } from './useRunBrowserSocket';
import { formatRunJobAddedAt } from '../../features/jobs/jobBoardPageBehavior';

interface RunTypeChipProps {
  runByUserId?: string;
  runByScheduledId?: string;
  runByAPI: boolean;
  runBySDK?: boolean;
}

const RunTypeChip: React.FC<RunTypeChipProps> = ({ runByUserId, runByScheduledId, runByAPI, runBySDK }) => {
  const { t } = useTranslation();

  if (runByScheduledId) return <Chip label={t('runs_table.run_type_chips.scheduled_run')} color="primary" variant="outlined" />;
  if (runBySDK) return <Chip label={t('runs_table.run_type_chips.sdk')} color="primary" variant="outlined" />;
  if (runByAPI) return <Chip label={t('runs_table.run_type_chips.api')} color="primary" variant="outlined" />;
  if (runByUserId) return <Chip label={t('runs_table.run_type_chips.manual_run')} color="primary" variant="outlined" />;
  return <Chip label={t('runs_table.run_type_chips.unknown_run_type')} color="primary" variant="outlined" />;
};

interface CollapsibleRowProps {
  row: Data;
  handleDelete: () => void;
  isOpen: boolean;
  onToggleExpanded: (shouldExpand: boolean) => void;
  currentLog: string;
  abortRunHandler: (runId: string, robotName: string, browserId: string) => void;
  runningRecordingName: string;
  urlRunId: string | null;
}

export const CollapsibleRow = ({
  row,
  handleDelete,
  isOpen,
  onToggleExpanded,
  currentLog,
  abortRunHandler,
  runningRecordingName,
}: CollapsibleRowProps) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const [isDeleteOpen, setDeleteOpen] = useState(false);
  const [openSettingsModal, setOpenSettingsModal] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [detailRow, setDetailRow] = useState<Data>(row);
  const [detailLoading, setDetailLoading] = useState(false);
  const [jobsDialogOpen, setJobsDialogOpen] = useState(false);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [runJobs, setRunJobs] = useState<JobBoardJob[]>([]);
  const jobsAdded =
    typeof row.jobsAddedToBoard === 'number'
      ? row.jobsAddedToBoard
      : typeof detailRow.jobsAddedToBoard === 'number'
        ? detailRow.jobsAddedToBoard
        : 0;
  const runByLabel = row.runByScheduleId
    ? `${row.runByScheduleId}`
    : row.runByUserId
      ? `${userEmail}`
      : row.runBySDK
        ? 'SDK'
        : row.runByAPI
          ? 'API'
          : 'Unknown';

  const logEndRef = useRef<HTMLDivElement | null>(null);
  const [workflowProgress, setWorkflowProgress] = useState<{
    current: number;
    total: number;
    percentage: number;
  } | null>(null);

  useEffect(() => {
    setDetailRow((prev) => ({
      ...prev,
      ...row,
      serializableOutput: prev.serializableOutput && Object.keys(prev.serializableOutput).length
        ? prev.serializableOutput
        : row.serializableOutput,
      binaryOutput: prev.binaryOutput && Object.keys(prev.binaryOutput).length
        ? prev.binaryOutput
        : row.binaryOutput,
      log: prev.log || row.log || '',
    }));
  }, [row]);

  useEffect(() => {
    if (!isOpen || !row.runId) return;
    const hasOutput =
      (row.serializableOutput && Object.keys(row.serializableOutput).length > 0) ||
      (detailRow.serializableOutput && Object.keys(detailRow.serializableOutput).length > 0);
    if (hasOutput && detailRow.log) return;

    let cancelled = false;
    setDetailLoading(true);
    Promise.all([getSaasRun(row.runId), getSaasRunLogs(row.runId)])
      .then(([data, logPage]: any[]) => {
        if (cancelled || !data?.run) return;
        setDetailRow((prev) => ({
          ...prev,
          ...data.run,
          id: prev.id,
          duration: data.run.durationMs ?? data.run.duration ?? prev.duration,
          log: Array.isArray(logPage?.logs) ? logPage.logs.join('\n') : prev.log || '',
        }));
      })
      .catch(() => {
        /* list row remains usable without detail */
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, row.runId]);

  const onWorkflowProgress = useCallback((data: any) => {
    setWorkflowProgress(data);
  }, []);

  useRunBrowserSocket(
    row.browserId,
    'workflowProgress',
    onWorkflowProgress,
    Boolean(row.browserId) && row.status === 'running',
  );

  useEffect(() => {
    if (row.status !== 'running' && row.status !== 'queued') {
      setWorkflowProgress(null);
    }
  }, [row.status]);

  const handleAbort = () => {
    abortRunHandler(row.runId, row.name, row.browserId);
  };

  const handleRowExpand = () => {
    onToggleExpanded(!isOpen);
  };

  useEffect(() => {
    const fetchUserEmail = async () => {
      if (row.runByUserId) {
        const userData = await getUserById(row.runByUserId);
        if (userData && userData.user) {
          setUserEmail(userData.user.email);
        }
      }
    };
    fetchUserEmail();
  }, [row.runByUserId]);

  const handleConfirmDelete = async () => {
    try {
      const res = await deleteSaasRun(`${row.runId}`);
      if (res) {
        handleDelete();
      }
    } finally {
      setDeleteOpen(false);
    }
  };

  const isLive = runningRecordingName === row.name;
  const logText = (isLive && currentLog ? currentLog : detailRow.log) || currentLog || '';

  return (
    <React.Fragment>
      <TableRow sx={{ '& > *': { borderBottom: 'unset' } }} hover role="checkbox" tabIndex={-1} key={row.id}>
        <TableCell>
          <IconButton aria-label="expand row" size="small" onClick={handleRowExpand}>
            {isOpen ? <KeyboardArrowUp /> : <KeyboardArrowDown />}
          </IconButton>
        </TableCell>
        {columns.map((column) => {
          const value: any = (row as any)[column.id];
          if (value !== undefined && column.id !== 'duration') {
            return (
              <TableCell key={column.id} align={column.align}>
                {value}
              </TableCell>
            );
          }
          switch (column.id) {
            case 'runStatus':
              return (
                <TableCell key={column.id} align={column.align}>
                  <RunStatusChip status={row.status} anomaly={row.anomaly} anomalyMeta={row.anomalyMeta} />
                </TableCell>
              );
            case 'duration':
              return (
                <TableCell key={column.id} align={column.align}>
                  {row.duration != null
                    ? formatDuration(row.duration)
                    : row.status === 'running' || row.status === 'pending' || row.status === 'queued'
                      ? '...'
                      : '-'}
                </TableCell>
              );
            case 'jobsAdded':
              return (
                <TableCell key={column.id} align={column.align}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Chip size="small" label={String(jobsAdded)} variant="outlined" />
                    <Button
                      size="small"
                      variant="text"
                      onClick={async () => {
                        setJobsDialogOpen(true);
                        setJobsLoading(true);
                        try {
                          const res = await listJobs({ runId: row.runId, limit: 50 });
                          setRunJobs(res.jobs || []);
                        } catch {
                          setRunJobs([]);
                        } finally {
                          setJobsLoading(false);
                        }
                      }}
                    >
                      {t('runs_table.view_jobs', 'View jobs')}
                    </Button>
                  </Box>
                </TableCell>
              );
            case 'delete':
              return (
                <TableCell key={column.id} align={column.align}>
                  <IconButton aria-label="delete" size="small" onClick={() => setDeleteOpen(true)}>
                    <DeleteForever />
                  </IconButton>
                </TableCell>
              );
            case 'settings':
              return (
                <TableCell key={column.id} align={column.align}>
                  <IconButton aria-label="settings" size="small" onClick={() => setOpenSettingsModal(true)}>
                    <Settings />
                  </IconButton>
                  <GenericModal
                    isOpen={openSettingsModal}
                    onClose={() => setOpenSettingsModal(false)}
                    modalStyle={modalStyle}
                  >
                    <>
                      <Typography variant="h5" style={{ marginBottom: '20px' }}>
                        {t('runs_table.run_settings_modal.title')}
                      </Typography>
                      <Box style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                        <TextField
                          label={t('runs_table.run_settings_modal.labels.run_id')}
                          value={row.runId}
                          InputProps={{ readOnly: true }}
                        />
                        <TextField
                          label={
                            row.runByScheduleId
                              ? t('runs_table.run_settings_modal.labels.run_by_schedule')
                              : row.runByUserId
                                ? t('runs_table.run_settings_modal.labels.run_by_user')
                                : t('runs_table.run_settings_modal.labels.run_by_api')
                          }
                          value={runByLabel}
                          InputProps={{ readOnly: true }}
                        />
                        <Box style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <Typography variant="body1">
                            {t('runs_table.run_settings_modal.labels.run_type')}:
                          </Typography>
                          <RunTypeChip
                            runByUserId={row.runByUserId}
                            runByScheduledId={row.runByScheduleId}
                            runByAPI={row.runByAPI ?? false}
                            runBySDK={row.runBySDK}
                          />
                        </Box>
                      </Box>
                    </>
                  </GenericModal>
                </TableCell>
              );
            default:
              return null;
          }
        })}
      </TableRow>
      <TableRow>
        <TableCell style={{ paddingBottom: 0, paddingTop: 0 }} colSpan={8}>
          <Collapse in={isOpen} timeout="auto" unmountOnExit>
            {detailLoading ? (
              <Box display="flex" justifyContent="center" py={3}>
                <CircularProgress size={28} />
              </Box>
            ) : (
              <RunContent
                row={detailRow}
                abortRunHandler={handleAbort}
                currentLog={logText}
                logEndRef={logEndRef}
                interpretationInProgress={isLive}
                workflowProgress={workflowProgress}
              />
            )}
          </Collapse>
        </TableCell>
      </TableRow>

      <GenericModal isOpen={isDeleteOpen} onClose={() => setDeleteOpen(false)} modalStyle={{ ...modalStyle, padding: 0, backgroundColor: 'transparent', width: 'auto', maxWidth: '520px' }}>
        <Box sx={{ padding: theme.spacing(3), borderRadius: 2, backgroundColor: theme.palette.mode === 'dark' ? theme.palette.grey[900] : theme.palette.background.paper, color: theme.palette.text.primary, width: { xs: '90vw', sm: '460px', md: '420px' }, maxWidth: '90vw', boxSizing: 'border-box', mx: 'auto' }}>
          <Typography variant="h6" sx={{ fontWeight: 600 }}>
            {t('runs_table.delete_confirm.title', {
              name: row.name,
              defaultValue: 'Delete run "{{name}}"?',
            })}
          </Typography>
          <Typography variant="body1" sx={{ mb: 2 }}>
            {t('runs_table.delete_confirm.message', {
              name: row.name,
              defaultValue: 'Are you sure you want to delete the run "{{name}}"?',
            })}
          </Typography>
          <Box display="flex" justifyContent="flex-end" gap={1}>
            <Button onClick={() => setDeleteOpen(false)} variant="outlined">
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button onClick={handleConfirmDelete} variant="contained" color="primary">
              {t('common.delete', { defaultValue: 'Delete' })}
            </Button>
          </Box>
        </Box>
      </GenericModal>

      <Dialog open={jobsDialogOpen} onClose={() => setJobsDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t('runs_table.jobs_dialog.title', { count: jobsAdded })}</DialogTitle>
        <DialogContent dividers>
          {jobsLoading ? (
            <Box display="flex" justifyContent="center" py={3}>
              <CircularProgress size={28} />
            </Box>
          ) : runJobs.length === 0 ? (
            <Typography color="text.secondary">
              {t('runs_table.jobs_dialog.empty')}
            </Typography>
          ) : (
            <List dense>
              {runJobs.map((job) => {
                const addedAt = formatRunJobAddedAt(job.createdAt);
                return (
                <ListItem key={job.id} alignItems="flex-start">
                  <ListItemText
                    primary={job.data?.jobTitle || t('runs_table.jobs_dialog.untitled')}
                    secondary={
                      <>
                        {job.data?.companyName || '—'}
                        {addedAt ? (
                          <>
                            {' · '}
                            {addedAt}
                          </>
                        ) : null}
                        {job.data?.jobUrl ? (
                          <>
                            {' · '}
                            <Link href={job.data.jobUrl} target="_blank" rel="noopener noreferrer">
                              {t('runs_table.jobs_dialog.open')}
                            </Link>
                          </>
                        ) : null}
                      </>
                    }
                  />
                </ListItem>
                );
              })}
            </List>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setJobsDialogOpen(false)}>{t('common.close', 'Close')}</Button>
        </DialogActions>
      </Dialog>
    </React.Fragment>
  );
};

export const modalStyle = {
  top: '45%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  width: '30%',
  backgroundColor: 'background.paper',
  p: 4,
  height: 'fit-content',
  display: 'block',
  padding: '20px',
};
