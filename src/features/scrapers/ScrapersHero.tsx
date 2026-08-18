import React from 'react';
import {
  Box,
  Button,
  CircularProgress,
  InputAdornment,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import RefreshIcon from '@mui/icons-material/Refresh';
import SearchIcon from '@mui/icons-material/Search';
import { useTranslation } from 'react-i18next';
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
  heroGlassPrimaryButtonSx,
  heroGlassSubtitleSx,
  heroGlassTitleSx,
} from '../../components/dashboard/ops/dashboardTokens';
import { freshnessPillLabel } from './scrapersPageBehavior';

export function ScrapersHero({
  totalCount,
  dataUpdatedAt,
  nowMs,
  searchTerm,
  isRefreshing,
  isLoading,
  hasBackgroundUpdates,
  onSearchChange,
  onRefresh,
  onCreate,
}: {
  totalCount: number;
  dataUpdatedAt: number | null;
  nowMs: number;
  searchTerm: string;
  isRefreshing: boolean;
  isLoading: boolean;
  hasBackgroundUpdates: boolean;
  onSearchChange: (value: string) => void;
  onRefresh: () => void;
  onCreate: () => void;
}) {
  const { t } = useTranslation();
  const refreshBusy = isLoading || isRefreshing;

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
            {t('recordingtable.hero_overline', { defaultValue: 'Scraper operations' })}
          </Typography>
          <Typography sx={heroGlassTitleSx('lg')}>{t('recordingtable.heading')}</Typography>
          <Typography variant="body2" sx={{ ...heroGlassSubtitleSx, maxWidth: 520 }}>
            {t('recordingtable.heading_subtitle')}
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

        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1.25}
          alignItems={{ xs: 'stretch', sm: 'center' }}
          flexWrap="wrap"
          useFlexGap
          sx={{ width: { xs: '100%', md: 'auto' } }}
        >
          <TextField
            size="small"
            placeholder={t('recordingtable.search')}
            value={searchTerm}
            onChange={(event) => onSearchChange(event.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon sx={{ color: FIRSTSTEP.tealDark, fontSize: 20 }} />
                </InputAdornment>
              ),
            }}
            sx={[
              heroGlassFormControlSx(40),
              { width: { xs: '100%', sm: 240 }, flex: { sm: '1 1 220px' } },
            ]}
          />
          <Button
            variant="outlined"
            startIcon={
              refreshBusy ? <CircularProgress size={16} color="inherit" /> : <RefreshIcon />
            }
            onClick={onRefresh}
            disabled={refreshBusy}
            sx={heroGlassGhostButtonSx}
          >
            {isRefreshing
              ? t('recordingtable.refreshing', { defaultValue: 'Refreshing…' })
              : t('recordingtable.refresh', { defaultValue: 'Refresh' })}
          </Button>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={onCreate}
            sx={heroGlassPrimaryButtonSx}
          >
            {t('recordingtable.new')}
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );
}
