import React from 'react';
import {
  Box,
  Button,
  CircularProgress,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import PlayCircleOutlineIcon from '@mui/icons-material/PlayCircleOutline';
import ScheduleOutlinedIcon from '@mui/icons-material/ScheduleOutlined';
import BoltOutlinedIcon from '@mui/icons-material/BoltOutlined';
import type { OpsMetricsWindow } from '../../../api/automation';
import { dashboardDatePickerBounds } from '../../../features/dashboard/dashboardPageBehavior';
import { formatIstYmd } from '../../../shared/opsTimezone';
import {
  FIRSTSTEP,
  heroGlassFormControlSx,
  heroGlassOverlineSx,
  heroGlassPrimaryButtonSx,
  heroGlassSubtitleSx,
  heroGlassTitleSx,
  METRIC_COLORS,
  RADIUS,
  tint,
} from './dashboardTokens';

const WINDOWS: OpsMetricsWindow[] = ['15m', '30m', '1h', '3h', '6h', '24h'];

const heroMetricShellSx = (accent: string) => ({
  p: { xs: 1.75, md: 2 },
  borderRadius: RADIUS.control,
  bgcolor: 'rgba(255, 255, 255, 0.58)',
  border: `1px solid ${tint(accent, 0.22)}`,
  backdropFilter: 'blur(14px)',
  WebkitBackdropFilter: 'blur(14px)',
  boxShadow: `inset 0 1px 0 rgba(255, 255, 255, 0.9), 0 4px 16px ${tint(accent, 0.08)}`,
  height: '100%',
  minWidth: 0,
});

function HeroMetricTile({
  label,
  value,
  hint,
  accent,
  icon,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  accent: string;
  icon: React.ReactNode;
}) {
  return (
    <Box sx={heroMetricShellSx(accent)}>
      <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={1}>
        <Typography
          variant="overline"
          sx={{
            ...heroGlassOverlineSx,
            letterSpacing: '0.14em',
            fontSize: '0.64rem',
            color: tint(accent, 0.95),
          }}
        >
          {label}
        </Typography>
        <Box
          aria-hidden
          sx={{
            flexShrink: 0,
            width: 32,
            height: 32,
            display: 'grid',
            placeItems: 'center',
            borderRadius: '10px',
            color: accent,
            bgcolor: tint(accent, 0.12),
            '& svg': { fontSize: 18 },
          }}
        >
          {icon}
        </Box>
      </Stack>
      <Typography
        sx={{
          mt: 1,
          fontSize: { xs: '1.75rem', md: '2rem' },
          fontWeight: 800,
          lineHeight: 1.05,
          letterSpacing: '-0.03em',
          color: FIRSTSTEP.navyDeep,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </Typography>
      {hint ? (
        <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5, lineHeight: 1.45 }}>
          {hint}
        </Typography>
      ) : null}
    </Box>
  );
}

export function DashboardHeroSection({
  window,
  onWindowChange,
  date,
  dayMode,
  onDateChange,
  onRefresh,
  loading,
  refreshing,
  passRate,
  totals,
  upcoming,
  futureWindowLabel,
  forecastUntilLabel,
}: {
  window: OpsMetricsWindow;
  onWindowChange: (window: OpsMetricsWindow) => void;
  date: string;
  dayMode: boolean;
  onDateChange: (date: string) => void;
  onRefresh: () => void;
  loading: boolean;
  refreshing: boolean;
  passRate: number | null;
  totals: {
    runs?: number;
    activeRunsNow?: number;
  } | undefined;
  upcoming: {
    totalScheduledRuns: number;
    automationsWithRuns: number;
    activeScheduledAutomations: number;
  } | null | undefined;
  futureWindowLabel: string;
  forecastUntilLabel: string | null;
}) {
  const bounds = dashboardDatePickerBounds();
  const todayYmd = formatIstYmd(Date.now());
  const upcomingRuns = upcoming?.totalScheduledRuns ?? 0;
  const upcomingAutomations = upcoming?.automationsWithRuns ?? 0;
  const runsMatchAutomations =
    upcomingRuns > 0 && upcomingRuns === upcomingAutomations;

  const upcomingHint =
    upcomingRuns > 0
      ? runsMatchAutomations
        ? `Every scheduled automation fires once in the next ${futureWindowLabel}.`
        : `${upcomingAutomations} automation${upcomingAutomations === 1 ? '' : 's'} · next ${futureWindowLabel}`
      : upcoming && upcoming.activeScheduledAutomations > 0
        ? `${upcoming.activeScheduledAutomations} on schedule, none in this window`
        : 'No active schedules';

  return (
    <Stack spacing={2.5} sx={{ position: 'relative', zIndex: 1 }}>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'stretch', md: 'flex-start' }}
        spacing={2}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="overline" sx={heroGlassOverlineSx}>
            Ops overview
          </Typography>
          <Typography sx={heroGlassTitleSx('lg')}>Dashboard</Typography>
          <Typography variant="body2" sx={{ ...heroGlassSubtitleSx, maxWidth: 480 }}>
            {dayMode
              ? `Activity for ${date} (IST, 12:00 AM–11:59 PM).`
              : `Past activity and upcoming schedule share the same ${window} range.`}
          </Typography>
        </Box>

        <Stack
          direction="row"
          spacing={1.25}
          alignItems="center"
          flexWrap="wrap"
          useFlexGap
          sx={{ flexShrink: 0, alignSelf: { md: 'flex-start' } }}
        >
          {!dayMode ? (
            <FormControl size="small" sx={heroGlassFormControlSx()}>
              <InputLabel id="ops-window-label">Time range</InputLabel>
              <Select
                labelId="ops-window-label"
                label="Time range"
                value={window}
                onChange={(e) => onWindowChange(e.target.value as OpsMetricsWindow)}
              >
                {WINDOWS.map((w) => (
                  <MenuItem key={w} value={w}>
                    {w} · last & next
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          ) : null}
          <TextField
            size="small"
            type="date"
            label="Day (IST)"
            InputLabelProps={{ shrink: true }}
            value={date}
            inputProps={{ min: bounds.min, max: bounds.max }}
            onChange={(event) => onDateChange(event.target.value)}
            sx={heroGlassFormControlSx()}
          />
          {dayMode ? (
            <Button
              variant="outlined"
              onClick={() => onDateChange(todayYmd)}
              sx={{
                ...heroGlassFormControlSx(),
                textTransform: 'none',
                fontWeight: 700,
                borderColor: tint(FIRSTSTEP.teal, 0.45),
                color: FIRSTSTEP.tealDeep,
              }}
            >
              Today
            </Button>
          ) : null}
          <Button
            variant="contained"
            startIcon={
              refreshing ? <CircularProgress size={16} color="inherit" /> : <RefreshIcon />
            }
            onClick={onRefresh}
            disabled={loading || refreshing}
            sx={heroGlassPrimaryButtonSx}
          >
            Refresh
          </Button>
        </Stack>
      </Stack>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 0.95fr) minmax(0, 1.05fr)' },
          gap: 2,
          alignItems: 'stretch',
        }}
      >
        <Stack spacing={2} direction={{ xs: 'column', sm: 'row', md: 'column' }}>
          <HeroMetricTile
            label={dayMode ? date : `Last ${window}`}
            value={totals?.runs ?? '—'}
            hint={
              passRate != null
                ? `${passRate}% pass rate · completed runs`
                : totals?.runs
                  ? 'Completed in this window'
                  : 'No runs in this window'
            }
            accent={METRIC_COLORS.runs}
            icon={<PlayCircleOutlineIcon />}
          />
          <HeroMetricTile
            label="Live"
            value={totals?.activeRunsNow ?? 0}
            hint={
              upcoming && upcoming.activeScheduledAutomations > 0
                ? `${upcoming.activeScheduledAutomations} automation${
                    upcoming.activeScheduledAutomations === 1 ? '' : 's'
                  } on schedule`
                : 'Currently executing'
            }
            accent={METRIC_COLORS.active}
            icon={<BoltOutlinedIcon />}
          />
        </Stack>

        <Box
          sx={{
            ...heroMetricShellSx(FIRSTSTEP.teal),
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            p: { xs: 2, md: 2.5 },
            background: `
              linear-gradient(135deg, rgba(255, 255, 255, 0.72) 0%, rgba(232, 248, 246, 0.55) 100%),
              ${tint(FIRSTSTEP.teal, 0.06)}
            `,
            borderColor: tint(FIRSTSTEP.teal, 0.32),
          }}
        >
          <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
            <Stack direction="row" alignItems="center" spacing={1}>
              <ScheduleOutlinedIcon sx={{ fontSize: 20, color: FIRSTSTEP.tealDark }} />
              <Typography
                variant="overline"
                sx={{
                  ...heroGlassOverlineSx,
                  letterSpacing: '0.14em',
                  fontSize: '0.64rem',
                  color: FIRSTSTEP.tealDeep,
                }}
              >
                Next {dayMode ? '24h' : window}
              </Typography>
            </Stack>
            {forecastUntilLabel ? (
              <Typography
                variant="caption"
                sx={{
                  color: 'text.secondary',
                  fontWeight: 600,
                  whiteSpace: 'normal',
                }}
              >
                until {forecastUntilLabel}
              </Typography>
            ) : null}
          </Stack>

          <Stack
            direction="row"
            alignItems="baseline"
            spacing={1.25}
            flexWrap="wrap"
            useFlexGap
            sx={{ mt: 1.25 }}
          >
            <Typography
              sx={{
                fontSize: { xs: '2.5rem', md: '3rem' },
                fontWeight: 800,
                lineHeight: 1,
                color: FIRSTSTEP.navyDeep,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {upcoming != null ? upcomingRuns : '—'}
            </Typography>
            <Typography
              sx={{
                fontWeight: 700,
                color: FIRSTSTEP.navy,
                fontSize: { xs: '1rem', md: '1.15rem' },
              }}
            >
              {upcomingRuns === 1 ? 'run scheduled' : 'runs scheduled'}
            </Typography>
          </Stack>

          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 1, maxWidth: 420, lineHeight: 1.5 }}>
            {upcoming != null ? upcomingHint : 'Loading forecast…'}
          </Typography>
        </Box>
      </Box>
    </Stack>
  );
}
