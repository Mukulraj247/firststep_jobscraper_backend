import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Typography,
  Tooltip,
} from '@mui/material';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ChromeExtensionHandoff } from '../components/dashboard/ChromeExtensionHandoff';
import {
  createAutomation,
  deleteAutomation,
  getDashboardAutomations,
  runAutomation,
  updateAutomationSchedule,
  stopAllAutomationSchedules,
  resumeAllAutomationSchedules,
  AutomationSummary,
  DashboardAutomationsSummary,
} from '../api/automation';
import { useGlobalInfoStore } from '../context/globalInfo';
import { useSocketStore } from '../context/socket';
import { ScheduleModal } from '../components/robot/ScheduleModal';
import { getScheduleLabel } from '../constants/scheduleOptions';
import { computeNextRunRelative, formatRelativeToNow } from '../utils/cronBuilder';
import { TagPicker, formatTagChipLabel } from '../components/automation/TagPicker';

const statusColor = (status: string): 'success' | 'error' | 'warning' | 'info' | 'default' => {
  switch (status) {
    case 'completed':
      return 'success';
    case 'success':
      return 'success';
    case 'failed':
      return 'error';
    case 'dead':
      return 'error';
    case 'pending':
      return 'info';
    case 'queued':
    case 'running':
      return 'warning';
    default:
      return 'default';
  }
};

