import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import PlayCircleOutlineIcon from '@mui/icons-material/PlayCircleOutline';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import WorkOutlineIcon from '@mui/icons-material/WorkOutline';
import TableChartOutlinedIcon from '@mui/icons-material/TableChartOutlined';
import BoltOutlinedIcon from '@mui/icons-material/BoltOutlined';
import MemoryOutlinedIcon from '@mui/icons-material/MemoryOutlined';
import LayersOutlinedIcon from '@mui/icons-material/LayersOutlined';
import PublicOutlinedIcon from '@mui/icons-material/PublicOutlined';
import TimerOutlinedIcon from '@mui/icons-material/TimerOutlined';
import DnsOutlinedIcon from '@mui/icons-material/DnsOutlined';
import FilterListIcon from '@mui/icons-material/FilterList';
import LocalOfferOutlinedIcon from '@mui/icons-material/LocalOfferOutlined';
import {
  getDashboardDigitalOcean,
  getDashboardMetrics,
  type OpsMetricsWindow,
} from '../api/automation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  dashboardDigitalOceanQueryOptions,
  dashboardMetricsQueryOptions,
} from '../features/dashboard/dashboardQueries';
import { useGlobalInfoStore } from '../context/globalInfo';
import { MiniChart } from '../components/dashboard/ops/MiniChart';
import { DashboardHeroSection } from '../components/dashboard/ops/DashboardHeroSection';
import { OpsHeroBackdrop } from '../components/dashboard/ops/OpsHeroBackdrop';
import { StatCard } from '../components/dashboard/ops/StatCard';
import { TagPill } from '../components/dashboard/ops/TagPill';
import { TagFilterModal } from '../features/dashboard/TagFilterModal';
import {
  applyDashboardTagSelection,
  defaultDashboardDate,
  failuresHrefFromDashboard,
  isDashboardCalendarDayMode,
  normalizeChartTimestampMs,
  selectableDashboardTags,
} from '../features/dashboard/dashboardPageBehavior';
import { formatIstDateTime, isIstDateWithinLastDays } from '../shared/opsTimezone';
import {
  cardSx,
  fadeUpSx,
  FIRSTSTEP,
  heroGlassPanelSx,
  METRIC_COLORS,
  RADIUS,
  tint,
} from '../components/dashboard/ops/dashboardTokens';

const CHART_HEIGHT = 168;

const WINDOW_FUTURE_LABEL: Record<OpsMetricsWindow, string> = {
  '15m': '15 minutes',
  '30m': '30 minutes',
  '1h': '1 hour',
  '3h': '3 hours',
  '6h': '6 hours',
  '24h': '24 hours',
};

const formatForecastUntil = (iso?: string) => {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return formatIstDateTime(ms);
};

