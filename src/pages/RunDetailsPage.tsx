import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  LinearProgress,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { getSaasRun, getSaasRunLogs, getSaasRunRows, updateRunFailureReason } from '../api/automation';
import {
  nextTrackedRunStatus,
  shouldRefreshRunDetails,
} from '../utils/runDetailsPolling';
import { popReturnNavigateOptions, pushReturnState, runDetailsBackLabel } from '../features/navigation/inAppReturn';
import { useGlobalInfoStore } from '../context/globalInfo';
import { FIRSTSTEP, RADIUS, cardSx, tint } from '../components/dashboard/ops/dashboardTokens';
import { buildRunDetailColumns } from '../features/automations/automationDataPageBehavior';
import {
  ExtractedRowsTable,
  ExtractedRowsTableSummary,
} from '../features/automations/ExtractedRowsTable';

const ACTIVE_STATUSES = new Set(['running', 'pending', 'queued']);

const statusChipColor = (status: string): 'success' | 'error' | 'info' | 'warning' => {
  if (status === 'success' || status === 'completed') return 'success';
  if (status === 'failed') return 'error';
  if (status === 'pending') return 'info';
  return 'warning';
};

export const RunDetailsPage = () => {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const backNav = popReturnNavigateOptions(location.state, '');
  const returnTo = backNav.href;
  const { notify } = useGlobalInfoStore();
  const [data, setData] = useState<any>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [rowsCursor, setRowsCursor] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [logsCursor, setLogsCursor] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showAllColumns, setShowAllColumns] = useState(false);
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
            await Promise.all([loadRows(null, false), loadLogs(null, false)]);
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

  const columns = useMemo(
    () => buildRunDetailColumns(rows, { keyColumnsOnly: !showAllColumns }),
    [rows, showAllColumns]
  );

  if (!data) {
    return (
      <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 1280, mx: 'auto' }}>
        <Typography color="text.secondary">Loading run details…</Typography>
      </Box>
    );
  }

  const runStatus = String(data.run.status || '');

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 1280, mx: 'auto' }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'flex-start', sm: 'center' }}
        spacing={2}
        mb={3}
      >
        <Box>
          <Typography variant="h4" fontWeight={800} sx={{ color: FIRSTSTEP.navyInk, mb: 0.5 }}>
            Run Details
          </Typography>
          <Typography variant="body1" color="text.secondary">
            {data.automation.name}
            {data.automation.scoutId ? ` · ${data.automation.scoutId}` : ''}
            {data.automation.companyName ? ` · ${data.automation.companyName}` : ''}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Button
            variant="outlined"
            startIcon={<ArrowBackIcon />}
            onClick={() => {
              if (backNav.href) {
                navigate(backNav.href, backNav.state ? { state: backNav.state } : undefined);
              } else {
                navigate(-1);
              }
            }}
          >
            {runDetailsBackLabel(returnTo || '/')}
          </Button>
          <Button
            variant="contained"
            onClick={() =>
              navigate(`/automation/${data.automation.id}/data`, {
                state: pushReturnState(location),
              })
            }
            sx={{ bgcolor: FIRSTSTEP.tealDark, '&:hover': { bgcolor: FIRSTSTEP.teal } }}
          >
            View Data
          </Button>
        </Stack>
      </Stack>

      {ACTIVE_STATUSES.has(runStatus) && (
        <LinearProgress sx={{ mb: 2, borderRadius: 1, height: 6 }} />
      )}

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} mb={3}>
        <Paper sx={{ ...cardSx(), p: 2.5, flex: 1, minWidth: 200 }}>
          <Typography variant="overline" sx={{ color: FIRSTSTEP.textMuted, fontWeight: 700 }}>
            Status
          </Typography>
          <Stack direction="row" alignItems="center" spacing={1} mt={0.5} flexWrap="wrap" useFlexGap>
            <Chip label={runStatus} color={statusChipColor(runStatus)} size="small" sx={{ fontWeight: 700 }} />
            {data.run.anomaly ? (
              <Chip
                size="small"
                color={
                  data.run.anomalyMeta?.escalated || data.run.anomaly === 'zero_rows'
                    ? 'error'
                    : 'warning'
                }
                label={
                  data.run.anomaly === 'zero_rows'
                    ? 'Zero rows'
                    : data.run.anomalyMeta?.escalated
                      ? 'Row drop (escalated)'
                      : 'Row drop'
                }
              />
            ) : null}
          </Stack>
          {data.run.anomalyMeta?.baseline != null ? (
            <Typography variant="caption" display="block" color="text.secondary" mt={1}>
              Baseline {data.run.anomalyMeta.baseline} →{' '}
              {data.run.rowsExtracted ?? data.run.anomalyMeta.current ?? 0}
            </Typography>
          ) : null}
          {(data.run.failureReason || runStatus === 'failed') && (
            <Box mt={1.5}>
              <Typography variant="overline" display="block" sx={{ color: FIRSTSTEP.textMuted }}>
                Failure reason
              </Typography>
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
                  sx={{ mt: 0.5, mb: 1 }}
                />
              ) : (
                <Typography variant="body2" color="text.secondary" mb={1}>
                  None set
                </Typography>
              )}
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {data.run.failureReason === 'layout_change' &&
                data.run.failureReasonSource === 'suggested' ? (
                  <Button
                    size="small"
                    variant="contained"
                    color="warning"
                    disabled={failureBusy}
                    onClick={() =>
                      handleFailureReason({ failureReason: 'layout_change', confirmed: true })
                    }
                  >
                    Confirm layout change
                  </Button>
                ) : null}
                {!data.run.failureReason || data.run.failureReasonSource === 'suggested' ? (
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={failureBusy}
                    onClick={() =>
                      handleFailureReason({ failureReason: 'layout_change', confirmed: true })
                    }
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
        <Paper sx={{ ...cardSx(), p: 2.5, minWidth: 160 }}>
          <Typography variant="overline" sx={{ color: FIRSTSTEP.textMuted, fontWeight: 700 }}>
            Duration
          </Typography>
          <Typography variant="h5" fontWeight={800} sx={{ color: FIRSTSTEP.navyInk, mt: 0.5 }}>
            {data.durationMs ? `${Math.round(data.durationMs / 1000)}s` : '—'}
          </Typography>
        </Paper>
        <Paper sx={{ ...cardSx(), p: 2.5, minWidth: 160 }}>
          <Typography variant="overline" sx={{ color: FIRSTSTEP.textMuted, fontWeight: 700 }}>
            Rows
          </Typography>
          <Typography variant="h5" fontWeight={800} sx={{ color: FIRSTSTEP.navyInk, mt: 0.5 }}>
            {data.run.rowsExtracted || 0}
          </Typography>
        </Paper>
      </Stack>

      <Paper sx={{ ...cardSx(), p: { xs: 2, md: 3 }, mb: 3, overflow: 'hidden' }}>
        <Typography variant="h6" fontWeight={800} sx={{ color: FIRSTSTEP.navyInk, mb: 1 }}>
          Extracted Rows
        </Typography>
        {!rows.length ? (
          <Typography variant="body2" color="text.secondary">
            No row history for this run. That usually means nothing was extracted (0 matches on the
            page), or data has not been persisted yet. Check <strong>Logs</strong> below and confirm
            selectors match the live site. Use <strong>View Data</strong> for all stored rows for
            this automation.
          </Typography>
        ) : (
          <>
            <ExtractedRowsTableSummary
              rowCount={rows.length}
              columnCount={columns.length}
              showAllColumns={showAllColumns}
              onToggleColumns={() => setShowAllColumns((v) => !v)}
            />
            <ExtractedRowsTable rows={rows} columns={columns} showSource />
            {rowsCursor ? (
              <Button sx={{ mt: 2 }} disabled={detailLoading} onClick={() => void loadRows(rowsCursor, true)}>
                {detailLoading ? 'Loading…' : 'Load more rows'}
              </Button>
            ) : null}
          </>
        )}
      </Paper>

      <Paper sx={{ ...cardSx(), p: { xs: 2, md: 3 } }}>
        <Typography variant="h6" fontWeight={800} sx={{ color: FIRSTSTEP.navyInk, mb: 2 }}>
          Logs
        </Typography>
        <Box
          component="pre"
          sx={{
            whiteSpace: 'pre-wrap',
            fontSize: 13,
            m: 0,
            maxHeight: 320,
            overflow: 'auto',
            p: 2,
            borderRadius: RADIUS.control,
            bgcolor: tint(FIRSTSTEP.navyInk, 0.04),
            border: `1px solid ${tint(FIRSTSTEP.navyInk, 0.08)}`,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          }}
        >
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
