import React from 'react';
import {
  Box,
  Button,
  CircularProgress,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Typography,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import type { FailureTimeWindow } from './failuresPageBehavior';
import { OpsHeroBackdrop } from '../../components/dashboard/ops/OpsHeroBackdrop';
import {
  FIRSTSTEP,
  fadeUpSx,
  heroGlassFormControlSx,
  heroGlassGhostButtonSx,
  heroGlassOverlineSx,
  heroGlassPanelSx,
  heroGlassPillSx,
  heroGlassPillTextSx,
  heroGlassSubtitleSx,
  heroGlassTitleSx,
} from '../../components/dashboard/ops/dashboardTokens';
import {
  FAILURE_WINDOWS,
  FILTER_CONTROL_IDS,
  FILTER_LABEL_IDS,
  HERO_OVERLINE,
  HERO_REFRESH_VARIANT,
  HERO_TITLE,
  controlMinHeight,
  failureWindowSelectLabel,
  windowStatusPillLabel,
} from './failuresPageBehavior';

export function FailuresHero({
  failureCount,
  window,
  isRefreshing,
  isLoading,
  isMobile,
  onWindowChange,
  onRefresh,
}: {
  failureCount: number;
  window: FailureTimeWindow;
  isRefreshing: boolean;
  isLoading: boolean;
  isMobile: boolean;
  onWindowChange: (window: FailureTimeWindow) => void;
  onRefresh: () => void;
}) {
  const refreshBusy = isLoading || isRefreshing;
  const minHeight = controlMinHeight(isMobile);

  return (
    <Paper
      elevation={0}
      sx={[
        fadeUpSx(0),
        heroGlassPanelSx({ mb: 3, shadow: 'lifted' }),
        { p: { xs: 2.5, md: 3.5 } },
      ]}
    >
      <OpsHeroBackdrop />

      <Stack
        direction={{ xs: 'column', md: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'flex-start', md: 'flex-end' }}
        spacing={2.5}
        sx={{ position: 'relative', zIndex: 1 }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="overline" sx={heroGlassOverlineSx}>
            {HERO_OVERLINE}
          </Typography>
          <Typography sx={heroGlassTitleSx('lg')}>{HERO_TITLE}</Typography>
          <Typography variant="body2" sx={{ ...heroGlassSubtitleSx, maxWidth: 560 }}>
            Failed and dead-letter runs — reasons, anomalies, and a guarded retry into a new run.
          </Typography>

          <Stack direction="row" alignItems="center" spacing={1} sx={heroGlassPillSx}>
            <Box
              aria-hidden
              sx={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                bgcolor: FIRSTSTEP.teal,
                boxShadow: `0 0 0 4px rgba(79, 179, 169, 0.18)`,
              }}
            />
            <Typography variant="body2" sx={heroGlassPillTextSx}>
              {windowStatusPillLabel(failureCount, window)}
            </Typography>
          </Stack>
        </Box>

        <Stack direction="row" spacing={1.25} alignItems="center" flexWrap="wrap" useFlexGap>
          <FormControl size="small" sx={heroGlassFormControlSx(minHeight)}>
            <InputLabel id={FILTER_LABEL_IDS.window}>Window</InputLabel>
            <Select
              id={FILTER_CONTROL_IDS.window}
              labelId={FILTER_LABEL_IDS.window}
              label="Window"
              value={window}
              onChange={(event) => onWindowChange(event.target.value as FailureTimeWindow)}
            >
              {FAILURE_WINDOWS.map((item) => (
                <MenuItem key={item} value={item}>
                  {failureWindowSelectLabel(item)}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Button
            variant={HERO_REFRESH_VARIANT}
            startIcon={
              refreshBusy ? <CircularProgress size={16} color="inherit" /> : <RefreshIcon />
            }
            onClick={onRefresh}
            disabled={refreshBusy}
            sx={{ ...heroGlassGhostButtonSx, minHeight }}
          >
            {isRefreshing ? 'Refreshing…' : 'Refresh'}
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );
}