export const DashboardPage = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const extensionCardRef = useRef<HTMLDivElement | null>(null);
  const { notify } = useGlobalInfoStore();
  const { queueSocket } = useSocketStore();
  const [automations, setAutomations] = useState<AutomationSummary[]>([]);
  const [summary, setSummary] = useState<DashboardAutomationsSummary | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [hasBackgroundUpdates, setHasBackgroundUpdates] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [tick, setTick] = useState(0); // refreshes next-run countdown every 30s
  const [form, setForm] = useState({
    name: '',
    companyName: '',
    startUrl: 'https://',
    webhookUrl: '',
  });
  const [createTags, setCreateTags] = useState<string[]>([]);
  const [tagFilter, setTagFilter] = useState<string[]>([]);

  // Schedule modal state
  const [scheduleModal, setScheduleModal] = useState<{
    open: boolean;
    automationId: string;
    automationName: string;
    currentCron: string | null | undefined;
    currentTimezone: string;
  }>({
    open: false,
    automationId: '',
    automationName: '',
    currentCron: null,
    currentTimezone: 'UTC',
  });

  const [deleteTarget, setDeleteTarget] = useState<AutomationSummary | null>(null);
  const [stopAllOpen, setStopAllOpen] = useState(false);
  const [stoppingAll, setStoppingAll] = useState(false);
  const [resumeAllOpen, setResumeAllOpen] = useState(false);
  const [resumingAll, setResumingAll] = useState(false);
  const [copiedTargetUrl, setCopiedTargetUrl] = useState<string | null>(null);
  const [copiedScoutId, setCopiedScoutId] = useState<string | null>(null);

  const copyTargetUrl = useCallback(async (url?: string) => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedTargetUrl(url);
      window.setTimeout(() => {
        setCopiedTargetUrl((current) => (current === url ? null : current));
      }, 1500);
    } catch {
      setCopiedTargetUrl(null);
    }
  }, []);

  const copyScoutId = useCallback(async (scoutId?: string | null) => {
    if (!scoutId) return;
    try {
      await navigator.clipboard.writeText(scoutId);
      setCopiedScoutId(scoutId);
      window.setTimeout(() => {
        setCopiedScoutId((current) => (current === scoutId ? null : current));
      }, 1500);
    } catch {
      setCopiedScoutId(null);
    }
  }, []);

  const activeScheduledCount = summary?.activeScheduledCount ?? 0;
  const pausedScheduleCount = summary?.pausedScheduleCount ?? 0;

  const buildAutomationSnapshot = useCallback((rows: AutomationSummary[]) => {
    return rows
      .map((automation) => [
        automation.id,
        automation.updatedAt || '',
        automation.status || '',
        String(automation.rowsExtracted || 0),
        automation.lastRunTime || '',
        automation.schedule?.enabled ? '1' : '0',
        automation.schedule?.cron || '',
        (automation.schedule as any)?.timezone || '',
        automation.schedule?.paused ? '1' : '0',
      ].join('|'))
      .sort()
      .join('||');
  }, []);

  const buildDashboardListSignature = useCallback(
    (payload: { summary: DashboardAutomationsSummary; total: number; rows: AutomationSummary[] }) =>
      [JSON.stringify(payload.summary), String(payload.total), buildAutomationSnapshot(payload.rows)].join('||'),
    [buildAutomationSnapshot]
  );

  const latestSnapshotRef = useRef<string>('');

  const loadAutomations = useCallback(
    async (options?: { silent?: boolean; page?: number; limit?: number }) => {
      const silent = !!options?.silent;
      const apiPage = options?.page ?? page + 1;
      const limit = options?.limit ?? rowsPerPage;
      if (silent) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }
      try {
        const data = await getDashboardAutomations({
          page: apiPage,
          limit,
          ...(tagFilter.length ? { tags: tagFilter } : {}),
        });
        setAutomations(data.automations);
        setSummary(data.summary);
        setTotalCount(data.pagination.total);
        latestSnapshotRef.current = buildDashboardListSignature({
          summary: data.summary,
          total: data.pagination.total,
          rows: data.automations,
        });
        setHasBackgroundUpdates(false);
      } catch (error: any) {
        // Avoid toast spam on rate-limit; caller effects must not re-fire from notify.
        if (error?.response?.status !== 429) {
          notify('error', error?.response?.data?.error || 'Failed to load automations');
        }
      } finally {
        if (silent) {
          setIsRefreshing(false);
        } else {
          setIsLoading(false);
        }
      }
    },
    [notify, buildDashboardListSignature, page, rowsPerPage, tagFilter]
  );

  useEffect(() => {
    loadAutomations();
  }, [loadAutomations]);

  useEffect(() => {
    if (isLoading) return;
    const maxPage = Math.max(0, Math.ceil(totalCount / (rowsPerPage || 1)) - 1);
    if (totalCount > 0 && page > maxPage) {
      setPage(maxPage);
    }
    if (totalCount === 0 && page !== 0) {
      setPage(0);
    }
  }, [isLoading, totalCount, rowsPerPage, page]);

  // Refresh relative countdown every 30s
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 30000);
    return () => clearInterval(id);
  }, []);

  // Background stale check: lightweight — reuse same endpoint but avoid stacking
  // refreshes while a manual refresh is already in flight.
  useEffect(() => {
    const id = setInterval(() => {
      if (document.hidden || isLoading || isRefreshing || hasBackgroundUpdates) return;
      getDashboardAutomations({
        page: page + 1,
        limit: rowsPerPage,
        ...(tagFilter.length ? { tags: tagFilter } : {}),
      })
        .then((fresh) => {
          const freshSig = buildDashboardListSignature({
            summary: fresh.summary,
            total: fresh.pagination.total,
            rows: fresh.automations,
          });
          if (freshSig && freshSig !== latestSnapshotRef.current) {
            setHasBackgroundUpdates(true);
          }
        })
        .catch(() => {
          // Keep this silent to avoid noisy toasts for background checks.
        });
    }, 180000);
    return () => clearInterval(id);
  }, [buildDashboardListSignature, hasBackgroundUpdates, isLoading, isRefreshing, page, rowsPerPage, tagFilter]);

  useEffect(() => {
    if (searchParams.get('extension') === '1' && extensionCardRef.current) {
      extensionCardRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [searchParams]);

  // Refresh dashboard when runs start or complete via the shared queue socket
  // The socket is managed by MainPage; if it's available here we attach lightweight listeners
  useEffect(() => {
    if (!queueSocket) return;
    const refresh = () => { loadAutomations(); };
    queueSocket.on('run-started', refresh);
    queueSocket.on('run-completed', refresh);
    return () => {
      queueSocket.off('run-started', refresh);
      queueSocket.off('run-completed', refresh);
    };
  }, [queueSocket, loadAutomations]);

  const totals = {
    rows: summary?.rowsExtractedTotal ?? 0,
    success: summary?.successfulCount ?? 0,
    failed: summary?.failedCount ?? 0,
  };

  const handleCreate = async () => {
    if (!form.companyName.trim()) {
      notify('error', 'Company name is required');
      return;
    }
    try {
      await createAutomation({
        name: form.name,
        companyName: form.companyName.trim(),
        startUrl: form.startUrl,
        webhookUrl: form.webhookUrl,
        tags: createTags,
        config: {
          dataCleanup: {
            removeEmptyRows: true,
            removeDuplicates: true,
          },
          pagination: {
            mode: 'none',
            autoScroll: false,
          },
        },
      });
      setIsCreateOpen(false);
      setForm({ name: '', companyName: '', startUrl: 'https://', webhookUrl: '' });
      setCreateTags([]);
      notify('success', 'Automation created');
      await loadAutomations();
    } catch (error: any) {
      notify('error', error?.response?.data?.error || 'Failed to create automation');
    }
  };

  const handleRun = async (automationId: string) => {
    try {
      const result = await runAutomation(automationId);
      notify('info', 'Automation queued — check Run History for status');
      await loadAutomations();
      if (result.runId) {
        navigate(`/run/${result.runId}`);
      }
    } catch (error: any) {
      notify('error', error?.response?.data?.error || 'Failed to run automation');
    }
  };

  const openScheduleModal = (automation: AutomationSummary) => {
    setScheduleModal({
      open: true,
      automationId: automation.id,
      automationName: automation.name,
      currentCron: automation.schedule?.cron || null,
      currentTimezone: (automation.schedule as any)?.timezone || 'UTC',
    });
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    try {
      await deleteAutomation(deleteTarget.id);
      notify('success', `Deleted “${deleteTarget.name}” (in-flight scrapes aborted) and related runs, data, and jobs`);
      setDeleteTarget(null);
      await loadAutomations();
    } catch (error: any) {
      notify('error', error?.response?.data?.error || 'Failed to delete automation');
    }
  };

  const handleScheduleSave = async (
    automationId: string,
    schedule: {
      enabled: boolean;
      cron: string | null;
      timezone: string;
      preferredNextRunAt?: string | null;
    }
  ) => {
    try {
      await updateAutomationSchedule(automationId, schedule);
      notify(
        'success',
        schedule.enabled
          ? `Schedule saved: ${getScheduleLabel(schedule.cron)}`
          : 'Schedule disabled'
      );
      await loadAutomations();
    } catch (error: any) {
      notify('error', error?.response?.data?.error || 'Failed to save schedule');
      throw error;
    }
  };

  const handleStopSchedule = async (automation: AutomationSummary) => {
    try {
      const tz = (automation.schedule as any)?.timezone || 'UTC';
      await updateAutomationSchedule(automation.id, {
        enabled: false,
        cron: null,
        timezone: tz,
      });
      notify('success', `Schedule paused for “${automation.name}” — use Resume to turn it back on`);
      await loadAutomations();
    } catch (error: any) {
      notify('error', error?.response?.data?.error || 'Failed to pause schedule');
    }
  };

  const handleResumeSchedule = async (automation: AutomationSummary) => {
    const cron = automation.schedule?.cron;
    const tz = (automation.schedule as any)?.timezone || 'UTC';
    if (!cron?.trim()) {
      notify('error', 'No saved interval — open Schedule and pick a cadence first');
      return;
    }
    try {
      await updateAutomationSchedule(automation.id, {
        enabled: true,
        cron,
        timezone: tz,
      });
      notify('success', `Schedule resumed for “${automation.name}”`);
      await loadAutomations();
    } catch (error: any) {
      notify('error', error?.response?.data?.error || 'Failed to resume schedule');
    }
  };

  const handleStopAllSchedules = async () => {
    setStoppingAll(true);
    try {
      const { stoppedCount } = await stopAllAutomationSchedules();
      notify(
        'success',
        stoppedCount === 0
          ? 'No active schedules to pause'
          : `Paused ${stoppedCount} schedule${stoppedCount === 1 ? '' : 's'} (use Resume to turn them back on)`
      );
      setStopAllOpen(false);
      await loadAutomations();
    } catch (error: any) {
      notify('error', error?.response?.data?.error || 'Failed to stop all schedules');
    } finally {
      setStoppingAll(false);
    }
  };

  const handleResumeAllSchedules = async () => {
    setResumingAll(true);
    try {
      const { resumedCount } = await resumeAllAutomationSchedules();
      notify(
        'success',
        resumedCount === 0
          ? 'No paused schedules to resume'
          : `Resumed ${resumedCount} schedule${resumedCount === 1 ? '' : 's'}`
      );
      setResumeAllOpen(false);
      await loadAutomations();
    } catch (error: any) {
      notify('error', error?.response?.data?.error || 'Failed to resume all schedules');
    } finally {
      setResumingAll(false);
    }
  };

  const handleManualRefresh = async () => {
    await loadAutomations({ silent: true });
  };

  return (
    <Box sx={{ p: 4 }}>
      <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', md: 'center' }} spacing={2} mb={3}>
        <Box>
          <Typography variant="h4" fontWeight={700}>Automation Dashboard</Typography>
          <Typography variant="body1" color="text.secondary">
            Manage cloud-style scraping automations, inspect runs, and open extracted datasets.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Button
            variant={hasBackgroundUpdates ? 'contained' : 'outlined'}
            color={hasBackgroundUpdates ? 'warning' : 'inherit'}
            onClick={handleManualRefresh}
            disabled={isLoading || isRefreshing}
          >
            {isRefreshing ? 'Refreshing…' : 'Refresh'}
          </Button>
          {activeScheduledCount > 0 ? (
            <Button variant="outlined" color="warning" onClick={() => setStopAllOpen(true)}>
              Pause all schedules
            </Button>
          ) : null}
          {pausedScheduleCount > 0 ? (
            <Button variant="outlined" color="success" onClick={() => setResumeAllOpen(true)}>
              Resume all schedules
            </Button>
          ) : null}
          <Button variant="contained" onClick={() => setIsCreateOpen(true)}>
            New Automation
          </Button>
        </Stack>
      </Stack>

      {hasBackgroundUpdates && (
        <Alert
          severity="info"
          sx={{ mb: 2 }}
          action={
            <Button color="inherit" size="small" onClick={handleManualRefresh} disabled={isRefreshing}>
              {isRefreshing ? 'Refreshing…' : 'Refresh now'}
            </Button>
          }
        >
          New automation updates are available.
        </Alert>
      )}

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} mb={3}>
        <Paper sx={{ p: 2, minWidth: 180 }}>
          <Typography variant="overline">Automations</Typography>
          <Typography variant="h5">{summary?.totalAutomations ?? 0}</Typography>
        </Paper>
        <Paper sx={{ p: 2, minWidth: 180 }}>
          <Typography variant="overline">Rows Extracted</Typography>
          <Typography variant="h5">{totals.rows}</Typography>
          <Typography variant="caption" color="text.secondary" display="block">
            All pages
          </Typography>
        </Paper>
        <Paper sx={{ p: 2, minWidth: 180 }}>
          <Typography variant="overline">Successful</Typography>
          <Typography variant="h5">{totals.success}</Typography>
          <Typography variant="caption" color="text.secondary" display="block">
            All pages
          </Typography>
        </Paper>
        <Paper sx={{ p: 2, minWidth: 180 }}>
          <Typography variant="overline">Failed</Typography>
          <Typography variant="h5">{totals.failed}</Typography>
          <Typography variant="caption" color="text.secondary" display="block">
            All pages
          </Typography>
        </Paper>
        {activeScheduledCount > 0 && (
          <Paper sx={{ p: 2, minWidth: 180, bgcolor: 'primary.main', color: 'primary.contrastText' }}>
            <Typography variant="overline" sx={{ opacity: 0.85 }}>Scheduled (active)</Typography>
            <Typography variant="h5">{activeScheduledCount}</Typography>
          </Paper>
        )}
        {pausedScheduleCount > 0 && (
          <Paper sx={{ p: 2, minWidth: 180, bgcolor: 'warning.light', color: 'warning.contrastText' }}>
            <Typography variant="overline" sx={{ opacity: 0.85 }}>Paused</Typography>
            <Typography variant="h5">{pausedScheduleCount}</Typography>
          </Paper>
        )}
      </Stack>

      <ChromeExtensionHandoff ref={extensionCardRef} />

      <Alert severity="info" sx={{ mb: 2 }}>
        <strong>Schedule</strong> sets recurring runs (Agenda on MongoDB). <strong>Pause</strong> stops timers but keeps your
        interval so you can <strong>Resume</strong> later. Pause/Resume does not delete robots, runs, or extracted data.
      </Alert>

      <Paper sx={{ p: 2, mb: 2 }}>
        <Typography variant="subtitle2" fontWeight={700} mb={1}>
          Filter by tags
        </Typography>
        <TagPicker value={tagFilter} onChange={(next) => { setTagFilter(next); setPage(0); }} />
      </Paper>

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell><strong>Name</strong></TableCell>
              <TableCell><strong>ID</strong></TableCell>
              <TableCell><strong>Company</strong></TableCell>
              <TableCell><strong>Tags</strong></TableCell>
              <TableCell><strong>Target URL</strong></TableCell>
              <TableCell><strong>Last Run</strong></TableCell>
              <TableCell><strong>Rows</strong></TableCell>
              <TableCell><strong>Status</strong></TableCell>
              <TableCell><strong>Next Run</strong></TableCell>
              <TableCell><strong>Schedule</strong></TableCell>
              <TableCell align="right"><strong>Actions</strong></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {(isLoading ? [] : automations).map((automation) => (
              <TableRow key={automation.id} hover>
                <TableCell sx={{ fontWeight: 500 }}>{automation.name}</TableCell>
                <TableCell sx={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>
                  {automation.scoutId ? (
                    <Tooltip title={copiedScoutId === automation.scoutId ? 'Copied' : 'Click to copy'} arrow>
                      <Button
                        size="small"
                        variant="text"
                        onClick={() => copyScoutId(automation.scoutId)}
                        sx={{ minWidth: 0, px: 0.5, fontFamily: 'inherit', fontSize: 12, textTransform: 'none' }}
                      >
                        {automation.scoutId}
                      </Button>
                    </Tooltip>
                  ) : (
                    <Typography variant="caption" color="text.disabled">—</Typography>
                  )}
                </TableCell>
                <TableCell sx={{ fontSize: 13 }}>
                  {automation.companyName?.trim() ? automation.companyName : '—'}
                </TableCell>
                <TableCell sx={{ maxWidth: 220 }}>
                  <Stack direction="row" flexWrap="wrap" gap={0.5}>
                    {(automation.tags || []).length
                      ? (automation.tags || []).map((tag) => (
                          <Chip
                            key={tag}
                            size="small"
                            variant="outlined"
                            label={formatTagChipLabel(tag)}
                            onClick={() => {
                              if (!tagFilter.includes(tag)) {
                                setTagFilter((prev) => [...prev, tag].slice(0, 5));
                                setPage(0);
                              }
                            }}
                          />
                        ))
                      : '—'}
                  </Stack>
                </TableCell>
                <TableCell sx={{ fontSize: 12 }}>
                  {automation.targetUrl ? (
                    <Stack direction="row" spacing={0.5}>
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => window.open(automation.targetUrl, '_blank', 'noopener,noreferrer')}
                      >
                        Open
                      </Button>
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => copyTargetUrl(automation.targetUrl)}
                      >
                        {copiedTargetUrl === automation.targetUrl ? 'Copied' : 'Copy'}
                      </Button>
                    </Stack>
                  ) : (
                    '—'
                  )}
                </TableCell>
                <TableCell sx={{ fontSize: 13 }}>{automation.lastRunTime || 'Never'}</TableCell>
                <TableCell>{automation.rowsExtracted || 0}</TableCell>
                <TableCell>
                  <Stack spacing={0.5} alignItems="flex-start">
                    <Chip size="small" label={automation.status} color={statusColor(automation.status)} />
                    {automation.latestFailureReason === 'layout_change' ? (
                      <Chip
                        size="small"
                        color="warning"
                        variant="outlined"
                        label={
                          automation.latestFailureReasonSource === 'confirmed'
                            ? 'Layout change'
                            : 'Layout change?'
                        }
                        onClick={() => {
                          if (automation.latestRunId) navigate(`/run/${automation.latestRunId}`);
                        }}
                        sx={{ cursor: automation.latestRunId ? 'pointer' : 'default' }}
                      />
                    ) : null}
                  </Stack>
                </TableCell>
                <TableCell sx={{ fontSize: 13 }}>
                  {automation.schedule?.enabled && automation.schedule?.cron ? (() => {
                    const tz = (automation.schedule as any)?.timezone || 'UTC';
                    const serverNext = (automation.schedule as any)?.nextRunAt
                      ? new Date((automation.schedule as any).nextRunAt)
                      : null;
                    const { relative, absolute } =
                      serverNext && !Number.isNaN(serverNext.getTime())
                        ? formatRelativeToNow(serverNext, tz)
                        : computeNextRunRelative(automation.schedule.cron, tz);
                    return (
                      <Tooltip title={absolute} arrow>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <Box
                            component="span"
                            sx={{
                              width: 6,
                              height: 6,
                              borderRadius: '50%',
                              backgroundColor: '#10b981',
                              flexShrink: 0,
                              animation: 'pulse 2s infinite',
                              '@keyframes pulse': {
                                '0%, 100%': { opacity: 1 },
                                '50%': { opacity: 0.4 },
                              },
                            }}
                          />
                          <Typography variant="body2" sx={{ fontSize: 12, fontWeight: 600, color: '#10b981' }}>
                            {relative}
                          </Typography>
                        </Box>
                      </Tooltip>
                    );
                  })() : automation.schedule?.cron && !automation.schedule?.enabled ? (
                    <Typography variant="body2" sx={{ fontSize: 12, color: 'warning.main', fontWeight: 600 }}>
                      Paused
                    </Typography>
                  ) : (
                    <Typography variant="body2" sx={{ fontSize: 12, color: 'text.disabled' }}>
                      —
                    </Typography>
                  )}
                </TableCell>
                <TableCell>
                  <Tooltip
                    title={
                      automation.schedule?.enabled && automation.schedule?.cron
                        ? `Cron: ${automation.schedule.cron}`
                        : automation.schedule?.cron && !automation.schedule?.enabled
                          ? `Paused — cron: ${automation.schedule.cron}`
                          : 'Click Schedule to set up automatic runs'
                    }
                  >
                    <Chip
                      size="small"
                      variant={automation.schedule?.enabled ? 'filled' : 'outlined'}
                      color={
                        automation.schedule?.enabled
                          ? 'primary'
                          : automation.schedule?.cron && !automation.schedule?.enabled
                            ? 'warning'
                            : 'default'
                      }
                      label={
                        automation.schedule?.enabled
                          ? getScheduleLabel(automation.schedule.cron)
                          : automation.schedule?.cron && !automation.schedule?.enabled
                            ? `Paused · ${getScheduleLabel(automation.schedule.cron)}`
                            : 'No schedule'
                      }
                      onClick={() => openScheduleModal(automation)}
                      sx={{ cursor: 'pointer', fontWeight: automation.schedule?.enabled ? 600 : 400 }}
                    />
                  </Tooltip>
                </TableCell>
                <TableCell align="right">
                  <Stack direction="row" spacing={1} justifyContent="flex-end">
                    <Button size="small" variant="contained" onClick={() => handleRun(automation.id)}>
                      Run
                    </Button>
                    <Button
                      size="small"
                      variant="outlined"
                      color="primary"
                      onClick={() => openScheduleModal(automation)}
                    >
                      Schedule
                    </Button>
                    {automation.schedule?.enabled ? (
                      <Tooltip title="Pause recurring runs — your interval is saved for Resume">
                        <Button
                          size="small"
                          variant="outlined"
                          color="warning"
                          onClick={() => handleStopSchedule(automation)}
                        >
                          Pause schedule
                        </Button>
                      </Tooltip>
                    ) : automation.schedule?.cron && !automation.schedule?.enabled ? (
                      <Tooltip title="Turn the same recurring schedule back on (Agenda)">
                        <Button
                          size="small"
                          variant="outlined"
                          color="success"
                          onClick={() => handleResumeSchedule(automation)}
                        >
                          Resume schedule
                        </Button>
                      </Tooltip>
                    ) : null}
                    <Button size="small" variant="outlined" onClick={() => navigate(`/automation/${automation.id}/data`)}>
                      View Data
                    </Button>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => {
                        if (automation.id) navigate(`/runs/${automation.id}`);
                      }}
                      sx={{ color: 'text.secondary', borderColor: 'divider' }}
                    >
                      Run History
                    </Button>
                    <Button size="small" variant="outlined" onClick={() => navigate(`/automation/${automation.id}/config`)}>
                      Configure
                    </Button>
                    <Button
                      size="small"
                      variant="outlined"
                      color="error"
                      onClick={() => setDeleteTarget(automation)}
                    >
                      Delete
                    </Button>
                    {automation.latestRunId ? (
                      <Button size="small" variant="text" onClick={() => navigate(`/run/${automation.latestRunId}`)}>
                        Last Run
                      </Button>
                    ) : null}
                  </Stack>
                </TableCell>
              </TableRow>
            ))}
            {!isLoading && automations.length === 0 ? (
              <TableRow>
                <TableCell colSpan={11}>
                  <Typography color="text.secondary">No automations yet.</Typography>
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
        <TablePagination
          component="div"
          count={totalCount}
          page={page}
          onPageChange={(_, newPage) => setPage(newPage)}
          rowsPerPage={rowsPerPage}
          onRowsPerPageChange={(event) => {
            setRowsPerPage(parseInt(event.target.value, 10));
            setPage(0);
          }}
          rowsPerPageOptions={[10, 25, 50, 100]}
        />
      </TableContainer>

      {/* Create Automation Dialog */}
      <Dialog open={isCreateOpen} onClose={() => setIsCreateOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Create Automation</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Name" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
            <TextField
              label="Company name"
              required
              value={form.companyName}
              onChange={(event) => setForm((current) => ({ ...current, companyName: event.target.value }))}
              helperText="Required"
            />
            <TagPicker value={createTags} onChange={setCreateTags} />
            <TextField label="Start URL" value={form.startUrl} onChange={(event) => setForm((current) => ({ ...current, startUrl: event.target.value }))} />
            <TextField label="Webhook URL" value={form.webhookUrl} onChange={(event) => setForm((current) => ({ ...current, webhookUrl: event.target.value }))} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setIsCreateOpen(false)}>Cancel</Button>
          <Button onClick={handleCreate} variant="contained" disabled={!form.companyName.trim() || !form.name.trim()}>
            Create
          </Button>
        </DialogActions>
      </Dialog>

      {/* Schedule Modal */}
      <ScheduleModal
        open={scheduleModal.open}
        automationId={scheduleModal.automationId}
        automationName={scheduleModal.automationName}
        currentCron={scheduleModal.currentCron}
        currentTimezone={scheduleModal.currentTimezone}
        onClose={() => setScheduleModal((s) => ({ ...s, open: false }))}
        onSave={handleScheduleSave}
      />

      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)} fullWidth maxWidth="sm">
        <DialogTitle>Delete automation?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            This permanently removes <strong>{deleteTarget?.name}</strong> and everything tied to it:
          </Typography>
          <Typography component="ul" variant="body2" color="text.secondary" sx={{ pl: 2, m: 0 }}>
            <li>Robot / automation record</li>
            <li>All runs and extracted rows in MongoDB</li>
            <li>Agenda queue jobs (scrapes, schedules, execution jobs)</li>
            <li>Stored session state and cloud screenshots for those runs (if Firebase Storage is configured)</li>
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)}>Cancel</Button>
          <Button onClick={handleDeleteConfirm} color="error" variant="contained">
            Delete everything
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={stopAllOpen} onClose={() => !stoppingAll && setStopAllOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Pause all recurring schedules?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            Every automation that currently has an <strong>active</strong> schedule will be paused: Agenda
            schedule-trigger jobs are cancelled, so no new timed runs start. Your cron expressions stay saved in the database so
            you can resume later. This does not delete robots, run history, or extracted rows. Scraper jobs already
            running finish on their own.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setStopAllOpen(false)} disabled={stoppingAll}>
            Cancel
          </Button>
          <Button onClick={handleStopAllSchedules} color="warning" variant="contained" disabled={stoppingAll}>
            {stoppingAll ? 'Pausing…' : 'Pause all'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={resumeAllOpen} onClose={() => !resumingAll && setResumeAllOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Resume all paused schedules?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            Every automation with a saved interval that is <strong>paused</strong> will turn back on: the same
            cron and timezone are re-applied and Agenda triggers are registered again. Already-active schedules
            are left unchanged.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setResumeAllOpen(false)} disabled={resumingAll}>
            Cancel
          </Button>
          <Button onClick={handleResumeAllSchedules} color="success" variant="contained" disabled={resumingAll}>
            {resumingAll ? 'Resuming…' : 'Resume all'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};
