import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
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
import LocalOfferOutlinedIcon from '@mui/icons-material/LocalOfferOutlined';
import {
  getDashboardMetrics,
  type OpsMetricsResponse,
  type OpsMetricsWindow,
} from '../api/automation';
import { useGlobalInfoStore } from '../context/globalInfo';
import { MiniChart } from '../components/dashboard/ops/MiniChart';
import { DashboardHeroSection } from '../components/dashboard/ops/DashboardHeroSection';
import { OpsHeroBackdrop } from '../components/dashboard/ops/OpsHeroBackdrop';
import { StatCard } from '../components/dashboard/ops/StatCard';
import { TagPill } from '../components/dashboard/ops/TagPill';
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
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
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

const formatUptime = (seconds?: number | null) => {
  if (seconds == null || !Number.isFinite(seconds)) return '—';
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
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
  const { notify } = useGlobalInfoStore();
  const [window, setWindow] = useState<OpsMetricsWindow>('6h');
  const [metrics, setMetrics] = useState<OpsMetricsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    async (silent = false) => {
      if (silent) setRefreshing(true);
      else setLoading(true);
      try {
        const data = await getDashboardMetrics(window);
        setMetrics(data);
      } catch (error: any) {
        if (error?.response?.status !== 429) {
          notify('error', error?.response?.data?.error || 'Failed to load dashboard metrics');
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [window, notify]
  );

  useEffect(() => {
    load();
  }, [load]);

  const totals = metrics?.totals;
  const compute = metrics?.compute;
  const droplet = metrics?.digitalOcean?.droplets?.[0];
  const m = droplet?.metrics;

  const runSeriesPoints = (metrics?.series.runs || []).map((b) => ({ t: b.t, v: b.total }));
  const passSeriesPoints = (metrics?.series.runs || []).map((b) => ({ t: b.t, v: b.passed }));
  const failSeriesPoints = (metrics?.series.runs || []).map((b) => ({ t: b.t, v: b.failed }));
  const jobsSeriesPoints = (metrics?.series.jobsAdded || []).map((b) => ({ t: b.t, v: b.jobsAdded }));

  const passRate =
    totals && totals.runs > 0 ? Math.round((totals.passed / totals.runs) * 100) : null;

  const upcoming = metrics?.upcomingSchedules;
  const forecastUntilLabel = formatForecastUntil(upcoming?.forecastUntil);
  const futureWindowLabel = WINDOW_FUTURE_LABEL[window];

  const roleTags = useMemo(() => {
    return [...(metrics?.tags ?? [])]
      .filter((tag) => (tag.namespace || tag.tag.split(':')[0]) === 'role')
      .sort(
        (a, b) =>
          b.jobsAdded - a.jobsAdded ||
          b.runs - a.runs ||
          a.label.localeCompare(b.label),
      );
  }, [metrics?.tags]);

  const totalRoleTags = roleTags.length;
  const activeRoleTags = roleTags.filter((tag) => tag.jobsAdded > 0).length;

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
          onWindowChange={setWindow}
          onRefresh={() => load(true)}
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
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: 2,
              mb: 4,
            }}
          >
            <StatCard
              label="Runs"
              value={totals?.runs ?? '—'}
              hint={`Window ${window}`}
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
              color={METRIC_COLORS.failed}
              icon={<ErrorOutlineIcon />}
              delay={80}
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

          <SectionHeading title="Workers & compute" caption="Live worker capacity and API process health." />
          <Paper elevation={0} sx={[cardSx(), fadeUpSx(0), { p: 2.5, mb: 2.5 }]}>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
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

          {metrics?.digitalOcean && !metrics.digitalOcean.configured ? (
            <Alert severity="info" sx={{ mb: 3, borderRadius: RADIUS.control }}>
              DigitalOcean metrics not configured (set DIGITALOCEAN_TOKEN on the server).
            </Alert>
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
                points={m.cpuPercent?.points || []}
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
                points={m.memoryUsedPercent?.points || []}
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
                points={m.load1?.points || []}
                color={METRIC_COLORS.load}
                yAxisLabel="Load avg"
                xAxisLabel="Time"
                height={CHART_HEIGHT}
                delay={120}
              />
            </Box>
          ) : null}

          <SectionHeading
            title="Jobs by tag"
            caption={`Job title / role tags (${totalRoleTags} total · ${activeRoleTags} with jobs in this window).`}
          />

          {activeRoleTags === 0 ? (
            <Alert severity="info" sx={{ mb: 2.5, borderRadius: RADIUS.control }}>
              No jobs were added in this window yet. Role tags with zero activity are still listed below.
            </Alert>
          ) : null}

          {roleTags.length === 0 ? (
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
                  gap: 1,
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
                No jobs added in this window
              </Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary', maxWidth: 420 }}>
                Widen the time window or check that your automations are running to see tag activity
                here.
              </Typography>
            </Paper>
          ) : (
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: {
                  xs: 'repeat(auto-fill, minmax(150px, 1fr))',
                  sm: 'repeat(auto-fill, minmax(168px, 1fr))',
                  lg: 'repeat(auto-fill, minmax(180px, 1fr))',
                },
                gap: 1.5,
                pb: 1,
              }}
            >
              {roleTags.map((tag) => (
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
    </Box>
  );
};
