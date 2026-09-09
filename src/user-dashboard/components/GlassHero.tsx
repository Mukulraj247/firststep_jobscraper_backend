import React from 'react';
import { Box } from '@mui/material';
import { RADIUS, STITCH } from '../tokens';

/**
 * Stitch glass hero — dark navy→teal gradient with ambient mesh blooms.
 * Used on Home and Catalog; interior pages use PageHeader.
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
        borderRadius: RADIUS.panel,
        background: `linear-gradient(115deg, ${STITCH.primaryContainer} 0%, ${STITCH.tertiaryContainer} 52%, ${STITCH.secondary} 130%)`,
        color: STITCH.onPrimary,
        px: { xs: 2.5, md: dense ? 3 : 4 },
        py: { xs: 3, md: dense ? 3 : 4 },
        mb: { xs: 2, md: 3 },
        boxShadow: '0 12px 32px rgba(0, 29, 41, 0.18)',
        border: 'none',
      }}
    >
      <Box
        aria-hidden
        sx={{
          position: 'absolute',
          width: 288,
          height: 288,
          top: -96,
          left: -80,
          borderRadius: '50%',
          bgcolor: STITCH.secondaryFixed,
          opacity: 0.2,
          filter: 'blur(64px)',
          pointerEvents: 'none',
        }}
      />
      <Box
        aria-hidden
        sx={{
          position: 'absolute',
          width: 320,
          height: 320,
          bottom: -80,
          right: 40,
          borderRadius: '50%',
          bgcolor: STITCH.tertiaryFixedDim,
          opacity: 0.25,
          filter: 'blur(72px)',
          pointerEvents: 'none',
        }}
      />
      <Box
        aria-hidden
        sx={{
          position: 'absolute',
          width: 208,
          height: 208,
          top: '50%',
          left: '33%',
          transform: 'translateY(-50%)',
          borderRadius: '50%',
          bgcolor: STITCH.primaryFixed,
          opacity: 0.15,
          filter: 'blur(48px)',
          pointerEvents: 'none',
        }}
      />
      <Box sx={{ position: 'relative', zIndex: 1 }}>{children}</Box>
    </Box>
  );
}