const formatBytes = (n?: number | null) => {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

const formatPct = (n?: number | null, digits = 1) => {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n.toFixed(digits)}%`;
};

const formatCompactNumber = (n?: number | null) => {
  if (n == null || !Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
};

const formatUptime = (seconds?: number | null) => {
  if (seconds == null || !Number.isFinite(seconds)) return '—';
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
};

const methodLabel = (method: string) => {
  const key = String(method || '').toLowerCase();
  if (key === 'scrape.do') return 'Scraping algorithm';
  if (key === 'ats') return 'ATS direct';
  if (key === 'browser') return 'Browser fallback';
  if (key === 'list') return 'List complete';
  if (key === 'llm') return 'LLM';
  return method || 'Other';
};

const SectionHeading = ({ title, caption }: { title: string; caption?: string }) => (
  <Box sx={{ mb: 1.75 }}>
    <Stack direction="row" alignItems="center" spacing={1.25}>
      <Box
        aria-hidden
        sx={{
          width: 4,
          height: 18,
          borderRadius: RADIUS.pill,
          background: `linear-gradient(180deg, ${FIRSTSTEP.teal} 0%, ${FIRSTSTEP.navy} 100%)`,
        }}
      />
      <Typography
        variant="h6"
        sx={{ fontWeight: 700, letterSpacing: '-0.01em', color: 'text.primary' }}
      >
        {title}
      </Typography>
    </Stack>
    {caption ? (
      <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5, ml: 2.25 }}>
        {caption}
      </Typography>
    ) : null}
  </Box>
);

const ComputeStat = ({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) => (
  <Stack direction="row" alignItems="center" spacing={1.5} sx={{ minWidth: 0 }}>
    <Box
      aria-hidden
      sx={{
        width: 36,
        height: 36,
        flexShrink: 0,
        display: 'grid',
        placeItems: 'center',
        borderRadius: '10px',
        color: FIRSTSTEP.tealDark,
        bgcolor: tint(FIRSTSTEP.teal, 0.12),
        '& svg': { fontSize: 19 },
      }}
    >
      {icon}
    </Box>
    <Box sx={{ minWidth: 0 }}>
      <Typography
        variant="caption"
        sx={{
          display: 'block',
          color: 'text.secondary',
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          fontSize: '0.66rem',
        }}
      >
        {label}
      </Typography>
      <Typography
        noWrap
        sx={{ fontWeight: 700, color: 'text.primary', fontVariantNumeric: 'tabular-nums' }}
      >
        {value}
      </Typography>
    </Box>
  </Stack>
);

export const DashboardPage = () => {
  const queryClient = useQueryClient();
  const { notify } = useGlobalInfoStore();
  const [window, setWindow] = useState<OpsMetricsWindow>('6h');
  const [date, setDate] = useState(() => defaultDashboardDate());
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagModalOpen, setTagModalOpen] = useState(false);

  const dayMode = isDashboardCalendarDayMode(date);
  const query = useMemo(
    () => ({ window, date: date || null }),
    [window, date],
  );
  const metricsQuery = useQuery({
    ...dashboardMetricsQueryOptions(query),
    retry: 1,
  });
  const digitalOceanQuery = useQuery({
    ...dashboardDigitalOceanQueryOptions(query),
    retry: 1,
  });

  const metrics = metricsQuery.data ?? null;
  const loading = metricsQuery.isLoading;
  const refreshing = (metricsQuery.isFetching || digitalOceanQuery.isFetching) && !metricsQuery.isLoading;
  const notifiedError = useRef<unknown>(null);

  useEffect(() => {
    if (!metricsQuery.isError) {
      notifiedError.current = null;
      return;
    }
    const error = metricsQuery.error as any;
    if (notifiedError.current === error) return;
    notifiedError.current = error;
    if (error?.response?.status !== 429) {
      notify('error', error?.response?.data?.error || 'Failed to load dashboard metrics');
    }
  }, [metricsQuery.error, metricsQuery.isError, notify]);

  const handleRefresh = () => {
    void Promise.all([
      queryClient.fetchQuery({
        queryKey: dashboardMetricsQueryOptions(query).queryKey,
        queryFn: ({ signal }) => getDashboardMetrics({ ...query, fresh: true }, signal),
      }),
      queryClient.fetchQuery({
        queryKey: dashboardDigitalOceanQueryOptions(query).queryKey,
        queryFn: ({ signal }) => getDashboardDigitalOcean({ ...query, fresh: true }, signal),
      }),
    ]).catch((error: any) => {
      if (error?.response?.status !== 429) {
        notify('error', error?.response?.data?.error || 'Failed to load dashboard metrics');
      }
    });
  };

  const handleWindowChange = (next: OpsMetricsWindow) => {
    setWindow(next);
  };

  const handleDateChange = (next: string) => {
    if (!next) {
      setDate(defaultDashboardDate());
      return;
    }
    if (!isIstDateWithinLastDays(next, Date.now(), 7)) return;
    setDate(next);
  };

  const totals = metrics?.totals;
  const compute = metrics?.compute;
  const digitalOcean = digitalOceanQuery.data ?? metrics?.digitalOcean;
  const droplet = digitalOcean?.droplets?.[0];
  const m = droplet?.metrics;

  const withChartTime = (points: Array<{ t: number; v: number }>) =>
    points.map((point) => ({ ...point, t: normalizeChartTimestampMs(point.t) }));

  const runSeriesPoints = (metrics?.series.runs || []).map((b) => ({ t: b.t, v: b.total }));
  const passSeriesPoints = (metrics?.series.runs || []).map((b) => ({ t: b.t, v: b.passed }));
  const failSeriesPoints = (metrics?.series.runs || []).map((b) => ({ t: b.t, v: b.failed }));
  const jobsSeriesPoints = (metrics?.series.jobsAdded || []).map((b) => ({ t: b.t, v: b.jobsAdded }));

  const enrichment = compute?.enrichment;
  const creditSeriesPoints = (enrichment?.series14d || []).map((b) => ({
    t: normalizeChartTimestampMs(b.t),
    v: b.credits,
  }));
  const creditsToday = enrichment?.creditsSpentToday ?? 0;
  const creditBudget = enrichment?.dailyCreditBudget ?? 0;
  const creditBudgetPct =
    creditBudget > 0 ? Math.min(100, Math.round((creditsToday / creditBudget) * 100)) : null;

  const passRate =
    totals && totals.runs > 0 ? Math.round((totals.passed / totals.runs) * 100) : null;

  const upcoming = metrics?.upcomingSchedules;
  const forecastUntilLabel = formatForecastUntil(upcoming?.forecastUntil);
  const futureWindowLabel = dayMode ? WINDOW_FUTURE_LABEL['24h'] : WINDOW_FUTURE_LABEL[window];
  const failedHref = failuresHrefFromDashboard(
    dayMode ? { mode: 'day', date } : { mode: 'window', window },
  );

  const catalogTags = useMemo(
    () => selectableDashboardTags(metrics?.tags ?? []),
    [metrics?.tags],
  );
  const visibleTags = useMemo(
    () => applyDashboardTagSelection(catalogTags, selectedTags),
    [catalogTags, selectedTags],
  );

  return (
    <Box
      sx={{
        p: { xs: 2, md: 3 },
        minHeight: '100%',
        bgcolor: (theme) => (theme.palette.mode === 'dark' ? '#000' : FIRSTSTEP.surface),
      }}
    >
      <Paper
        elevation={0}
        sx={[
          fadeUpSx(0),
          heroGlassPanelSx({ mb: 3, shadow: 'lifted' }),
          { p: { xs: 2.5, md: 3.5 } },
        ]}
      >
        <OpsHeroBackdrop />

        <DashboardHeroSection
          window={window}
          onWindowChange={handleWindowChange}
          date={date}
          dayMode={dayMode}
          onDateChange={handleDateChange}
          onRefresh={handleRefresh}
          loading={loading}
          refreshing={refreshing}
          passRate={passRate}
          totals={totals}
          upcoming={upcoming}
          futureWindowLabel={futureWindowLabel}
          forecastUntilLabel={forecastUntilLabel}
        />
      </Paper>

      {loading && !metrics ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 10 }}>
          <CircularProgress sx={{ color: FIRSTSTEP.tealDark }} />
        </Box>
      ) : (
        <>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: {
                xs: 'repeat(2, minmax(0, 1fr))',
                md: 'repeat(3, minmax(0, 1fr))',
                xl: 'repeat(auto-fit, minmax(min(100%, 160px), 1fr))',
              },
              gap: 2,
              mb: 4,
            }}
          >
            <StatCard
              label="Runs"
              value={totals?.runs ?? '—'}
              hint={dayMode ? `${date} IST` : `Window ${window}`}
              color={METRIC_COLORS.runs}
              icon={<PlayCircleOutlineIcon />}
              delay={0}
            />
            <StatCard
              label="Passed"
              value={totals?.passed ?? '—'}
              hint={passRate != null ? `${passRate}% of runs` : undefined}
              color={METRIC_COLORS.passed}
              icon={<CheckCircleOutlineIcon />}
              delay={40}
            />
            <StatCard
              label="Failed"
              value={totals?.failed ?? '—'}
              hint="Open failure dashboard"
              color={METRIC_COLORS.failed}
              icon={<ErrorOutlineIcon />}
              delay={80}
              href={failedHref}
            />
            <StatCard
              label="Jobs added"
              value={totals?.jobsAddedToBoard ?? '—'}
              color={METRIC_COLORS.jobs}
              icon={<WorkOutlineIcon />}
              delay={120}
            />
            <StatCard
              label="Rows scraped"
              value={totals?.rowsExtracted ?? '—'}
              color={METRIC_COLORS.rows}
              icon={<TableChartOutlinedIcon />}
              delay={160}
            />
            <StatCard
              label="Active now"
              value={totals?.activeRunsNow ?? '—'}
              hint={`${totals?.automations ?? 0} automations`}
              color={METRIC_COLORS.active}
              icon={<BoltOutlinedIcon />}
              delay={200}
            />
          </Box>

          <SectionHeading title="Trends" caption="Per-bucket activity across the selected window." />
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: '1fr 1fr', xl: 'repeat(4, 1fr)' },
              gap: 2,
              mb: 5,
            }}
          >
            <MiniChart
              title="Total runs"
              valueLabel={String(totals?.runs ?? 0)}
              points={runSeriesPoints}
              color={METRIC_COLORS.runs}
              yAxisLabel="Run count"
              xAxisLabel="Time bucket"
              height={CHART_HEIGHT}
              delay={0}
            />
            <MiniChart
              title="Passed"
              valueLabel={String(totals?.passed ?? 0)}
              points={passSeriesPoints}
              color={METRIC_COLORS.passed}
              yAxisLabel="Passed runs"
              xAxisLabel="Time bucket"
              height={CHART_HEIGHT}
              delay={60}
            />
            <MiniChart
              title="Failed"
              valueLabel={String(totals?.failed ?? 0)}
              points={failSeriesPoints}
              color={METRIC_COLORS.failed}
              yAxisLabel="Failed runs"
              xAxisLabel="Time bucket"
              height={CHART_HEIGHT}
              delay={120}
            />
            <MiniChart
              title="Jobs added"
              valueLabel={String(totals?.jobsAddedToBoard ?? 0)}
              points={jobsSeriesPoints}
              color={METRIC_COLORS.jobs}
              yAxisLabel="Jobs added"
              xAxisLabel="Time bucket"
              height={CHART_HEIGHT}
              delay={180}
            />
          </Box>

          <SectionHeading
            title="ScoutX enrichment credits"
            caption="Company scrapers only (ATS-first + scraping algorithm). Hiring Cafe and n8n are excluded."
          />
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 140px), 1fr))',
              gap: 2,
              mb: 2,
            }}
          >
            <StatCard
              label="Credits today"
              value={enrichment ? String(creditsToday) : '—'}
              hint={
                creditBudgetPct != null
                  ? `${creditBudgetPct}% of daily budget (${creditBudget})`
                  : undefined
              }
              color={METRIC_COLORS.credits}
              icon={<BoltOutlinedIcon />}
              delay={0}
            />
            <StatCard
              label="Daily budget"
              value={enrichment ? String(creditBudget) : '—'}
              hint="Local ScoutX daily cap"
              color={METRIC_COLORS.jobs}
              icon={<LayersOutlinedIcon />}
              delay={40}
            />
            <StatCard
              label="Last 14 days"
              value={
                enrichment?.creditsSpentLast14Days != null
                  ? formatCompactNumber(enrichment.creditsSpentLast14Days)
                  : '—'
              }
              hint="Job board usage history"
              color={METRIC_COLORS.rows}
              icon={<TableChartOutlinedIcon />}
              delay={80}
            />
          </Box>

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', lg: '2fr 1fr' },
              gap: 2,
              mb: 5,
            }}
          >
            <MiniChart
              title="Credits spent (14 days)"
              valueLabel={String(creditsToday)}
              points={creditSeriesPoints}
              color={METRIC_COLORS.credits}
              yAxisLabel="Credits"
              xAxisLabel="Day (UTC)"
              height={CHART_HEIGHT}
              delay={0}
            />
            <Paper elevation={0} sx={[cardSx(), fadeUpSx(80), { p: 2.25 }]}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.25 }}>
                Enrichment mix (14 days)
              </Typography>
              {(enrichment?.methods14d || []).length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No enrichment activity in this window yet.
                </Typography>
              ) : (
                <Stack spacing={1.1}>
                  {(enrichment?.methods14d || []).map((row) => (
                    <Stack
                      key={row.method}
                      direction="row"
                      justifyContent="space-between"
                      alignItems="baseline"
                      spacing={1}
                    >
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {methodLabel(row.method)}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {row.jobs} jobs · {formatCompactNumber(row.credits)} cr
                      </Typography>
                    </Stack>
                  ))}
                </Stack>
              )}
            </Paper>
          </Box>

          <SectionHeading title="Workers & compute" caption="Live worker capacity and API process health." />
          <Paper elevation={0} sx={[cardSx(), fadeUpSx(0), { p: 2.5, mb: 2.5 }]}>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 150px), 1fr))',
                gap: 2.5,
              }}
            >
              <ComputeStat
                icon={<LayersOutlinedIcon />}
                label="Concurrency"
                value={String(compute?.scraperWorkerConcurrency ?? '—')}
              />
              <ComputeStat
                icon={<PublicOutlinedIcon />}
                label="Active browsers"
                value={String(compute?.activeBrowsers ?? '—')}
              />
              <ComputeStat
                icon={<DnsOutlinedIcon />}
                label="Embedded workers"
                value={compute?.runEmbeddedWorkers ? 'Yes' : 'No'}
              />
              <ComputeStat
                icon={<MemoryOutlinedIcon />}
                label="API RSS"
                value={formatBytes(compute?.memoryUsage?.rss)}
              />
              <ComputeStat
                icon={<TimerOutlinedIcon />}
                label="Uptime"
                value={formatUptime(compute?.uptimeSeconds)}
              />
            </Box>
          </Paper>

          {digitalOcean && !digitalOcean.configured && !digitalOcean.pending ? (
            <Alert severity="info" sx={{ mb: 3, borderRadius: RADIUS.control }}>
              DigitalOcean metrics not configured (set DIGITALOCEAN_TOKEN on the server).
            </Alert>
          ) : null}

          {digitalOceanQuery.isLoading && !m ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4, mb: 3 }}>
              <CircularProgress size={28} sx={{ color: FIRSTSTEP.tealDark }} />
            </Box>
          ) : null}

          {m ? (
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' },
                gap: 2,
                mb: 5,
              }}
            >
              <MiniChart
                title="CPU %"
                valueLabel={formatPct(m.cpuPercent?.latest)}
                points={withChartTime(m.cpuPercent?.points || [])}
                color={METRIC_COLORS.cpu}
                yAxisLabel="CPU %"
                xAxisLabel="Time"
                yMax={100}
                formatYTick={(value) => `${value}%`}
                height={CHART_HEIGHT}
                delay={0}
              />
              <MiniChart
                title="Memory %"
                valueLabel={formatPct(m.memoryUsedPercent?.latest)}
                points={withChartTime(m.memoryUsedPercent?.points || [])}
                color={METRIC_COLORS.memory}
                yAxisLabel="Memory %"
                xAxisLabel="Time"
                yMax={100}
                formatYTick={(value) => `${value}%`}
                height={CHART_HEIGHT}
                delay={60}
              />
              <MiniChart
                title="Load (1m)"
                valueLabel={
                  m.load1?.latest != null && Number.isFinite(m.load1.latest)
                    ? m.load1.latest.toFixed(2)
                    : '—'
                }
                points={withChartTime(m.load1?.points || [])}
                color={METRIC_COLORS.load}
                yAxisLabel="Load avg"
                xAxisLabel="Time"
                height={CHART_HEIGHT}
                delay={120}
              />
            </Box>
          ) : null}

          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            alignItems={{ xs: 'stretch', sm: 'flex-end' }}
            justifyContent="space-between"
            spacing={1.5}
            sx={{ mb: 1.75 }}
          >
            <Box sx={{ '& > :last-child': { mb: 0 } }}>
              <SectionHeading
                title="View by tags"
                caption={
                  selectedTags.length
                    ? `${visibleTags.length} of ${selectedTags.length} selected tags in this window.`
                    : 'Select filters to view data.'
                }
              />
            </Box>
            <Button
              variant="outlined"
              startIcon={<FilterListIcon />}
              onClick={() => setTagModalOpen(true)}
              sx={{ flexShrink: 0, borderColor: tint(FIRSTSTEP.teal, 0.5), color: FIRSTSTEP.navy }}
            >
              Filter
            </Button>
          </Stack>

          {selectedTags.length === 0 ? (
            <Paper
              elevation={0}
              sx={[
                cardSx(),
                {
                  p: 4,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  textAlign: 'center',
                  gap: 1.25,
                  '&:hover': { transform: 'none', boxShadow: 'none' },
                },
              ]}
            >
              <Box
                aria-hidden
                sx={{
                  width: 46,
                  height: 46,
                  display: 'grid',
                  placeItems: 'center',
                  borderRadius: '14px',
                  color: FIRSTSTEP.tealDark,
                  bgcolor: tint(FIRSTSTEP.teal, 0.12),
                }}
              >
                <LocalOfferOutlinedIcon />
              </Box>
              <Typography sx={{ fontWeight: 700, color: 'text.primary' }}>
                Select filters to view data
              </Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary', maxWidth: 420 }}>
                Choose up to 15 tags to see jobs added and runs for this window.
              </Typography>
              <Button variant="contained" startIcon={<FilterListIcon />} onClick={() => setTagModalOpen(true)}>
                Filter
              </Button>
            </Paper>
          ) : (
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: {
                  xs: 'repeat(auto-fill, minmax(min(100%, 140px), 1fr))',
                  sm: 'repeat(auto-fill, minmax(min(100%, 150px), 1fr))',
                  lg: 'repeat(auto-fill, minmax(min(100%, 160px), 1fr))',
                },
                gap: 1.5,
                pb: 1,
              }}
            >
              {visibleTags.map((tag) => (
                <TagPill
                  key={tag.tag}
                  label={tag.label}
                  jobsAdded={tag.jobsAdded}
                  runs={tag.runs}
                  active={tag.jobsAdded > 0}
                />
              ))}
            </Box>
          )}
        </>
      )}

      <TagFilterModal
        open={tagModalOpen}
        tags={catalogTags}
        selected={selectedTags}
        onClose={() => setTagModalOpen(false)}
        onApply={setSelectedTags}
      />
    </Box>
  );
};
