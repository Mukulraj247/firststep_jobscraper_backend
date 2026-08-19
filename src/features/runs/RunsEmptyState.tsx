import React from 'react';
import { Alert, Box, Button, Stack, Typography } from '@mui/material';
import PlayCircleOutlineIcon from '@mui/icons-material/PlayCircleOutline';
import { FIRSTSTEP, RADIUS } from '../../components/dashboard/ops/dashboardTokens';
import type { RunsContentState } from './runsPageBehavior';

export function RunsEmptyState({
  variant,
  onClearFilters,
  onRetry,
}: {
  variant: Extract<RunsContentState, 'account-empty' | 'filtered-empty' | 'load-error'>;
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
        Failed to load runs. Check your connection and try again.
      </Alert>
    );
  }

  if (variant === 'filtered-empty') {
    return (
      <Stack alignItems="center" spacing={1.5} sx={{ py: 6, px: 3, textAlign: 'center' }}>
        <Typography variant="h6" fontWeight={700}>
          No runs match these filters
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 420 }}>
          Try a different search, day, status, jobs count, or duration — or clear extra filters to see today.
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
          display: 'grid',
          placeItems: 'center',
          color: FIRSTSTEP.tealDark,
        }}
      >
        <PlayCircleOutlineIcon />
      </Box>
      <Typography variant="h6" fontWeight={700}>
        No runs on this day
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 420 }}>
        Nothing ran on this IST day yet. Pick another of the last 7 days, or wait for the next scheduled run.
      </Typography>
    </Stack>
  );
}
