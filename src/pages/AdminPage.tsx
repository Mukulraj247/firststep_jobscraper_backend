import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  FormControl,
  InputAdornment,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import SearchIcon from '@mui/icons-material/Search';
import LogoutIcon from '@mui/icons-material/Logout';
import RefreshIcon from '@mui/icons-material/Refresh';
import {
  adminLogin,
  adminLogout,
  getAdminOverview,
  getAdminRun,
  getAdminSession,
  listAdminRuns,
  type AdminOverview,
  type AdminRunSummary,
} from '../api/admin';

const STATUS_COLORS: Record<string, 'default' | 'success' | 'error' | 'warning' | 'info'> = {
  success: 'success',
  completed: 'success',
  failed: 'error',
  running: 'info',
  pending: 'warning',
  queued: 'warning',
  aborted: 'default',
};

const formatBytes = (n?: number | null) => {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

const formatDuration = (ms?: number | null) => {
  if (ms == null || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${ms} ms`;
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
};

const formatWhen = (iso?: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
};

const StatCard = ({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) => (
  <Paper variant="outlined" sx={{ p: 2, minWidth: 140, flex: '1 1 140px' }}>
    <Typography variant="caption" color="text.secondary" display="block">
      {label}
    </Typography>
    <Typography variant="h5" sx={{ mt: 0.5, fontWeight: 600, wordBreak: 'break-word' }}>
      {value}
    </Typography>
    {hint ? (
      <Typography variant="caption" color="text.secondary">
        {hint}
      </Typography>
    ) : null}
  </Paper>
);

export const AdminPage = () => {
  const [checking, setChecking] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);

  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [runs, setRuns] = useState<AdminRunSummary[]>([]);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  // Draft filters (inputs) vs applied filters (what the API uses)
  const [draftStatus, setDraftStatus] = useState('');
  const [draftOwnerEmail, setDraftOwnerEmail] = useState('');
  const [draftQ, setDraftQ] = useState('');
  const [applied, setApplied] = useState({ status: '', ownerEmail: '', q: '' });

  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [detailByRunId, setDetailByRunId] = useState<Record<string, any>>({});
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);

  const bootstrap = useCallback(async () => {
    setChecking(true);
    try {
      const session = await getAdminSession();
      setConfigured(session.configured !== false);
      setAuthenticated(!!session.authenticated);
    } catch {
      setAuthenticated(false);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  const loadOverview = useCallback(async () => {
    setOverviewLoading(true);
    try {
      setOverview(await getAdminOverview());
    } catch (error: any) {
      const status = error?.response?.status;
      if (status === 401 || status === 403) {
        setAuthenticated(false);
        setLoginError('Admin session expired. Sign in again.');
      }
    } finally {
      setOverviewLoading(false);
    }
  }, []);

  const loadRuns = useCallback(async () => {
    setListLoading(true);
    setListError(null);
    setExpandedRunId(null);
    setDetailByRunId({});
    try {
      const list = await listAdminRuns({
        page,
        limit,
        status: applied.status || undefined,
        ownerEmail: applied.ownerEmail || undefined,
        q: applied.q || undefined,
      });
      setRuns(list.runs || []);
      setTotal(list.pagination?.total ?? 0);
      setTotalPages(list.pagination?.totalPages ?? 1);
      if (list.pagination?.page && list.pagination.page !== page) {
        setPage(list.pagination.page);
      }
    } catch (error: any) {
      const status = error?.response?.status;
      if (status === 401 || status === 403) {
        setAuthenticated(false);
        setLoginError('Admin session expired. Sign in again.');
      } else {
        setListError(error?.response?.data?.error || 'Failed to load runs');
      }
    } finally {
      setListLoading(false);
    }
  }, [page, limit, applied]);

  useEffect(() => {
    if (!authenticated) return;
    loadOverview();
  }, [authenticated, loadOverview]);

  useEffect(() => {
    if (!authenticated) return;
    loadRuns();
  }, [authenticated, loadRuns]);

  const applyFilters = () => {
    setApplied({
      status: draftStatus,
      ownerEmail: draftOwnerEmail.trim(),
      q: draftQ.trim(),
    });
    setPage(1);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoggingIn(true);
    setLoginError(null);
    try {
      await adminLogin(password);
      setPassword('');
      setAuthenticated(true);
    } catch (error: any) {
      setLoginError(error?.response?.data?.error || 'Login failed');
    } finally {
      setLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    try {
      await adminLogout();
    } finally {
      setAuthenticated(false);
      setOverview(null);
      setRuns([]);
      setDetailByRunId({});
      setExpandedRunId(null);
    }
  };

  const loadDetail = async (runId: string) => {
    if (detailByRunId[runId]) return;
    setDetailLoadingId(runId);
    try {
      const detail = await getAdminRun(runId);
      setDetailByRunId((prev) => ({ ...prev, [runId]: detail }));
    } catch (error: any) {
      setDetailByRunId((prev) => ({
        ...prev,
        [runId]: { error: error?.response?.data?.error || 'Failed to load run detail' },
      }));
    } finally {
      setDetailLoadingId(null);
    }
  };

  const statusChips = useMemo(() => {
    if (!overview?.byStatus) return [];
    return Object.entries(overview.byStatus).sort((a, b) => b[1] - a[1]);
  }, [overview]);

  const rangeStart = total === 0 ? 0 : (page - 1) * limit + 1;
  const rangeEnd = Math.min(page * limit, total);

  if (checking) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!configured) {
    return (
      <Box sx={{ maxWidth: 560, mx: 'auto', mt: 8, px: 2 }}>
        <Alert severity="warning">
          Admin gate is not configured. Set <code>ADMIN_PASSWORD</code> in the server <code>.env</code> and
          restart the API.
        </Alert>
      </Box>
    );
  }

  if (!authenticated) {
    return (
      <Box sx={{ maxWidth: 420, mx: 'auto', mt: 10, px: 2 }}>
        <Paper sx={{ p: 3 }} elevation={2}>
          <Typography variant="h5" gutterBottom>
            Scout-X Admin
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Enter the admin password to view all runs, timing, and compute usage across every account.
          </Typography>
          <form onSubmit={handleLogin}>
            <Stack spacing={2}>
              <TextField
                type="password"
                label="Admin password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
                fullWidth
                required
              />
              {loginError ? <Alert severity="error">{loginError}</Alert> : null}
              <Button type="submit" variant="contained" disabled={loggingIn || !password}>
                {loggingIn ? 'Signing in…' : 'Enter admin'}
              </Button>
            </Stack>
          </form>
        </Paper>
      </Box>
    );
  }

  const compute = overview?.compute;

  return (
    <Box sx={{ px: { xs: 1.5, md: 3 }, py: 2, maxWidth: 1400, mx: 'auto' }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} spacing={1} mb={2}>
        <Box>
          <Typography variant="h4" fontWeight={700}>
            Admin · All runs & compute
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Cross-account ops view. Normal users still only see their own runs on /runs.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button
            startIcon={<RefreshIcon />}
            onClick={() => {
              loadOverview();
              loadRuns();
            }}
            disabled={listLoading || overviewLoading}
          >
            Refresh
          </Button>
          <Button startIcon={<LogoutIcon />} color="inherit" onClick={handleLogout}>
            Lock admin
          </Button>
        </Stack>
      </Stack>

      {listError ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {listError}
        </Alert>
      ) : null}

      <Stack direction="row" flexWrap="wrap" gap={1.5} mb={2}>
        <StatCard label="Total runs" value={overview?.totals.runs ?? '—'} />
        <StatCard label="Active now" value={overview?.totals.activeRunsNow ?? '—'} hint="running / pending / queued" />
        <StatCard label="Last 24h" value={overview?.totals.runsLast24h ?? '—'} />
        <StatCard label="Accounts" value={overview?.totals.users ?? '—'} />
        <StatCard label="Automations" value={overview?.totals.robots ?? '—'} />
        <StatCard
          label="Worker concurrency"
          value={compute?.scraperWorkerConcurrency ?? '—'}
          hint={`timeout ${formatDuration(compute?.scraperJobTimeoutMs)}`}
        />
        <StatCard label="Live browsers" value={compute?.activeBrowsers ?? '—'} />
        <StatCard
          label="Avg duration 24h"
          value={formatDuration(compute?.avgDurationMsLast24h)}
          hint={`p95 ${formatDuration(compute?.p95DurationMsLast24h)}`}
        />
        <StatCard
          label="Heap used"
          value={formatBytes(compute?.memoryUsage?.heapUsed)}
          hint={`RSS ${formatBytes(compute?.memoryUsage?.rss)}`}
        />
        <StatCard
          label="Process uptime"
          value={formatDuration((compute?.uptimeSeconds || 0) * 1000)}
          hint={compute?.nodeEnv}
        />
      </Stack>

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Typography variant="subtitle2" gutterBottom>
          Compute & runtime
        </Typography>
        <Stack direction="row" flexWrap="wrap" gap={1} mb={1}>
          <Chip size="small" label={`Embedded workers: ${compute?.runEmbeddedWorkers ? 'yes' : 'no'}`} />
          <Chip size="small" label={`Max attempts: ${compute?.scraperMaxAttempts ?? '—'}`} />
          <Chip size="small" label={`Browser: ${compute?.defaultBrowserType || '—'}`} />
          <Chip size="small" label={`Job timeout: ${formatDuration(compute?.scraperJobTimeoutMs)}`} />
        </Stack>
        <Stack direction="row" flexWrap="wrap" gap={1}>
          {statusChips.map(([status, count]) => (
            <Chip
              key={status}
              size="small"
              color={STATUS_COLORS[status] || 'default'}
              label={`${status}: ${count}`}
              variant={draftStatus === status ? 'filled' : 'outlined'}
              onClick={() => {
                setDraftStatus(status);
                setApplied((prev) => ({ ...prev, status }));
                setPage(1);
              }}
            />
          ))}
        </Stack>
        {compute?.activeBrowserIds?.length ? (
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
            Browser IDs: {compute.activeBrowserIds.join(', ')}
          </Typography>
        ) : null}
        {overview?.generatedAt ? (
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
            Overview as of {formatWhen(overview.generatedAt)}
          </Typography>
        ) : null}
      </Paper>

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }}>
          <TextField
            size="small"
            placeholder="Search name, runId, robot, error…"
            value={draftQ}
            onChange={(e) => setDraftQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') applyFilters();
            }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            }}
            sx={{ flex: 1, minWidth: 200 }}
          />
          <TextField
            size="small"
            label="Owner email"
            value={draftOwnerEmail}
            onChange={(e) => setDraftOwnerEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') applyFilters();
            }}
            sx={{ minWidth: 180 }}
          />
          <FormControl size="small" sx={{ minWidth: 140 }}>
            <InputLabel>Status</InputLabel>
            <Select
              label="Status"
              value={draftStatus}
              onChange={(e) => setDraftStatus(String(e.target.value))}
            >
              <MenuItem value="">All</MenuItem>
              {['success', 'completed', 'failed', 'running', 'pending', 'queued', 'aborted'].map((s) => (
                <MenuItem key={s} value={s}>
                  {s}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 110 }}>
            <InputLabel>Per page</InputLabel>
            <Select
              label="Per page"
              value={limit}
              onChange={(e) => {
                setLimit(Number(e.target.value));
                setPage(1);
              }}
            >
              {[10, 20, 50].map((n) => (
                <MenuItem key={n} value={n}>
                  {n}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Button variant="contained" onClick={applyFilters} disabled={listLoading}>
            Apply
          </Button>
        </Stack>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
          Showing one page at a time from the server ({limit} runs max). Expand a row for full details.
        </Typography>
      </Paper>

      {listLoading && !runs.length ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      ) : (
        <Stack spacing={1}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            justifyContent="space-between"
            alignItems={{ sm: 'center' }}
            spacing={1}
            sx={{ mb: 0.5 }}
          >
            <Typography variant="body2" color="text.secondary">
              {listLoading
                ? 'Loading page…'
                : total === 0
                  ? 'No runs'
                  : `Showing ${rangeStart}–${rangeEnd} of ${total.toLocaleString()}`}
            </Typography>
            <Stack direction="row" spacing={1}>
              <Button size="small" disabled={page <= 1 || listLoading} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <Button
                size="small"
                disabled={page >= totalPages || listLoading}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </Stack>
          </Stack>
          {runs.map((run) => {
            const open = expandedRunId === run.runId;
            const detail = detailByRunId[run.runId];
            return (
              <Accordion
                key={run.runId}
                expanded={open}
                onChange={(_, isOpen) => {
                  setExpandedRunId(isOpen ? run.runId : null);
                  if (isOpen) loadDetail(run.runId);
                }}
                disableGutters
                variant="outlined"
              >
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Stack
                    direction={{ xs: 'column', md: 'row' }}
                    spacing={1}
                    alignItems={{ md: 'center' }}
                    sx={{ width: '100%', pr: 1 }}
                    flexWrap="wrap"
                  >
                    <Chip
                      size="small"
                      label={run.status}
                      color={STATUS_COLORS[run.status] || 'default'}
                      sx={{ minWidth: 88 }}
                    />
                    <Typography sx={{ fontWeight: 600, flex: 1, minWidth: 160 }} noWrap title={run.name}>
                      {run.name}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ minWidth: 160 }} noWrap>
                      {run.ownerEmail || run.ownerUserId || 'unknown owner'}
                    </Typography>
                    <Typography variant="body2" sx={{ minWidth: 90 }}>
                      {formatDuration(run.durationMs)}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ minWidth: 140 }}>
                      {formatWhen(run.startedAt)}
                    </Typography>
                    <Chip size="small" variant="outlined" label={`${run.rowsExtracted ?? 0} rows`} />
                    <Chip size="small" variant="outlined" label={run.trigger || '—'} />
                  </Stack>
                </AccordionSummary>
                <AccordionDetails>
                  <Stack spacing={2}>
                    <Box
                      sx={{
                        display: 'grid',
                        gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: '1fr 1fr 1fr' },
                        gap: 1.5,
                      }}
                    >
                      <DetailField label="Run ID" value={run.runId} mono />
                      <DetailField label="Robot meta ID" value={run.robotMetaId} mono />
                      <DetailField label="Browser ID" value={run.browserId || '—'} mono />
                      <DetailField label="Queue job" value={run.queueJobId || '—'} mono />
                      <DetailField label="Started" value={formatWhen(run.startedAt)} />
                      <DetailField label="Finished" value={formatWhen(run.finishedAt)} />
                      <DetailField label="Duration" value={formatDuration(run.durationMs)} />
                      <DetailField label="Retries" value={String(run.retryCount ?? 0)} />
                      <DetailField label="Screenshots" value={String(run.screenshotCount ?? 0)} />
                      <DetailField label="Log size" value={formatBytes(run.logBytes)} />
                      <DetailField label="Target URL" value={run.targetUrl || '—'} />
                      <DetailField label="Owner" value={run.ownerEmail || run.ownerUserId || '—'} />
                    </Box>

                    {run.errorMessage ? <Alert severity="error">{run.errorMessage}</Alert> : null}

                    {run.automationConfigSummary ? (
                      <Paper variant="outlined" sx={{ p: 1.5 }}>
                        <Typography variant="subtitle2" gutterBottom>
                          Automation config (at robot)
                        </Typography>
                        <pre style={{ margin: 0, fontSize: 12, whiteSpace: 'pre-wrap' }}>
                          {JSON.stringify(run.automationConfigSummary, null, 2)}
                        </pre>
                      </Paper>
                    ) : null}

                    {detailLoadingId === run.runId && !detail ? (
                      <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                        <CircularProgress size={28} />
                      </Box>
                    ) : null}

                    {detail?.error ? <Alert severity="error">{detail.error}</Alert> : null}

                    {detail?.run ? (
                      <>
                        <Divider />
                        <Typography variant="subtitle2">Full run payload</Typography>
                        {detail.automation ? (
                          <Paper variant="outlined" sx={{ p: 1.5 }}>
                            <Typography variant="subtitle2" gutterBottom>
                              Automation
                            </Typography>
                            <pre style={{ margin: 0, fontSize: 12, whiteSpace: 'pre-wrap', maxHeight: 240, overflow: 'auto' }}>
                              {JSON.stringify(detail.automation, null, 2)}
                            </pre>
                          </Paper>
                        ) : null}

                        <Paper variant="outlined" sx={{ p: 1.5 }}>
                          <Typography variant="subtitle2" gutterBottom>
                            Logs ({detail.run.logLines?.length || 0}
                            {detail.run.logTruncated ? ' recent, truncated' : ''} lines)
                          </Typography>
                          <Box
                            component="pre"
                            sx={{
                              m: 0,
                              p: 1,
                              maxHeight: 280,
                              overflow: 'auto',
                              bgcolor: 'action.hover',
                              borderRadius: 1,
                              fontSize: 11,
                              whiteSpace: 'pre-wrap',
                            }}
                          >
                            {(detail.run.logLines || []).join('\n') || '(empty)'}
                          </Box>
                        </Paper>

                        <Paper variant="outlined" sx={{ p: 1.5 }}>
                          <Typography variant="subtitle2" gutterBottom>
                            Extracted rows sample (
                            {detail.extractedRowsSample?.length || 0} of {detail.extractedRowsTotal ?? 0}
                            {detail.extractedRowsTruncated ? ', truncated' : ''})
                          </Typography>
                          {detail.extractedRowsSample?.length ? (
                            <Table size="small">
                              <TableHead>
                                <TableRow>
                                  <TableCell>Source</TableCell>
                                  <TableCell>Created</TableCell>
                                  <TableCell>Data</TableCell>
                                </TableRow>
                              </TableHead>
                              <TableBody>
                                {detail.extractedRowsSample.slice(0, 20).map((row: any) => (
                                  <TableRow key={row.id}>
                                    <TableCell>{row.source}</TableCell>
                                    <TableCell>{formatWhen(row.createdAt)}</TableCell>
                                    <TableCell>
                                      <pre style={{ margin: 0, fontSize: 11, maxWidth: 480, overflow: 'auto' }}>
                                        {JSON.stringify(row.data, null, 2)}
                                      </pre>
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          ) : (
                            <Typography variant="body2" color="text.secondary">
                              No extracted rows stored for this run.
                            </Typography>
                          )}
                        </Paper>

                        {detail.run.screenshots?.length ? (
                          <Paper variant="outlined" sx={{ p: 1.5 }}>
                            <Typography variant="subtitle2" gutterBottom>
                              Screenshots ({detail.run.screenshots.length}
                              {detail.run.screenshotsTruncated
                                ? ` of ${detail.run.binaryOutputKeys?.length || '?'}`
                                : ''}
                              )
                            </Typography>
                            <Stack spacing={1}>
                              {detail.run.screenshots.map((shot: any) => (
                                <Box key={shot.key}>
                                  <Typography variant="caption">{shot.key}</Typography>
                                  {typeof shot.value === 'string' && shot.value.startsWith('data:') ? (
                                    <img src={shot.value} alt={shot.key} style={{ maxWidth: '100%', borderRadius: 8 }} />
                                  ) : shot.value?.data ? (
                                    <img
                                      src={`data:${shot.value.mimeType || 'image/png'};base64,${shot.value.data}`}
                                      alt={shot.key}
                                      style={{ maxWidth: '100%', borderRadius: 8 }}
                                    />
                                  ) : (
                                    <Typography variant="caption" color="text.secondary">
                                      {typeof shot.value === 'string' ? shot.value.slice(0, 120) : JSON.stringify(shot.value)?.slice(0, 120)}
                                    </Typography>
                                  )}
                                </Box>
                              ))}
                            </Stack>
                          </Paper>
                        ) : null}

                        <Paper variant="outlined" sx={{ p: 1.5 }}>
                          <Typography variant="subtitle2" gutterBottom>
                            Serializable output
                          </Typography>
                          <pre style={{ margin: 0, fontSize: 12, maxHeight: 240, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
                            {JSON.stringify(detail.run.serializableOutput || {}, null, 2)}
                          </pre>
                        </Paper>
                      </>
                    ) : null}
                  </Stack>
                </AccordionDetails>
              </Accordion>
            );
          })}

          {!runs.length && !listLoading ? (
            <Alert severity="info">No runs match these filters.</Alert>
          ) : null}
        </Stack>
      )}

      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        justifyContent="space-between"
        alignItems={{ sm: 'center' }}
        spacing={1}
        mt={2}
        mb={2}
      >
        <Typography variant="body2" color="text.secondary">
          {total === 0
            ? 'No runs'
            : `Showing ${rangeStart}–${rangeEnd} of ${total.toLocaleString()} · page ${page} / ${totalPages}`}
        </Typography>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Button size="small" disabled={page <= 1 || listLoading} onClick={() => setPage(1)}>
            First
          </Button>
          <Button
            size="small"
            disabled={page <= 1 || listLoading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </Button>
          <Button
            size="small"
            disabled={page >= totalPages || listLoading}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            Next
          </Button>
          <Button
            size="small"
            disabled={page >= totalPages || listLoading}
            onClick={() => setPage(totalPages)}
          >
            Last
          </Button>
        </Stack>
      </Stack>
    </Box>
  );
};

const DetailField = ({ label, value, mono }: { label: string; value: string; mono?: boolean }) => (
  <Box>
    <Typography variant="caption" color="text.secondary">
      {label}
    </Typography>
    <Typography
      variant="body2"
      sx={{ fontFamily: mono ? 'ui-monospace, monospace' : undefined, wordBreak: 'break-all' }}
    >
      {value}
    </Typography>
  </Box>
);

export default AdminPage;
