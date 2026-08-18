import React from 'react';
import { Alert, Box, Button, Stack, Typography } from '@mui/material';
import { FIRSTSTEP, RADIUS } from '../../components/dashboard/ops/dashboardTokens';
import type { AutomationsContentState } from './automationsPageBehavior';

export function AutomationEmptyState({
  variant,
  onNewAutomation,
  onClearFilters,
  onRetry,
}: {
  variant: Extract<AutomationsContentState, 'account-empty' | 'filtered-empty' | 'load-error'>;
  onNewAutomation?: () => void;
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
        Failed to load automations. Check your connection and try again.
      </Alert>
    );
  }

  if (variant === 'filtered-empty') {
    return (
      <Stack alignItems="center" spacing={1.5} sx={{ py: 6, px: 3, textAlign: 'center' }}>
        <Typography variant="h6" fontWeight={700}>
          No automations match these filters
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 420 }}>
          Try a different name, Scout ID, schedule, or tag — or clear filters to see everything.
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
        No automations yet
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 420 }}>
        Create your first scraper to schedule runs, extract rows, and watch latest-run health here.
      </Typography>
      <Button
        variant="contained"
        onClick={onNewAutomation}
        sx={{
          borderRadius: RADIUS.pill,
          fontWeight: 700,
          bgcolor: FIRSTSTEP.teal,
          color: FIRSTSTEP.navyDeep,
          '&:hover': { bgcolor: '#5fc4b9' },
        }}
      >
        New automation
      </Button>
    </Stack>
  );
}
