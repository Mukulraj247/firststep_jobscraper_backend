import React from 'react';
import { Box, Stack, Typography } from '@mui/material';
import { BODY_FONT, DISPLAY_FONT, STITCH } from '../tokens';

type Props = {
  eyebrow?: string;
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  meta?: React.ReactNode;
};

/** Compact page title — matches First Step interior headers (no boxed hero). */
export function PageHeader({ eyebrow, title, subtitle, actions, meta }: Props) {
  return (
    <Stack
      direction={{ xs: 'column', md: 'row' }}
      justifyContent="space-between"
      alignItems={{ xs: 'stretch', md: 'flex-end' }}
      spacing={1.5}
      sx={{ mb: 2 }}
    >
      <Box sx={{ minWidth: 0 }}>
        {eyebrow && (
          <Typography
            sx={{
              display: 'block',
              color: STITCH.secondaryDark,
              fontWeight: 700,
              letterSpacing: '0.14em',
              fontSize: '0.66rem',
              textTransform: 'uppercase',
              fontFamily: BODY_FONT,
              mb: 0.4,
            }}
          >
            {eyebrow}
          </Typography>
        )}
        <Typography
          component="h1"
          sx={{
            fontFamily: DISPLAY_FONT,
            fontWeight: 700,
            letterSpacing: '-0.03em',
            lineHeight: 1.15,
            color: STITCH.primaryContainer,
            fontSize: { xs: '1.35rem', md: '1.6rem' },
          }}
        >
          {title}
        </Typography>
        {subtitle && (
          <Typography sx={{ color: STITCH.muted, mt: 0.4, maxWidth: 720, fontSize: '0.875rem', fontFamily: BODY_FONT }}>
            {subtitle}
          </Typography>
        )}
        {meta && (
          <Stack direction="row" flexWrap="wrap" gap={0.75} sx={{ mt: 1 }}>
            {meta}
          </Stack>
        )}
      </Box>
      {actions && (
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ flexShrink: 0, alignItems: 'center' }}>
          {actions}
        </Stack>
      )}
    </Stack>
  );
}
