import React from 'react';
import { Box, Stack, Typography } from '@mui/material';
import { BODY_FONT, DISPLAY_FONT, RADIUS, SHADOW, STITCH, tint } from '../tokens';

type Props = {
  eyebrow?: string;
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  meta?: React.ReactNode;
};

/** Compact interior header — Stitch uses full glass heroes only on Home/Catalog. */
export function PageHeader({ eyebrow, title, subtitle, actions, meta }: Props) {
  return (
    <Box
      sx={{
        position: 'relative',
        overflow: 'hidden',
        borderRadius: RADIUS.panel,
        border: `1px solid ${STITCH.border}`,
        bgcolor: STITCH.surfaceLowest,
        boxShadow: SHADOW.sm,
        px: { xs: 2, md: 3 },
        py: { xs: 2, md: 2.5 },
        mb: { xs: 2, md: 3 },
        '&::before': {
          content: '""',
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          background: `radial-gradient(680px circle at 100% 0%, ${tint(STITCH.secondaryBright, 0.12)} 0%, transparent 58%)`,
        },
      }}
    >
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'stretch', md: 'flex-start' }}
        spacing={2}
        sx={{ position: 'relative' }}
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
                mb: 0.5,
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
              letterSpacing: '-0.02em',
              lineHeight: 1.15,
              color: STITCH.primaryContainer,
              fontSize: { xs: '1.5rem', md: '1.85rem' },
            }}
          >
            {title}
          </Typography>
          {subtitle && (
            <Typography sx={{ color: STITCH.muted, mt: 0.75, maxWidth: 620, fontSize: '0.875rem', fontFamily: BODY_FONT }}>
              {subtitle}
            </Typography>
          )}
          {meta && (
            <Stack direction="row" flexWrap="wrap" gap={0.75} sx={{ mt: 1.5 }}>
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
    </Box>
  );
}
