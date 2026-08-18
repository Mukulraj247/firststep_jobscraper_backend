import React from 'react';
import { Box, Paper, Stack, Typography } from '@mui/material';
import { FIRSTSTEP, RADIUS, tint } from './dashboardTokens';

export const TagPill = ({
  label,
  jobsAdded,
  runs,
  active,
}: {
  label: string;
  jobsAdded: number;
  runs: number;
  active: boolean;
}) => (
  <Paper
    elevation={0}
    sx={{
      px: 2,
      py: 1.5,
      minWidth: 0,
      borderRadius: RADIUS.card,
      border: '1px solid',
      borderColor: active ? tint(FIRSTSTEP.teal, 0.55) : 'divider',
      background: active
        ? `linear-gradient(135deg, ${tint(FIRSTSTEP.teal, 0.14)} 0%, ${tint(FIRSTSTEP.teal, 0.04)} 100%)`
        : undefined,
      bgcolor: active ? undefined : 'background.paper',
      transition: 'border-color 200ms ease, transform 200ms ease, box-shadow 200ms ease',
      '&:hover': {
        transform: 'translateY(-2px)',
        borderColor: FIRSTSTEP.tealDark,
        boxShadow: `0 10px 26px ${tint(FIRSTSTEP.navy, 0.1)}`,
      },
      '@media (prefers-reduced-motion: reduce)': {
        transition: 'none',
        '&:hover': { transform: 'none' },
      },
    }}
  >
    <Stack direction="row" alignItems="center" spacing={0.75} sx={{ minWidth: 0 }}>
      <Box
        aria-hidden
        sx={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          flexShrink: 0,
          bgcolor: active ? FIRSTSTEP.teal : 'divider',
        }}
      />
      <Typography
        variant="caption"
        noWrap
        title={label}
        sx={{ color: 'text.secondary', fontWeight: 700, letterSpacing: '0.04em' }}
      >
        {label}
      </Typography>
    </Stack>
    <Typography
      sx={{
        mt: 0.5,
        fontSize: '1.5rem',
        fontWeight: 700,
        lineHeight: 1.15,
        color: 'text.primary',
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {jobsAdded}
    </Typography>
    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
      {runs} run{runs === 1 ? '' : 's'}
    </Typography>
  </Paper>
);
