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
import {
  HERO_OVERLINE,
  HERO_REFRESH_VARIANT,
  HERO_SUBTITLE,
  HERO_TITLE,
  automationCountLabel,
} from './runsPageBehavior';
import { controlMinHeight } from '../failures/failuresPageBehavior';

export function RunsHero({
  automationCount,
  isRefreshing,
  isLoading,
  isMobile,
  onRefresh,
}: {
  automationCount: number;
  isRefreshing: boolean;
  isLoading: boolean;
  isMobile: boolean;
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
            {HERO_SUBTITLE}
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
              {automationCountLabel(automationCount)}
            </Typography>
          </Stack>
        </Box>

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
    </Paper>
  );
}
