import React from 'react';
import { Box } from '@mui/material';
import { HERO_GRADIENT, MOTION_SAFE, RADIUS, STITCH } from '../tokens';

/**
 * FirstStep-style welcome hero: light wash, navy/teal ambient blobs.
 */
export function GlassHero({
  children,
  dense,
}: {
  children: React.ReactNode;
  dense?: boolean;
}) {
  return (
    <Box
      sx={{
        position: 'relative',
        overflow: 'hidden',
        borderRadius: { xs: 0, md: RADIUS.panel },
        background: HERO_GRADIENT,
        color: STITCH.onSurface,
        border: 'none',
        px: { xs: 1, md: dense ? 2 : 2 },
        py: { xs: 3.5, md: dense ? 4 : 6 },
        mb: { xs: 3, md: 4 },
        boxShadow: 'none',
        minHeight: { xs: 'auto', md: dense ? 180 : 220 },
      }}
    >
      <Box
        aria-hidden
        sx={{
          position: 'absolute',
          width: { xs: 200, md: 360 },
          height: { xs: 200, md: 360 },
          top: { xs: -80, md: -120 },
          right: { xs: -60, md: -80 },
          borderRadius: '50%',
          background: `linear-gradient(135deg, ${STITCH.primaryContainer}, ${STITCH.primaryDark})`,
          opacity: 0.22,
          filter: 'blur(72px)',
          pointerEvents: 'none',
          [MOTION_SAFE]: { animation: 'fsFloat 8s ease-in-out infinite' },
          '@keyframes fsFloat': {
            '0%, 100%': { transform: 'translateY(0)' },
            '50%': { transform: 'translateY(-18px)' },
          },
        }}
      />
      <Box
        aria-hidden
        sx={{
          position: 'absolute',
          width: { xs: 160, md: 280 },
          height: { xs: 160, md: 280 },
          bottom: { xs: -70, md: -90 },
          right: { xs: 40, md: 120 },
          borderRadius: '50%',
          background: `linear-gradient(135deg, ${STITCH.secondary}, ${STITCH.secondaryDark})`,
          opacity: 0.28,
          filter: 'blur(64px)',
          pointerEvents: 'none',
          [MOTION_SAFE]: { animation: 'fsFloat 8s ease-in-out infinite 2s' },
        }}
      />
      <Box
        aria-hidden
        sx={{
          position: 'absolute',
          width: 220,
          height: 220,
          top: 40,
          left: '28%',
          borderRadius: '50%',
          background: STITCH.primaryLight,
          opacity: 0.14,
          filter: 'blur(56px)',
          pointerEvents: 'none',
        }}
      />
      <Box sx={{ position: 'relative', zIndex: 1 }}>{children}</Box>
    </Box>
  );
}
