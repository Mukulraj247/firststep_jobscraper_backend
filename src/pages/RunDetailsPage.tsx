import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Button, Chip, LinearProgress, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AUTOMATION_ROW_CONTEXT_KEYS,
  getSaasRun,
  getSaasRunLogs,
  getSaasRunRows,
  updateRunFailureReason,
} from '../api/automation';
import {
  nextTrackedRunStatus,
  shouldRefreshRunDetails,
} from '../utils/runDetailsPolling';

const RUN_DETAIL_COLUMN_LABELS: Record<string, string> = {
  sectorIndustry: 'Sector / industry',
  f500: 'F500',
};
import { useGlobalInfoStore } from '../context/globalInfo';

const ACTIVE_STATUSES = new Set(['running', 'pending', 'queued']);

export const RunDetailsPage = () => {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { notify } = useGlobalInfoStore();
  const [data, setData] = useState<any>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [rowsCursor, setRowsCursor] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [logsCursor, setLogsCursor] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadRun = useCallback(async () => {
    try {
      const result = await getSaasRun(id);
      setData(result);
      return result;
    } catch (error: any) {
      if (error?.response?.status !== 429) {
        notify('error', error?.response?.data?.error || 'Failed to load run details');
      }
      return null;
    }
  }, [id, notify]);

  const loadRows = useCallback(async (cursor?: string | null, append = false) => {
    try {
      setDetailLoading(true);
      const result = await getSaasRunRows(id, cursor);
      setRows((current) => (append ? [...current, ...result.rows] : result.rows));
      setRowsCursor(result.nextCursor);
    } catch (error: any) {
      notify('error', error?.response?.data?.error || 'Failed to load run rows');
    } finally {
      setDetailLoading(false);
    }
  }, [id, notify]);

  const loadLogs = useCallback(async (cursor?: string | null, append = false) => {
    try {
      const result = await getSaasRunLogs(id, cursor);
      setLogs((current) => (append ? [...result.logs, ...current] : result.logs));
      setLogsCursor(result.nextCursor);
    } catch (error: any) {
      notify('error', error?.response?.data?.error || 'Failed to load run logs');
    }
  }, [id, notify]);

  const [failureBusy, setFailureBusy] = useState(false);

  const handleFailureReason = async (payload: { failureReason: string | null; confirmed?: boolean }) => {
    try {
      setFailureBusy(true);
      await updateRunFailureReason(id, payload);
      notify('success', payload.failureReason ? 'Failure reason updated' : 'Failure reason cleared');
      await loadRun();
    } catch (error: any) {
      notify('error', error?.response?.data?.error || 'Failed to update failure reason');
    } finally {
      setFailureBusy(false);
    }
  };

  // Initial load + polling while run is active
  useEffect(() => {
    setRows([]);
    setLogs([]);
    setRowsCursor(null);
    setLogsCursor(null);
    loadRun().then((result) => {
      if (result) {
        void loadRows();
        void loadLogs();
      }
      if (result && ACTIVE_STATUSES.has(result.run?.status)) {
        let previousStatus = result.run?.status;
        pollRef.current = setInterval(async () => {
          const updated = await loadRun();
          const nextStatus = updated?.run?.status;
          if (updated && shouldRefreshRunDetails(previousStatus, nextStatus)) {
            if (pollRef.current) {
              clearInterval(pollRef.current);
              pollRef.current = null;
            }
            setRowsCursor(null);
            setLogsCursor(null);
            await Promise.all([
              loadRows(null, false),
              loadLogs(null, false),
            ]);
          }
          previousStatus = nextTrackedRunStatus(previousStatus, nextStatus);
        }, 3000);
      }
    });

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [loadLogs, loadRows, loadRun]);

  const columns = useMemo<string[]>(() => {
    if (!rows.length) return [];
    const keySet = new Set<string>();
    rows.forEach((row: any) => {
      Object.keys(row.data || {}).forEach((k) => keySet.add(k));
    });
    const keys = Array.from(keySet);
    const ctxSet = new Set<string>(AUTOMATION_ROW_CONTEXT_KEYS);
    const rest = keys.filter((k) => !ctxSet.has(k)).sort((a, b) => a.localeCompare(b));
    return [...AUTOMATION_ROW_CONTEXT_KEYS.filter((k) => keys.includes(k)), ...rest];
  }, [rows]);

  if (!data) {
    return <Box sx={{ p: 4 }}><Typography>Loading run details...</Typography></Box>;
  }

  return (
    <Box sx={{ p: 4 }}>
      <Box sx={{ mb: 2, display: 'flex', justifyContent: 'flex-end' }}>
        <Button
          variant="outlined"
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate('/dashboard')}
        >
          Back to Dashboard
        </Button>
      </Box>
      <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', md: 'center' }} spacing={2} mb={3}>
        <Box>
          <Typography variant="h4" fontWeight={700}>Run Details</Typography>
          <Typography variant="body1" color="text.secondary">
            {data.automation.name}
            {data.automation.scoutId ? ` · ${data.automation.scoutId}` : ''}
            {data.automation.companyName ? ` · ${data.automation.companyName}` : ''}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" onClick={() => navigate(`/automation/${data.automation.id}/data`)}>View Data</Button>
        </Stack>
      </Stack>

      {ACTIVE_STATUSES.has(data.run.status) && (
        <LinearProgress sx={{ mb: 2, borderRadius: 1 }} />
      )}

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} mb={3}>
        <Paper sx={{ p: 2, minWidth: 180 }}>
          <Typography variant="overline">Status</Typography>
          <Typography variant="h6"><Chip label={data.run.status} color={data.run.status === 'success' || data.run.status === 'completed' ? 'success' : data.run.status === 'failed' ? 'error' : data.run.status === 'pending' ? 'info' : 'warning'} /></Typography>
          {data.run.anomaly ? (
            <Chip
              sx={{ mt: 1 }}
              size="small"
              color={data.run.anomalyMeta?.escalated || data.run.anomaly === 'zero_rows' ? 'error' : 'warning'}
              label={
                data.run.anomaly === 'zero_rows'
                  ? 'Zero rows'
                  : data.run.anomalyMeta?.escalated
                    ? 'Row drop (escalated)'
                    : 'Row drop'
              }
            />
          ) : null}
          {data.run.anomalyMeta?.baseline != null ? (
            <Typography variant="caption" display="block" color="text.secondary" mt={0.5}>
              Baseline {data.run.anomalyMeta.baseline} → {data.run.rowsExtracted ?? data.run.anomalyMeta.current ?? 0}
            </Typography>
          ) : null}
          {(data.run.failureReason || data.run.status === 'failed') && (
            <Box mt={1.5}>
              <Typography variant="overline" display="block">Failure reason</Typography>
              {data.run.failureReason ? (
                <Chip
                  size="small"
                  color={data.run.failureReasonSource === 'confirmed' ? 'error' : 'warning'}
                  label={
                    data.run.failureReason === 'layout_change'
                      ? data.run.failureReasonSource === 'confirmed'
                        ? 'Layout change (confirmed)'
                        : data.run.failureReasonSource === 'suggested'
                          ? 'Layout change (suggested)'
                          : 'Layout change'
                      : data.run.failureReason
                  }
                  sx={{ mb: 1 }}
                />
              ) : (
                <Typography variant="body2" color="text.secondary" mb={1}>None set</Typography>
              )}
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {data.run.failureReason === 'layout_change' && data.run.failureReasonSource === 'suggested' ? (
                  <Button
                    size="small"
                    variant="contained"
                    color="warning"
                    disabled={failureBusy}
                    onClick={() => handleFailureReason({ failureReason: 'layout_change', confirmed: true })}
                  >
                    Confirm layout change
                  </Button>
                ) : null}
                {!data.run.failureReason || data.run.failureReasonSource === 'suggested' ? (
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={failureBusy}
                    onClick={() => handleFailureReason({ failureReason: 'layout_change', confirmed: true })}
                  >
                    Mark layout change
                  </Button>
                ) : null}
                {data.run.failureReason ? (
                  <Button
                    size="small"
                    variant="text"
                    disabled={failureBusy}
                    onClick={() => handleFailureReason({ failureReason: null })}
                  >
                    Clear
                  </Button>
                ) : null}
              </Stack>
            </Box>
          )}
        </Paper>
        <Paper sx={{ p: 2, minWidth: 180 }}>
          <Typography variant="overline">Duration</Typography>
          <Typography variant="h6">{data.durationMs ? `${Math.round(data.durationMs / 1000)}s` : '-'}</Typography>
        </Paper>
        <Paper sx={{ p: 2, minWidth: 180 }}>
          <Typography variant="overline">Rows</Typography>
          <Typography variant="h6">{data.run.rowsExtracted || 0}</Typography>
        </Paper>
      </Stack>

      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" mb={2}>Extracted Rows</Typography>
        {!rows.length ? (
          <Typography variant="body2" color="text.secondary">
            No row history for this run. That usually means nothing was extracted (0 matches on the page), or data has not been persisted yet.
            Check <strong>Logs</strong> below and confirm selectors match the live site. Use <strong>View Data</strong> for all stored rows for this automation.
          </Typography>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Source</TableCell>
                {columns.map((column: string) => (
                  <TableCell key={column}>{RUN_DETAIL_COLUMN_LABELS[column] ?? column}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row: any) => (
                <TableRow key={row.id}>
                  <TableCell>{row.source}</TableCell>
                  {columns.map((column: string) => (
                    <TableCell key={column}>
                      {typeof row.data?.[column] === 'object'
                        ? JSON.stringify(row.data?.[column])
                        : String(row.data?.[column] ?? '')}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {rowsCursor ? (
          <Button sx={{ mt: 2 }} disabled={detailLoading} onClick={() => void loadRows(rowsCursor, true)}>
            Load more rows
          </Button>
        ) : null}
      </Paper>

      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" mb={2}>Logs</Typography>
        <Box component="pre" sx={{ whiteSpace: 'pre-wrap', fontSize: 13, m: 0, maxHeight: 320, overflow: 'auto' }}>
          {logs.join('\n') || 'No logs recorded.'}
        </Box>
        {logsCursor ? (
          <Button sx={{ mt: 2 }} onClick={() => void loadLogs(logsCursor, true)}>
            Load older logs
          </Button>
        ) : null}
      </Paper>
    </Box>
  );
};
