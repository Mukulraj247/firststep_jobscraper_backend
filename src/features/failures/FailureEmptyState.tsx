import React from 'react';
import { Alert, Box, Button, Stack, Typography } from '@mui/material';
import { FIRSTSTEP, RADIUS } from '../../components/dashboard/ops/dashboardTokens';
import type { FailuresContentState } from './failuresPageBehavior';

export function FailureEmptyState({
  variant,
  onClearFilters,
  onRetry,
}: {
  variant: Extract<FailuresContentState, 'account-empty' | 'filtered-empty' | 'load-error'>;
  onClearFilters?: () => void;
  onRetry?: () => void;
}) {
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
        Failed to load failed runs. Check your connection and try again.
      </Alert>
    );
  }

  if (variant === 'filtered-empty') {
    return (
      <Stack alignItems="center" spacing={1.5} sx={{ py: 6, px: 3, textAlign: 'center' }}>
        <Typography variant="h6" fontWeight={700}>
          No failed runs match these filters
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 420 }}>
          Try a different search, status, reason, or anomaly — or clear filters to see everything in this window.
        </Typography>
        <Button
          variant="outlined"
          onClick={onClearFilters}
          sx={{ borderRadius: RADIUS.pill, fontWeight: 700, color: FIRSTSTEP.navy }}
        >
          Clear all filters
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
        No failed runs in this window
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 420 }}>
        Terminal failures for the selected window will show up here with reasons, anomalies, and retry.
      </Typography>
    </Stack>
  );
}
