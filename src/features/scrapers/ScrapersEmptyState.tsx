import React from 'react';
import { Alert, Box, Button, Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { FIRSTSTEP, RADIUS, heroGlassPrimaryButtonSx } from '../../components/dashboard/ops/dashboardTokens';
import type { ScrapersContentState } from './scrapersPageBehavior';

export function ScrapersEmptyState({
  variant,
  onCreate,
  onClearSearch,
  onRetry,
}: {
  variant: Extract<ScrapersContentState, 'account-empty' | 'filtered-empty' | 'load-error'>;
  onCreate?: () => void;
  onClearSearch?: () => void;
  onRetry?: () => void;
}) {
  const { t } = useTranslation();

  if (variant === 'load-error') {
    return (
      <Alert
        severity="error"
        sx={{ m: 2, borderRadius: RADIUS.control }}
        action={
          <Button color="inherit" size="small" onClick={onRetry}>
            Retry
          </Button>
        }
      >
        {t('recordingtable.load_error', {
          defaultValue: 'Failed to load scrapers. Check your connection and try again.',
        })}
      </Alert>
    );
  }

  if (variant === 'filtered-empty') {
    return (
      <Stack alignItems="center" spacing={1.5} sx={{ py: 6, px: 3, textAlign: 'center' }}>
        <Typography variant="h6" fontWeight={700}>
          {t('recordingtable.placeholder.search')}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 420 }}>
          {t('recordingtable.search_criteria')}
        </Typography>
        <Button
          variant="outlined"
          onClick={onClearSearch}
          sx={{ borderRadius: RADIUS.pill, fontWeight: 700, color: FIRSTSTEP.navy }}
        >
          Clear search
        </Button>
      </Stack>
    );
  }

  return (
    <Stack alignItems="center" spacing={1.5} sx={{ py: 6, px: 3, textAlign: 'center' }}>
      <Box
        aria-hidden
        sx={{
          width: 48,
          height: 48,
          borderRadius: '14px',
          bgcolor: 'rgba(79, 179, 169, 0.14)',
        }}
      />
      <Typography variant="h6" fontWeight={700}>
        {t('recordingtable.placeholder.title')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 420 }}>
        {t('recordingtable.placeholder.body')}
      </Typography>
      <Button variant="contained" onClick={onCreate} sx={heroGlassPrimaryButtonSx}>
        {t('recordingtable.new')}
      </Button>
    </Stack>
  );
}
