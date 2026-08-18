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
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  InputAdornment,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
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
  deleteAdminAutomation,
  getAdminDigitalOcean,
  getAdminDigestStatus,
  getAdminOverview,
  getAdminRun,
  getAdminSession,
  listAdminRuns,
  listAdminUserAutomations,
  listAdminUsers,
  sendAdminDigestTest,
  updateAdminAutomation,
  type AdminAutomationSummary,
  type AdminOverview,
  type AdminRunSummary,
  type AdminUserSummary,
  type DigitalOceanDashboard,
  type OpsDigestStatus,
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
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '—';
  if (ms > 48 * 60 * 60 * 1000) return '—';
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

const formatPct = (n?: number | null, digits = 1) => {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n.toFixed(digits)}%`;
};

const formatMbps = (n?: number | null) => {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n <= 0) return '0 Kbps';
  if (n < 0.001) return `${(n * 1_000_000).toFixed(0)} bps`;
  if (n < 1) return `${(n * 1000).toFixed(1)} Kbps`;
  return `${n.toFixed(3)} Mbps`;
};

const formatGiB = (bytes?: number | null) => {
  if (bytes == null || !Number.isFinite(bytes)) return '—';
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
};

const formatRamPlan = (memoryMb?: number | null) => {
  if (memoryMb == null || !Number.isFinite(memoryMb)) return '—';
  if (memoryMb >= 1024) return `${(memoryMb / 1024).toFixed(memoryMb % 1024 === 0 ? 0 : 1)} GB RAM`;
  return `${memoryMb} MB RAM`;
};

/** Area-style chart (CPU / memory / bandwidth / disk) without a chart library. */
const MetricChart = ({
  title,
  valueLabel,
  points,
  color = '#0069ff',
  height = 88,
  yMax,
}: {
  title: string;
  valueLabel: string;
  points: Array<{ t: number; v: number }>;
  color?: string;
  height?: number;
  yMax?: number;
}) => {
  const w = 320;
  const h = height;
  const pad = 4;
  if (!points?.length) {
    return (
      <Box
        sx={{
          flex: '1 1 280px',
          minWidth: 240,
          p: 1.5,
          borderRadius: 2,
          bgcolor: 'grey.50',
          border: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Stack direction="row" justifyContent="space-between" mb={0.5}>
          <Typography variant="caption" color="text.secondary">
            {title}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            No samples
          </Typography>
        </Stack>
        <Box sx={{ height: h, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Typography variant="body2" color="text.disabled">
            Waiting for metrics agent…
          </Typography>
        </Box>
      </Box>
    );
  }
  const vals = points.map((p) => p.v);
  const min = 0;
  const max = yMax != null ? yMax : Math.max(...vals, 0.0001);
  const span = max - min || 1;
  const coords = points.map((p, i) => {
    const x = pad + (i / Math.max(1, points.length - 1)) * (w - pad * 2);
    const y = h - pad - ((p.v - min) / span) * (h - pad * 2);
    return { x, y };
  });
  const line = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
  const area = `${line} L${coords[coords.length - 1].x.toFixed(1)},${h - pad} L${coords[0].x.toFixed(1)},${h - pad} Z`;
  return (
    <Box
      sx={{
        flex: '1 1 280px',
        minWidth: 240,
        p: 1.5,
        borderRadius: 2,
        bgcolor: 'grey.50',
        border: '1px solid',
        borderColor: 'divider',
      }}
    >
      <Stack direction="row" justifyContent="space-between" alignItems="baseline" mb={0.5}>
        <Typography variant="caption" color="text.secondary" fontWeight={600}>
          {title}
        </Typography>
        <Typography variant="body2" fontWeight={700} sx={{ color }}>
          {valueLabel}
        </Typography>
      </Stack>
      <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={title}>
        <path d={area} fill={color} opacity={0.12} />
        <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    </Box>
  );
};

const UsageBar = ({
  label,
  percent,
  detail,
  color = '#0069ff',
}: {
  label: string;
  percent: number | null | undefined;
  detail?: string;
  color?: string;
}) => {
  const pct = percent != null && Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : null;
  return (
    <Box sx={{ flex: '1 1 160px', minWidth: 140 }}>
      <Stack direction="row" justifyContent="space-between" mb={0.5}>
        <Typography variant="caption" color="text.secondary">
          {label}
        </Typography>
        <Typography variant="caption" fontWeight={700}>
          {pct == null ? '—' : `${pct.toFixed(1)}%`}
        </Typography>
      </Stack>
      <Box sx={{ height: 8, borderRadius: 999, bgcolor: 'grey.200', overflow: 'hidden' }}>
        <Box
          sx={{
            width: pct == null ? 0 : `${pct}%`,
            height: '100%',
            bgcolor: color,
            borderRadius: 999,
            transition: 'width 0.4s ease',
          }}
        />
      </Box>
      {detail ? (
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
          {detail}
        </Typography>
      ) : null}
    </Box>
  );
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

  const [doWindow, setDoWindow] = useState<'1h' | '6h' | '24h'>('6h');
  const [doDash, setDoDash] = useState<DigitalOceanDashboard | null>(null);
  const [doLoading, setDoLoading] = useState(false);
  const [doError, setDoError] = useState<string | null>(null);
  const [digestStatus, setDigestStatus] = useState<OpsDigestStatus | null>(null);
  const [digestSending, setDigestSending] = useState(false);
  const [digestMessage, setDigestMessage] = useState<string | null>(null);

  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [usersPage, setUsersPage] = useState(1);
  const [usersLimit] = useState(20);
  const [usersTotal, setUsersTotal] = useState(0);
  const [usersTotalPages, setUsersTotalPages] = useState(1);
  const [usersDraftQ, setUsersDraftQ] = useState('');
  const [usersAppliedQ, setUsersAppliedQ] = useState('');
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [automationsByUserId, setAutomationsByUserId] = useState<
    Record<string, AdminAutomationSummary[]>
  >({});
  const [automationsLoadingId, setAutomationsLoadingId] = useState<string | null>(null);
  const [automationsError, setAutomationsError] = useState<string | null>(null);

  const [editAutomation, setEditAutomation] = useState<AdminAutomationSummary | null>(null);
  const [editName, setEditName] = useState('');
  const [editUrl, setEditUrl] = useState('');
  const [editCompany, setEditCompany] = useState('');
  const [editTags, setEditTags] = useState('');
  const [editWebhook, setEditWebhook] = useState('');
  const [editScheduleEnabled, setEditScheduleEnabled] = useState(false);
  const [editCron, setEditCron] = useState('');
  const [editTimezone, setEditTimezone] = useState('UTC');
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<AdminAutomationSummary | null>(null);
  const [deleteSaving, setDeleteSaving] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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

  const loadDigitalOcean = useCallback(async () => {
    setDoLoading(true);
    setDoError(null);
    try {
      const [dash, digest] = await Promise.all([
        getAdminDigitalOcean(doWindow),
        getAdminDigestStatus().catch(() => null),
      ]);
      setDoDash(dash);
      if (digest) setDigestStatus(digest);
    } catch (error: any) {
      const status = error?.response?.status;
      if (status === 401 || status === 403) {
        setAuthenticated(false);
        setLoginError('Admin session expired. Sign in again.');
      } else {
        setDoError(error?.response?.data?.error || 'Failed to load DigitalOcean metrics');
      }
    } finally {
      setDoLoading(false);
    }
  }, [doWindow]);

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

  const loadUsers = useCallback(async () => {
    setUsersLoading(true);
    setUsersError(null);
    try {
      const list = await listAdminUsers({
        page: usersPage,
        limit: usersLimit,
        q: usersAppliedQ || undefined,
      });
      setUsers(list.users || []);
      setUsersTotal(list.pagination?.total ?? 0);
      setUsersTotalPages(list.pagination?.totalPages ?? 1);
    } catch (error: any) {
      const status = error?.response?.status;
      if (status === 401 || status === 403) {
        setAuthenticated(false);
        setLoginError('Admin session expired. Sign in again.');
      } else {
        setUsersError(error?.response?.data?.error || 'Failed to load users');
      }
    } finally {
      setUsersLoading(false);
    }
  }, [usersPage, usersLimit, usersAppliedQ]);

  const loadUserAutomations = useCallback(async (userId: string) => {
    setAutomationsLoadingId(userId);
    setAutomationsError(null);
    try {
      const list = await listAdminUserAutomations(userId, { page: 1, limit: 50 });
      setAutomationsByUserId((prev) => ({
        ...prev,
        [userId]: list.automations || [],
      }));
    } catch (error: any) {
      const status = error?.response?.status;
      if (status === 401 || status === 403) {
        setAuthenticated(false);
        setLoginError('Admin session expired. Sign in again.');
      } else {
        setAutomationsError(error?.response?.data?.error || 'Failed to load automations');
      }
    } finally {
      setAutomationsLoadingId(null);
    }
  }, []);

  const openEditDialog = (automation: AdminAutomationSummary) => {
    setEditAutomation(automation);
    setEditName(automation.name || '');
    setEditUrl(automation.targetUrl || '');
    setEditCompany(automation.companyName || '');
    setEditTags((automation.tags || []).join(', '));
    setEditWebhook('');
    setEditScheduleEnabled(!!automation.schedule?.enabled);
    setEditCron(automation.schedule?.cron || '');
    setEditTimezone(automation.schedule?.timezone || 'UTC');
    setEditError(null);
  };

  const handleSaveEdit = async () => {
    if (!editAutomation?.id) return;
    setEditSaving(true);
    setEditError(null);
    try {
      const tags = editTags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      const result = await updateAdminAutomation(editAutomation.id, {
        name: editName.trim(),
        startUrl: editUrl.trim() || undefined,
        companyName: editCompany.trim(),
        tags,
        webhookUrl: editWebhook.trim() || undefined,
        schedule: {
          enabled: editScheduleEnabled,
          cron: editCron.trim() || null,
          timezone: editTimezone.trim() || 'UTC',
        },
      });
      const ownerId = result.automation.ownerUserId || editAutomation.ownerUserId || expandedUserId;
      if (ownerId) {
        setAutomationsByUserId((prev) => {
          const list = prev[ownerId] || [];
          return {
            ...prev,
            [ownerId]: list.map((a) => (a.id === result.automation.id ? result.automation : a)),
          };
        });
      }
      setEditAutomation(null);
      loadUsers();
      loadOverview();
    } catch (error: any) {
      setEditError(error?.response?.data?.error || 'Failed to update automation');
    } finally {
      setEditSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget?.id) return;
    setDeleteSaving(true);
    setDeleteError(null);
    try {
      await deleteAdminAutomation(deleteTarget.id);
      const ownerId = deleteTarget.ownerUserId || expandedUserId;
      if (ownerId) {
        setAutomationsByUserId((prev) => ({
          ...prev,
          [ownerId]: (prev[ownerId] || []).filter((a) => a.id !== deleteTarget.id),
        }));
      }
      setDeleteTarget(null);
      loadUsers();
      loadOverview();
    } catch (error: any) {
      setDeleteError(error?.response?.data?.error || 'Failed to delete automation');
    } finally {
      setDeleteSaving(false);
    }
  };

  useEffect(() => {
    if (!authenticated) return;
    loadOverview();
  }, [authenticated, loadOverview]);

  useEffect(() => {
    if (!authenticated) return;
    loadDigitalOcean();
  }, [authenticated, loadDigitalOcean]);

  useEffect(() => {
    if (!authenticated) return;
    loadRuns();
  }, [authenticated, loadRuns]);

  useEffect(() => {
    if (!authenticated) return;
    loadUsers();
  }, [authenticated, loadUsers]);

  const applyFilters = () => {
    setApplied({
      status: draftStatus,
      ownerEmail: draftOwnerEmail.trim(),
      q: draftQ.trim(),
    });
    setPage(1);
  };

  const applyUsersFilter = () => {
    setUsersAppliedQ(usersDraftQ.trim());
    setUsersPage(1);
    setExpandedUserId(null);
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
      setDoDash(null);
      setDigestStatus(null);
      setDigestMessage(null);
      setUsers([]);
      setAutomationsByUserId({});
      setExpandedUserId(null);
      setEditAutomation(null);
      setDeleteTarget(null);
    }
  };

  const handleSendDigest = async () => {
    setDigestSending(true);
    setDigestMessage(null);
    try {
      const result = await sendAdminDigestTest();
      const s = result.summary?.last6h;
      setDigestMessage(
        s
          ? `Digest sent. Last 6h: ${s.total} runs, ${s.passed} passed, ${s.failed} failed.`
          : 'Digest sent.'
      );
      const status = await getAdminDigestStatus().catch(() => null);
      if (status) setDigestStatus(status);
    } catch (error: any) {
      const data = error?.response?.data;
      setDigestMessage(data?.reason || data?.error || 'Failed to send digest');
    } finally {
      setDigestSending(false);
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
            Enter the ops admin password (ADMIN_PASSWORD). This is separate from normal scout
            login — your user session is not required here.
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
              loadDigitalOcean();
              loadUsers();
              if (expandedUserId) loadUserAutomations(expandedUserId);
            }}
            disabled={listLoading || overviewLoading || doLoading || usersLoading}
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

      <Paper
        variant="outlined"
        sx={{
          p: 2.5,
          mb: 2,
          borderRadius: 2,
          background: 'linear-gradient(180deg, #f7fafc 0%, #ffffff 48%)',
        }}
      >
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          justifyContent="space-between"
          alignItems={{ sm: 'center' }}
          spacing={1}
          mb={1.5}
        >
          <Box>
            <Typography variant="subtitle1" fontWeight={700}>
              DigitalOcean Insights · Scout-X Droplet
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Live CPU %, memory, disk, bandwidth — same signals as the DO Insights tab.
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
            <FormControl size="small" sx={{ minWidth: 100 }}>
              <InputLabel>Window</InputLabel>
              <Select
                label="Window"
                value={doWindow}
                onChange={(e) => setDoWindow(e.target.value as '1h' | '6h' | '24h')}
              >
                <MenuItem value="1h">1h</MenuItem>
                <MenuItem value="6h">6h</MenuItem>
                <MenuItem value="24h">24h</MenuItem>
              </Select>
            </FormControl>
            <Button size="small" startIcon={<RefreshIcon />} onClick={() => loadDigitalOcean()} disabled={doLoading}>
              {doLoading ? 'Loading…' : 'Refresh DO'}
            </Button>
            <Button
              size="small"
              variant="outlined"
              onClick={handleSendDigest}
              disabled={digestSending || digestStatus?.canSend === false}
            >
              {digestSending ? 'Sending…' : 'Send test digest'}
            </Button>
          </Stack>
        </Stack>

        {digestStatus ? (
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
            Ops digest: {digestStatus.enabled ? 'enabled' : 'disabled'} · every{' '}
            {digestStatus.interval || '6 hours'} · ZeptoMail{' '}
            {digestStatus.zeptoConfigured ? 'configured' : 'not configured'}
            {digestStatus.recipients?.length
              ? ` · to ${digestStatus.recipients.join(', ')}`
              : ' · no recipients'}
            {!digestStatus.canSend && digestStatus.reason ? ` — ${digestStatus.reason}` : ''}
          </Typography>
        ) : null}
        {digestMessage ? (
          <Alert severity={digestMessage.startsWith('Digest sent') ? 'success' : 'warning'} sx={{ mb: 1.5 }}>
            {digestMessage}
          </Alert>
        ) : null}
        {doError ? (
          <Alert severity="error" sx={{ mb: 1.5 }}>
            {doError}
          </Alert>
        ) : null}
        {doDash?.hint ? (
          <Alert severity="info" sx={{ mb: 1.5 }}>
            {doDash.hint}
          </Alert>
        ) : null}
        {doDash && !doDash.configured ? (
          <Alert severity="info">
            {doDash.error ||
              'Set DIGITALOCEAN_TOKEN (and DIGITALOCEAN_DROPLET_IDS=auto or the full Droplet ID) on the server.'}
          </Alert>
        ) : null}
        {doDash?.error && doDash.configured ? (
          <Alert severity="warning" sx={{ mb: 1.5 }}>
            {doDash.error}
            {doDash.availableDroplets?.length ? (
              <Box component="span" display="block" sx={{ mt: 0.5 }}>
                Available droplets:{' '}
                {doDash.availableDroplets
                  .map((d) => `${d.name}=${d.id}${d.publicIpv4 ? ` (${d.publicIpv4})` : ''}`)
                  .join(', ')}
              </Box>
            ) : null}
          </Alert>
        ) : null}
        {doLoading && !doDash ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
            <CircularProgress size={28} />
          </Box>
        ) : null}
        {doDash?.droplets?.map((droplet) => {
          const m = droplet.metrics;
          const blank = { latest: null, avg: null, max: null, points: [] as Array<{ t: number; v: number }> };
          const diskPct = m.diskUsedPercent || blank;
          const load1 = m.load1 || blank;
          return (
            <Box
              key={droplet.id}
              sx={{
                mb: 2,
                p: 2,
                borderRadius: 2,
                border: '1px solid',
                borderColor: 'divider',
                bgcolor: '#fff',
                '&:last-child': { mb: 0 },
              }}
            >
              <Stack direction="row" flexWrap="wrap" gap={1} alignItems="center" mb={1.5}>
                <Typography variant="h6" fontWeight={700} sx={{ mr: 0.5 }}>
                  {droplet.name}
                </Typography>
                <Chip
                  size="small"
                  label={droplet.status}
                  color={droplet.status === 'active' ? 'success' : droplet.status === 'error' ? 'error' : 'default'}
                />
                <Chip size="small" variant="outlined" label={droplet.sizeSlug || 'plan ?'} />
                <Chip size="small" variant="outlined" label={droplet.region || 'region ?'} />
                {droplet.publicIpv4 ? (
                  <Chip size="small" variant="outlined" label={droplet.publicIpv4} />
                ) : null}
                <Chip size="small" variant="outlined" label={`ID ${droplet.id}`} />
                {droplet.priceMonthlyUsd != null ? (
                  <Chip size="small" variant="outlined" label={`$${droplet.priceMonthlyUsd}/mo`} />
                ) : null}
              </Stack>

              <Stack direction="row" flexWrap="wrap" gap={1} mb={2}>
                <Chip
                  label={droplet.vcpus != null ? `${droplet.vcpus} vCPU` : 'vCPU ?'}
                  sx={{ bgcolor: '#e3f2fd', fontWeight: 600 }}
                />
                <Chip
                  label={formatRamPlan(droplet.memoryMb)}
                  sx={{ bgcolor: '#e8f5e9', fontWeight: 600 }}
                />
                <Chip
                  label={droplet.diskGb != null ? `${droplet.diskGb} GB disk` : 'disk ?'}
                  sx={{ bgcolor: '#fff3e0', fontWeight: 600 }}
                />
                <Chip
                  label={`CPU now ${formatPct(m.cpuPercent.latest)}`}
                  color="primary"
                  variant="outlined"
                  sx={{ fontWeight: 700 }}
                />
                {load1.latest != null ? (
                  <Chip label={`Load 1m ${load1.latest.toFixed(2)}`} variant="outlined" />
                ) : null}
              </Stack>

              <Stack direction="row" flexWrap="wrap" gap={2} mb={2.5}>
                <UsageBar
                  label={`CPU avg (${doWindow})`}
                  percent={m.cpuPercent.avg ?? m.cpuPercent.latest}
                  detail={`now ${formatPct(m.cpuPercent.latest)} · max ${formatPct(m.cpuPercent.max)} · of ${droplet.vcpus ?? '—'} vCPU · matches DO Insights window avg`}
                  color="#0069ff"
                />
                <UsageBar
                  label="Memory used"
                  percent={m.memoryUsedPercent.latest}
                  detail={`${formatGiB(m.memoryUsedBytes)} / ${formatGiB(m.memoryTotalBytes)} · plan ${formatRamPlan(droplet.memoryMb)}`}
                  color="#2e7d32"
                />
                <UsageBar
                  label="Disk used"
                  percent={diskPct.latest}
                  detail={`${formatGiB(m.diskUsedBytes)} / ${formatGiB(m.diskTotalBytes)} · plan ${droplet.diskGb != null ? `${droplet.diskGb} GB` : '—'}`}
                  color="#ed6c02"
                />
              </Stack>

              <Stack direction="row" flexWrap="wrap" gap={1.5} mb={1}>
                <MetricChart
                  title={`CPU usage (${doWindow} avg ${formatPct(m.cpuPercent.avg)})`}
                  valueLabel={formatPct(m.cpuPercent.latest)}
                  points={m.cpuPercent.points}
                  color="#0069ff"
                  yMax={100}
                />
                <MetricChart
                  title="Memory used"
                  valueLabel={formatPct(m.memoryUsedPercent.latest)}
                  points={m.memoryUsedPercent.points}
                  color="#2e7d32"
                  yMax={100}
                />
                <MetricChart
                  title="Bandwidth out (public)"
                  valueLabel={formatMbps(m.bandwidthOutboundMbps.latest)}
                  points={m.bandwidthOutboundMbps.points}
                  color="#6a1b9a"
                />
                <MetricChart
                  title="Bandwidth in (public)"
                  valueLabel={formatMbps(m.bandwidthInboundMbps.latest)}
                  points={m.bandwidthInboundMbps.points}
                  color="#00838f"
                />
              </Stack>

              {m.note ? (
                <Alert severity={m.empty ? 'warning' : 'info'} sx={{ mt: 1.5 }}>
                  {m.note}
                </Alert>
              ) : null}
            </Box>
          );
        })}
        {doDash?.generatedAt ? (
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
            DO metrics as of {formatWhen(doDash.generatedAt)} (window {doWindow})
          </Typography>
        ) : null}
      </Paper>

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          justifyContent="space-between"
          alignItems={{ sm: 'center' }}
          spacing={1}
          mb={1.5}
        >
          <Box>
            <Typography variant="subtitle1" fontWeight={700}>
              Accounts &amp; automations
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Per-user automation inventory. Expand a row to edit, change schedule, or delete.
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
            <TextField
              size="small"
              placeholder="Search email or user id…"
              value={usersDraftQ}
              onChange={(e) => setUsersDraftQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') applyUsersFilter();
              }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
              }}
              sx={{ minWidth: 220 }}
            />
            <Button size="small" variant="contained" onClick={applyUsersFilter} disabled={usersLoading}>
              Search
            </Button>
          </Stack>
        </Stack>

        {usersError ? (
          <Alert severity="error" sx={{ mb: 1.5 }}>
            {usersError}
          </Alert>
        ) : null}
        {automationsError ? (
          <Alert severity="error" sx={{ mb: 1.5 }}>
            {automationsError}
          </Alert>
        ) : null}

        {usersLoading && !users.length ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress size={28} />
          </Box>
        ) : (
          <>
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              justifyContent="space-between"
              alignItems={{ sm: 'center' }}
              spacing={1}
              sx={{ mb: 1 }}
            >
              <Typography variant="body2" color="text.secondary">
                {usersLoading
                  ? 'Loading accounts…'
                  : usersTotal === 0
                    ? 'No accounts'
                    : `${usersTotal.toLocaleString()} account${usersTotal === 1 ? '' : 's'}`}
              </Typography>
              <Stack direction="row" spacing={1}>
                <Button
                  size="small"
                  disabled={usersPage <= 1 || usersLoading}
                  onClick={() => setUsersPage((p) => p - 1)}
                >
                  Previous
                </Button>
                <Button
                  size="small"
                  disabled={usersPage >= usersTotalPages || usersLoading}
                  onClick={() => setUsersPage((p) => p + 1)}
                >
                  Next
                </Button>
              </Stack>
            </Stack>

            <Stack spacing={1}>
              {users.map((user) => {
                const open = expandedUserId === user.id;
                const automations = automationsByUserId[user.id] || [];
                const loadingAutos = automationsLoadingId === user.id;
                return (
                  <Accordion
                    key={user.id}
                    expanded={open}
                    onChange={(_, isOpen) => {
                      setExpandedUserId(isOpen ? user.id : null);
                      if (isOpen) loadUserAutomations(user.id);
                    }}
                    disableGutters
                    variant="outlined"
                  >
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                      <Stack
                        direction={{ xs: 'column', sm: 'row' }}
                        spacing={1}
                        alignItems={{ sm: 'center' }}
                        sx={{ width: '100%', pr: 1 }}
                      >
                        <Typography fontWeight={600} sx={{ flex: 1, minWidth: 0 }}>
                          {user.email || '(no email)'}
                          {user.orphan ? (
                            <Chip size="small" label="orphan owner" sx={{ ml: 1 }} color="warning" />
                          ) : null}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                          {user.id}
                        </Typography>
                        <Chip
                          size="small"
                          label={`${user.automationCount} automation${user.automationCount === 1 ? '' : 's'}`}
                          color={user.automationCount > 0 ? 'primary' : 'default'}
                          variant="outlined"
                        />
                      </Stack>
                    </AccordionSummary>
                    <AccordionDetails>
                      {loadingAutos ? (
                        <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                          <CircularProgress size={24} />
                        </Box>
                      ) : automations.length === 0 ? (
                        <Typography variant="body2" color="text.secondary">
                          No automations for this account.
                        </Typography>
                      ) : (
                        <Box sx={{ overflowX: 'auto' }}>
                          <Table size="small">
                            <TableHead>
                              <TableRow>
                                <TableCell>Name</TableCell>
                                <TableCell>Scout ID</TableCell>
                                <TableCell>URL</TableCell>
                                <TableCell>Company</TableCell>
                                <TableCell>Tags</TableCell>
                                <TableCell>Schedule</TableCell>
                                <TableCell>Status</TableCell>
                                <TableCell>Last run</TableCell>
                                <TableCell align="right">Actions</TableCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {automations.map((auto) => (
                                <TableRow key={auto.id} hover>
                                  <TableCell sx={{ maxWidth: 160 }}>
                                    <Typography variant="body2" noWrap title={auto.name}>
                                      {auto.name || '—'}
                                    </Typography>
                                  </TableCell>
                                  <TableCell sx={{ fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                                    {auto.scoutId || '—'}
                                  </TableCell>
                                  <TableCell sx={{ maxWidth: 200 }}>
                                    <Typography variant="caption" noWrap title={auto.targetUrl || ''}>
                                      {auto.targetUrl || '—'}
                                    </Typography>
                                  </TableCell>
                                  <TableCell>{auto.companyName || '—'}</TableCell>
                                  <TableCell sx={{ maxWidth: 140 }}>
                                    {(auto.tags || []).length
                                      ? (auto.tags || []).slice(0, 3).join(', ') +
                                        ((auto.tags || []).length > 3 ? '…' : '')
                                      : '—'}
                                  </TableCell>
                                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                                    {auto.schedule
                                      ? auto.schedule.enabled
                                        ? auto.schedule.cron || 'on'
                                        : auto.schedule.paused
                                          ? 'paused'
                                          : 'off'
                                      : '—'}
                                  </TableCell>
                                  <TableCell>
                                    <Chip
                                      size="small"
                                      label={auto.status || 'idle'}
                                      color={STATUS_COLORS[auto.status || ''] || 'default'}
                                    />
                                  </TableCell>
                                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                                    {formatWhen(auto.lastRunTime)}
                                  </TableCell>
                                  <TableCell align="right">
                                    <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                                      <Button size="small" onClick={() => openEditDialog(auto)}>
                                        Edit
                                      </Button>
                                      <Button
                                        size="small"
                                        color="error"
                                        onClick={() => {
                                          setDeleteError(null);
                                          setDeleteTarget(auto);
                                        }}
                                      >
                                        Delete
                                      </Button>
                                    </Stack>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </Box>
                      )}
                    </AccordionDetails>
                  </Accordion>
                );
              })}
            </Stack>
          </>
        )}
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
                    {run.anomaly ? (
                      <Chip
                        size="small"
                        color={run.anomalyMeta?.escalated || run.anomaly === 'zero_rows' ? 'error' : 'warning'}
                        label={
                          run.anomaly === 'zero_rows'
                            ? 'zero rows'
                            : run.anomalyMeta?.escalated
                              ? 'row drop ↑'
                              : 'row drop'
                        }
                      />
                    ) : null}
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

      <Dialog open={!!editAutomation} onClose={() => !editSaving && setEditAutomation(null)} fullWidth maxWidth="sm">
        <DialogTitle>Edit automation</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {editError ? <Alert severity="error">{editError}</Alert> : null}
            <TextField
              label="Name"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              fullWidth
              required
            />
            <TextField
              label="Start URL"
              value={editUrl}
              onChange={(e) => setEditUrl(e.target.value)}
              fullWidth
            />
            <TextField
              label="Company"
              value={editCompany}
              onChange={(e) => setEditCompany(e.target.value)}
              fullWidth
            />
            <TextField
              label="Tags"
              value={editTags}
              onChange={(e) => setEditTags(e.target.value)}
              helperText="Comma-separated"
              fullWidth
            />
            <TextField
              label="Webhook URL"
              value={editWebhook}
              onChange={(e) => setEditWebhook(e.target.value)}
              placeholder={editAutomation.webhookConfigured ? 'Leave blank to keep existing webhook' : 'https://'}
              helperText={
                editAutomation.webhookConfigured
                  ? 'A webhook is already configured. Leave blank to keep it, or enter a new URL.'
                  : 'Optional. Enter a URL to enable a webhook.'
              }
              fullWidth
            />
            <Divider />
            <FormControlLabel
              control={
                <Switch
                  checked={editScheduleEnabled}
                  onChange={(e) => setEditScheduleEnabled(e.target.checked)}
                />
              }
              label="Schedule enabled"
            />
            <TextField
              label="Cron"
              value={editCron}
              onChange={(e) => setEditCron(e.target.value)}
              placeholder="e.g. 0 */6 * * *"
              fullWidth
              helperText={editScheduleEnabled ? 'Required when schedule is enabled' : 'Kept when pausing'}
            />
            <TextField
              label="Timezone"
              value={editTimezone}
              onChange={(e) => setEditTimezone(e.target.value)}
              fullWidth
            />
            {editAutomation?.scoutId || editAutomation?.id ? (
              <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                {editAutomation.scoutId ? `Scout ${editAutomation.scoutId} · ` : ''}
                {editAutomation.id}
              </Typography>
            ) : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditAutomation(null)} disabled={editSaving}>
            Cancel
          </Button>
          <Button variant="contained" onClick={handleSaveEdit} disabled={editSaving || !editName.trim()}>
            {editSaving ? 'Saving…' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!deleteTarget} onClose={() => !deleteSaving && setDeleteTarget(null)} fullWidth maxWidth="xs">
        <DialogTitle>Delete automation?</DialogTitle>
        <DialogContent>
          {deleteError ? (
            <Alert severity="error" sx={{ mb: 1.5 }}>
              {deleteError}
            </Alert>
          ) : null}
          <Typography variant="body2">
            Permanently delete <strong>{deleteTarget?.name || 'this automation'}</strong>
            {deleteTarget?.scoutId ? ` (${deleteTarget.scoutId})` : ''}. This removes runs, extracted
            data, and schedules.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)} disabled={deleteSaving}>
            Cancel
          </Button>
          <Button color="error" variant="contained" onClick={handleConfirmDelete} disabled={deleteSaving}>
            {deleteSaving ? 'Deleting…' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
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
