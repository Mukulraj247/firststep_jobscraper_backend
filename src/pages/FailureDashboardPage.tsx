import React, { useCallback, useEffect, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import RefreshIcon from '@mui/icons-material/Refresh';
import ReplayIcon from '@mui/icons-material/Replay';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { useNavigate } from 'react-router-dom';
import { listSaasRuns, runAutomation, updateRunFailureReason } from '../api/automation';
import { useGlobalInfoStore } from '../context/globalInfo';
import { useSocketStore } from '../context/socket';

const FAILURE_REASON_OPTIONS: { code: string; label: string }[] = [
  { code: 'layout_change', label: 'Layout change' },
  { code: 'captcha', label: 'CAPTCHA' },
  { code: 'browser_closed', label: 'Browser closed' },
  { code: 'navigation_error', label: 'Navigation error' },
  { code: 'timeout', label: 'Timeout' },
  { code: 'circuit_open', label: 'Host circuit open' },
  { code: 'unknown', label: 'Unknown' },
];

function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '—';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

function statusColor(status: string): 'error' | 'warning' | 'default' {
  if (status === 'failed') return 'error';
  if (status === 'dead') return 'warning';
  return 'default';
}

function anomalyLabel(anomaly: string | null | undefined, meta?: any): string | null {
  if (!anomaly) return null;
  if (anomaly === 'zero_rows') return 'Zero rows';
  if (anomaly === 'row_drop') {
    return meta?.escalated ? 'Row drop (escalated)' : 'Row drop';
  }
  return anomaly;
}

export const FailureDashboardPage = () => {
  const navigate = useNavigate();
  const { notify } = useGlobalInfoStore();
  const { queueSocket } = useSocketStore();
  const [runs, setRuns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [updatingReasonId, setUpdatingReasonId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState<'failed,dead' | 'failed' | 'dead'>('failed,dead');
  const [anomalyFilter, setAnomalyFilter] = useState<string>('');
  const [reasonFilter, setReasonFilter] = useState<string>('');
  const [countsByReason, setCountsByReason] = useState<Record<string, number>>({});
  const [q, setQ] = useState('');
  const [qDebounced, setQDebounced] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const result = await listSaasRuns({
        page: page + 1,
        limit: rowsPerPage,
        status: statusFilter,
        ...(anomalyFilter ? { anomaly: anomalyFilter } : {}),
        ...(reasonFilter ? { failureReason: reasonFilter } : {}),
        ...(qDebounced ? { q: qDebounced } : {}),
      });
      setRuns(result.runs || []);
      setTotal(result.pagination?.total ?? 0);
      setCountsByReason(result.countsByReason || {});
    } catch (error: any) {
      if (error?.response?.status !== 429) {
        notify('error', error?.response?.data?.error || 'Failed to load failed runs');
      }
    } finally {
      setLoading(false);
    }
  }, [page, rowsPerPage, statusFilter, anomalyFilter, reasonFilter, qDebounced, notify]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setPage(0);
  }, [statusFilter, anomalyFilter, reasonFilter, qDebounced]);

  useEffect(() => {
    if (!queueSocket) return;
    const refresh = () => {
      load();
    };
    queueSocket.on('run-completed', refresh);
    return () => {
      queueSocket.off('run-completed', refresh);
    };
  }, [queueSocket, load]);

  const handleRetry = async (run: any) => {
    const automationId = run.automationId || run.robotMetaId;
    if (!automationId) {
      notify('error', 'Missing automation id for retry');
      return;
    }
    try {
      setRetryingId(run.runId);
      await runAutomation(automationId);
      notify('success', `Retry queued for ${run.name || 'automation'}`);
      await load();
    } catch (error: any) {
      notify('error', error?.response?.data?.error || 'Failed to retry run');
    } finally {
      setRetryingId(null);
    }
  };

  const handleReasonOverride = async (run: any, nextReason: string) => {
    if (!run?.runId) return;
    const current = run.failureReason || '';
    if (nextReason === current) return;
    try {
      setUpdatingReasonId(run.runId);
      await updateRunFailureReason(run.runId, {
        failureReason: nextReason || null,
        confirmed: false,
      });
      notify('success', 'Failure reason updated');
      await load();
    } catch (error: any) {
      notify('error', error?.response?.data?.error || 'Failed to update failure reason');
    } finally {
      setUpdatingReasonId(null);
    }
  };

  const totalCounted = Object.values(countsByReason).reduce((a, b) => a + (b || 0), 0);

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', md: 'center' }} spacing={2} mb={3}>
        <Box>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <ErrorOutlineIcon color="error" />
            <Typography variant="h4" fontWeight={700}>
              Failure Dashboard
            </Typography>
          </Stack>
          <Typography variant="body2" color="text.secondary" mt={0.5}>
            Your failed and dead-letter runs — error details, anomalies, and retry.
          </Typography>
        </Box>
        <Button variant="outlined" startIcon={<RefreshIcon />} onClick={() => load()} disabled={loading}>
          Refresh
        </Button>
      </Stack>

      <Paper sx={{ p: 2, mb: 2 }}>
        <Typography variant="subtitle2" fontWeight={700} mb={1}>
          By reason {totalCounted > 0 ? `(${totalCounted})` : ''}
        </Typography>
        <Stack direction="row" flexWrap="wrap" gap={1} mb={2}>
          <Chip
            label={`All${totalCounted ? ` · ${totalCounted}` : ''}`}
            color={!reasonFilter ? 'primary' : 'default'}
            variant={!reasonFilter ? 'filled' : 'outlined'}
            onClick={() => setReasonFilter('')}
            sx={{ cursor: 'pointer' }}
          />
          {FAILURE_REASON_OPTIONS.map((opt) => {
            const count = countsByReason[opt.code] || 0;
            const selected = reasonFilter === opt.code;
            return (
              <Chip
                key={opt.code}
                label={`${opt.label} · ${count}`}
                color={selected ? 'primary' : 'default'}
                variant={selected ? 'filled' : 'outlined'}
                onClick={() => setReasonFilter(selected ? '' : opt.code)}
                sx={{ cursor: 'pointer' }}
              />
            );
          })}
        </Stack>

        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }}>
          <TextField
            size="small"
            label="Search name / company / ID"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            sx={{ minWidth: 260 }}
          />
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel>Status</InputLabel>
            <Select
              label="Status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            >
              <MenuItem value="failed,dead">Failed + Dead</MenuItem>
              <MenuItem value="failed">Failed only</MenuItem>
              <MenuItem value="dead">Dead only</MenuItem>
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 180 }}>
            <InputLabel>Failure reason</InputLabel>
            <Select
              label="Failure reason"
              value={reasonFilter}
              onChange={(e) => setReasonFilter(e.target.value)}
            >
              <MenuItem value="">Any</MenuItem>
              {FAILURE_REASON_OPTIONS.map((opt) => (
                <MenuItem key={opt.code} value={opt.code}>
                  {opt.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel>Anomaly</InputLabel>
            <Select
              label="Anomaly"
              value={anomalyFilter}
              onChange={(e) => setAnomalyFilter(e.target.value)}
            >
              <MenuItem value="">Any</MenuItem>
              <MenuItem value="zero_rows">Zero rows</MenuItem>
              <MenuItem value="row_drop">Row drop</MenuItem>
            </Select>
          </FormControl>
          <Typography variant="body2" color="text.secondary">
            {total} result{total === 1 ? '' : 's'}
          </Typography>
        </Stack>
      </Paper>

      <Paper>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Automation</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Failure reason</TableCell>
              <TableCell>Error</TableCell>
              <TableCell>Anomaly</TableCell>
              <TableCell>Retries</TableCell>
              <TableCell>Started</TableCell>
              <TableCell>Finished</TableCell>
              <TableCell>Duration</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading && runs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10}>
                  <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                    Loading…
                  </Typography>
                </TableCell>
              </TableRow>
            ) : runs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10}>
                  <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                    No failed runs match these filters.
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              runs.map((run) => {
                const anomaly = anomalyLabel(run.anomaly, run.anomalyMeta);
                return (
                  <TableRow key={run.runId || run._id} hover>
                    <TableCell>
                      <Typography variant="body2" fontWeight={600}>
                        {run.name || 'Run'}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" display="block">
                        {[run.companyName, run.scoutId].filter(Boolean).join(' · ') || '—'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip size="small" label={run.status} color={statusColor(run.status)} />
                    </TableCell>
                    <TableCell sx={{ minWidth: 180 }}>
                      <FormControl size="small" fullWidth>
                        <Select
                          displayEmpty
                          value={run.failureReason || ''}
                          disabled={updatingReasonId === run.runId}
                          onChange={(e) => handleReasonOverride(run, String(e.target.value))}
                          renderValue={(selected) => {
                            if (!selected) return '—';
                            const opt = FAILURE_REASON_OPTIONS.find((o) => o.code === selected);
                            return opt?.label || String(selected);
                          }}
                        >
                          {FAILURE_REASON_OPTIONS.map((opt) => (
                            <MenuItem key={opt.code} value={opt.code}>
                              {opt.label}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                      {run.failureReasonSource ? (
                        <Typography variant="caption" color="text.secondary">
                          {run.failureReasonSource}
                        </Typography>
                      ) : null}
                    </TableCell>
                    <TableCell sx={{ maxWidth: 280 }}>
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{
                          display: '-webkit-box',
                          WebkitLineClamp: 3,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                        }}
                        title={run.errorMessage || ''}
                      >
                        {run.errorMessage || '—'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {anomaly ? (
                        <Chip
                          size="small"
                          color={run.anomaly === 'zero_rows' || run.anomalyMeta?.escalated ? 'error' : 'warning'}
                          label={anomaly}
                        />
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell>{run.retryCount ?? 0}</TableCell>
                    <TableCell>
                      <Typography variant="caption">{run.startedAt || '—'}</Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption">{run.finishedAt || '—'}</Typography>
                    </TableCell>
                    <TableCell>{formatDuration(run.durationMs ?? run.duration)}</TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={1} justifyContent="flex-end">
                        <Button
                          size="small"
                          startIcon={<OpenInNewIcon />}
                          onClick={() => navigate(`/run/${run.runId}`)}
                        >
                          Details
                        </Button>
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={<ReplayIcon />}
                          disabled={retryingId === run.runId}
                          onClick={() => handleRetry(run)}
                        >
                          Retry
                        </Button>
                      </Stack>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
        <TablePagination
          component="div"
          count={total}
          page={page}
          onPageChange={(_e, next) => setPage(next)}
          rowsPerPage={rowsPerPage}
          onRowsPerPageChange={(e) => {
            setRowsPerPage(parseInt(e.target.value, 10));
            setPage(0);
          }}
          rowsPerPageOptions={[10, 25, 50, 100]}
        />
      </Paper>
    </Box>
  );
};
