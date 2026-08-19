import React from 'react';
import {
  Box,
  Button,
  CircularProgress,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import DownloadIcon from '@mui/icons-material/Download';
import TuneIcon from '@mui/icons-material/Tune';
import { OpsHeroBackdrop } from '../../components/dashboard/ops/OpsHeroBackdrop';
import {
  FIRSTSTEP,
  fadeUpSx,
  heroGlassGhostButtonSx,
  heroGlassOverlineSx,
  heroGlassPanelSx,
  heroGlassPillSx,
  heroGlassPillTextSx,
  heroGlassSubtitleSx,
  heroGlassTitleSx,
} from '../../components/dashboard/ops/dashboardTokens';

export function ScrapersHero({
  scheduledCount,
  isRefreshing,
  isLoading,
  isReconfiguring = false,
  onRefresh,
  onDownloadSchedules,
  onReconfigure,
  canDownloadSchedules = false,
}: {
  scheduledCount: number;
  isRefreshing: boolean;
  isLoading: boolean;
  isReconfiguring?: boolean;
  onRefresh: () => void;
  onDownloadSchedules: () => void;
  onReconfigure: () => void;
  canDownloadSchedules?: boolean;
}) {
  const refreshBusy = isLoading || isRefreshing || isReconfiguring;
  const noun = scheduledCount === 1 ? 'scheduled fire' : 'scheduled fires';

  return (
    <Paper
      elevation={0}
      sx={[
        fadeUpSx(0),
        heroGlassPanelSx({ shadow: 'lifted' }),
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
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="overline" sx={heroGlassOverlineSx}>
            Scrapers
          </Typography>
          <Typography sx={heroGlassTitleSx('lg')}>24-hour schedule</Typography>
          <Typography variant="body2" sx={{ ...heroGlassSubtitleSx, maxWidth: 560 }}>
            Scheduled fires by hour in IST. Pick a day, then click an hour for the minute-by-minute list.
          </Typography>

          <Stack direction="row" alignItems="center" spacing={1} sx={heroGlassPillSx}>
            <Box
              aria-hidden
              sx={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                bgcolor: FIRSTSTEP.teal,
                boxShadow: '0 0 0 4px rgba(79, 179, 169, 0.18)',
              }}
            />
            <Typography variant="body2" sx={heroGlassPillTextSx}>
              {isLoading ? 'Loading schedule' : `${scheduledCount} ${noun}`}
            </Typography>
          </Stack>
        </Box>

        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Button
            variant="outlined"
            startIcon={<DownloadIcon />}
            onClick={onDownloadSchedules}
            disabled={!canDownloadSchedules || refreshBusy}
            sx={heroGlassGhostButtonSx}
          >
            Download scraper schedules
          </Button>
          <Button
            variant="outlined"
            startIcon={
              isReconfiguring ? <CircularProgress size={16} color="inherit" /> : <TuneIcon />
            }
            onClick={onReconfigure}
            disabled={refreshBusy}
            sx={heroGlassGhostButtonSx}
          >
            {isReconfiguring ? 'Reconfiguring…' : 'Reconfigure'}
          </Button>
          <Button
            variant="outlined"
            startIcon={
              isRefreshing ? <CircularProgress size={16} color="inherit" /> : <RefreshIcon />
            }
            onClick={onRefresh}
            disabled={refreshBusy}
            sx={heroGlassGhostButtonSx}
          >
            {isRefreshing ? 'Refreshing…' : 'Refresh'}
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );
}
