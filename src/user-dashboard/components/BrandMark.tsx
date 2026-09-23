import React from 'react';
import { Box, Stack, Typography } from '@mui/material';
import { DISPLAY_FONT, STITCH } from '../tokens';

type Props = {
  compact?: boolean;
  size?: number;
  inverted?: boolean;
};

/** ScoutX wordmark — portal brand. */
export function BrandMark({ compact = false, size = 32, inverted = false }: Props) {
  return (
    <Stack direction="row" alignItems="center" spacing={1} sx={{ minWidth: 0 }}>
      <Box
        aria-hidden
        sx={{
          width: size,
          height: size,
          flexShrink: 0,
          borderRadius: '8px',
          bgcolor: inverted ? 'rgba(255,255,255,0.14)' : STITCH.primaryContainer,
          display: 'grid',
          placeItems: 'center',
          position: 'relative',
        }}
      >
        <Box
          sx={{
            width: size * 0.34,
            height: size * 0.34,
            borderRadius: '50%',
            bgcolor: STITCH.secondaryBright,
            boxShadow: `0 0 0 ${Math.max(2, size * 0.06)}px ${
              inverted ? 'rgba(255,255,255,0.2)' : STITCH.primaryContainer
            }, 0 0 0 ${Math.max(3, size * 0.1)}px ${STITCH.secondaryBright}`,
          }}
        />
        <Box
          sx={{
            position: 'absolute',
            width: size * 0.18,
            height: size * 0.18,
            borderRadius: '50%',
            bgcolor: STITCH.secondaryBright,
            top: size * 0.18,
            right: size * 0.18,
          }}
        />
      </Box>
      {!compact && (
        <Typography
          component="span"
          noWrap
          sx={{
            fontFamily: DISPLAY_FONT,
            fontWeight: 700,
            fontSize: size >= 32 ? '1.2rem' : '1.05rem',
            letterSpacing: '-0.03em',
            color: inverted ? '#ffffff' : STITCH.primary,
            minWidth: 0,
          }}
        >
          ScoutX
        </Typography>
      )}
    </Stack>
  );
}
