import React from 'react';
import { Box, Paper, Skeleton, Stack } from '@mui/material';
import { cardSx, RADIUS } from '../../components/dashboard/ops/dashboardTokens';

export function FailureSkeleton() {
  return (
    <Box aria-hidden>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: '1fr 1fr',
            sm: 'repeat(auto-fit, minmax(140px, 1fr))',
          },
          gap: 2,
          mb: 3,
        }}
      >
        {Array.from({ length: 8 }).map((_, index) => (
          <Paper key={index} elevation={0} sx={[cardSx(), { p: 2 }]}>
            <Skeleton width="52%" height={14} />
            <Skeleton width="28%" height={32} sx={{ mt: 1 }} />
          </Paper>
        ))}
      </Box>
      <Paper elevation={0} sx={[cardSx(), { p: 2, mb: 2.5 }]}>
        <Skeleton variant="rounded" height={44} sx={{ borderRadius: RADIUS.control }} />
      </Paper>
      <Paper elevation={0} sx={[cardSx(), { p: 2, overflow: 'hidden' }]}>
        <Stack spacing={1.25}>
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} variant="rounded" height={56} sx={{ borderRadius: RADIUS.control }} />
          ))}
        </Stack>
      </Paper>
    </Box>
  );
}
