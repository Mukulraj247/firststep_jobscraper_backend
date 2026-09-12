import React from 'react';
import { Box, Stack, Typography } from '@mui/material';
import type { SvgIconComponent } from '@mui/icons-material';
import { Link } from 'react-router-dom';
import {
  BODY_FONT,
  DISPLAY_FONT,
  EASE,
  RADIUS,
  SHADOW,
  STITCH,
  featuredPanelSx,
  type AccentKey,
} from '../tokens';

type Props = {
  label: string;
  value: string | number;
  icon: SvgIconComponent;
  accent?: AccentKey;
  hint?: React.ReactNode;
  to?: string;
};

export function StatCard({ label, value, icon: Icon, accent = 'teal', hint, to }: Props) {
  const clickable = Boolean(to);
  const iconWell =
    accent === 'teal'
      ? { bgcolor: STITCH.secondaryContainer, color: STITCH.onSecondaryContainer }
      : accent === 'amber'
        ? { bgcolor: STITCH.surfaceHighest, color: STITCH.onSurfaceVariant }
        : { bgcolor: STITCH.surfaceHigh, color: STITCH.primary };

  return (
    <Box
      {...(clickable ? { component: Link, to } : {})}
      sx={{
        ...featuredPanelSx,
        display: 'block',
        height: '100%',
        p: 2,
        textDecoration: 'none',
        position: 'relative',
        overflow: 'hidden',
        transition: `box-shadow 200ms ${EASE}`,
        ...(clickable && {
          '&:hover': { boxShadow: SHADOW.sm },
        }),
      }}
    >
      <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={1}>
        <Box sx={{ minWidth: 0 }}>
          <Typography
            sx={{
              fontSize: '0.68rem',
              fontWeight: 600,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: STITCH.onSurfaceVariant,
              fontFamily: BODY_FONT,
            }}
          >
            {label}
          </Typography>
          <Typography
            sx={{
              mt: 0.5,
              fontFamily: DISPLAY_FONT,
              fontWeight: 600,
              letterSpacing: '-0.02em',
              fontSize: { xs: '1.5rem', md: '2rem' },
              lineHeight: 1.15,
              color: STITCH.onSurface,
            }}
          >
            {value}
          </Typography>
        </Box>
        <Box
          aria-hidden
          sx={{
            width: 40,
            height: 40,
            flexShrink: 0,
            borderRadius: RADIUS.control,
            display: 'grid',
            placeItems: 'center',
            ...iconWell,
          }}
        >
          <Icon sx={{ fontSize: 22 }} />
        </Box>
      </Stack>
      {hint && (
        <Box sx={{ mt: 1.5, color: STITCH.onSurfaceVariant, fontSize: '0.8125rem', fontFamily: BODY_FONT }}>
          {hint}
        </Box>
      )}
    </Box>
  );
}
