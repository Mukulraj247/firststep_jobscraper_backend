import React from 'react';
import { Button, Box, CircularProgress, Paper, Stack, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import PauseCircleOutlineIcon from '@mui/icons-material/PauseCircleOutline';
import PlayCircleOutlineIcon from '@mui/icons-material/PlayCircleOutline';
import RefreshIcon from '@mui/icons-material/Refresh';
import { OpsHeroBackdrop } from '../../components/dashboard/ops/OpsHeroBackdrop';
import {
  FIRSTSTEP,
  fadeUpSx,
  heroGlassGhostButtonSx,
  heroGlassOverlineSx,
  heroGlassPanelSx,
  heroGlassPillSx,
  heroGlassPillTextSx,
  heroGlassPrimaryButtonSx,
  heroGlassSubtitleSx,
  heroGlassTitleSx,
} from '../../components/dashboard/ops/dashboardTokens';
import { freshnessPillLabel } from './automationsPageBehavior';

export function AutomationsHero({
  totalCount,
  dataUpdatedAt,
  nowMs,
  isRefreshing,
  isLoading,
  hasBackgroundUpdates,
  activeScheduledCount,
  pausedScheduleCount,
  onRefresh,
  onPauseAll,
  onResumeAll,
  onNewAutomation,
}: {
  totalCount: number;
  dataUpdatedAt: number | null;
  nowMs: number;
  isRefreshing: boolean;
  isLoading: boolean;
  hasBackgroundUpdates: boolean;
  activeScheduledCount: number;
  pausedScheduleCount: number;
  onRefresh: () => void;
  onPauseAll: () => void;
  onResumeAll: () => void;
  onNewAutomation: () => void;
}) {
  const refreshBusy = isLoading || isRefreshing;

  return (
    <Paper
      elevation={0}
      sx={[
        fadeUpSx(0),
        heroGlassPanelSx({ shadow: 'soft' }),
        { p: { xs: 2, md: 2.25 } },
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
            Automation operations
          </Typography>
          <Typography sx={heroGlassTitleSx('md')}>Automations</Typography>
          <Typography variant="body2" sx={{ ...heroGlassSubtitleSx, maxWidth: 520 }}>
            Schedule, run, and inspect every scraper you operate.
          </Typography>

          <Stack direction="row" alignItems="center" spacing={1} sx={heroGlassPillSx}>
            <Box
              aria-hidden
              sx={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                bgcolor: hasBackgroundUpdates ? FIRSTSTEP.warning : FIRSTSTEP.teal,
                boxShadow: hasBackgroundUpdates
                  ? '0 0 0 4px rgba(245, 158, 11, 0.18)'
                  : '0 0 0 4px rgba(79, 179, 169, 0.18)',
              }}
            />
            <Typography variant="body2" sx={heroGlassPillTextSx}>
              {hasBackgroundUpdates
                ? `${freshnessPillLabel(totalCount, dataUpdatedAt, nowMs)} · updates available`
                : freshnessPillLabel(totalCount, dataUpdatedAt, nowMs)}
            </Typography>
          </Stack>
        </Box>

        <Stack direction="row" spacing={1.25} alignItems="center" flexWrap="wrap" useFlexGap>
          <Button
            variant="outlined"
            startIcon={
              refreshBusy ? <CircularProgress size={16} color="inherit" /> : <RefreshIcon />
            }
            onClick={onRefresh}
            disabled={refreshBusy}
            sx={heroGlassGhostButtonSx}
          >
            {isRefreshing ? 'Refreshing…' : 'Refresh'}
          </Button>
          {activeScheduledCount > 0 ? (
            <Button
              variant="outlined"
              startIcon={<PauseCircleOutlineIcon />}
              onClick={onPauseAll}
              sx={heroGlassGhostButtonSx}
            >
              Pause all
            </Button>
          ) : null}
          {pausedScheduleCount > 0 ? (
            <Button
              variant="outlined"
              startIcon={<PlayCircleOutlineIcon />}
              onClick={onResumeAll}
              sx={heroGlassGhostButtonSx}
            >
              Resume all
            </Button>
          ) : null}
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={onNewAutomation}
            sx={heroGlassPrimaryButtonSx}
          >
            New automation
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );
}
