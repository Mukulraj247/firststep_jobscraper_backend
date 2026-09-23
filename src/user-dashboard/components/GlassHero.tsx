import React from 'react';
import { Box } from '@mui/material';

/**
 * Plain page header shell — matches First Step interior pages (no frosted glass).
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
        px: { xs: 0, md: 0 },
        py: { xs: dense ? 0.5 : 1, md: dense ? 0.75 : 1.25 },
        mb: { xs: 2, md: 2.5 },
        bgcolor: 'transparent',
        border: 'none',
        boxShadow: 'none',
      }}
    >
      {children}
    </Box>
  );
}
