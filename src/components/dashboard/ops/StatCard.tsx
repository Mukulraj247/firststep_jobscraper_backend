import React from 'react';
import { Box, Paper, Stack, Typography } from '@mui/material';
import { cardSx, fadeUpSx, FIRSTSTEP, tint } from './dashboardTokens';

export const StatCard = ({
  label,
  value,
  hint,
  color = FIRSTSTEP.tealDark,
  icon,
  delay = 0,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  color?: string;
  icon?: React.ReactNode;
  delay?: number;
}) => (
  <Paper
    elevation={0}
    sx={[cardSx(color), fadeUpSx(delay), { p: 2.25, pt: 2.5, height: '100%', minWidth: 0 }]}
  >
    <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={1}>
      <Typography
        variant="overline"
        sx={{
          color: 'text.secondary',
          fontWeight: 700,
          fontSize: '0.68rem',
          letterSpacing: '0.12em',
          lineHeight: 1.4,
        }}
      >
        {label}
      </Typography>
      {icon ? (
        <Box
          aria-hidden
          sx={{
            flexShrink: 0,
            width: 34,
            height: 34,
            display: 'grid',
            placeItems: 'center',
            borderRadius: '10px',
            color,
            bgcolor: tint(color, 0.12),
            '& svg': { fontSize: 19 },
          }}
        >
          {icon}
        </Box>
      ) : null}
    </Stack>

    <Typography
      sx={{
        mt: 0.75,
        fontSize: { xs: '1.9rem', md: '2.15rem' },
        fontWeight: 700,
        lineHeight: 1.1,
        letterSpacing: '-0.02em',
        color: 'text.primary',
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {value}
    </Typography>

    {hint ? (
      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.5 }}>
        {hint}
      </Typography>
    ) : null}
  </Paper>
);
