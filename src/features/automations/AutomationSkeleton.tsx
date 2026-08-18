import React from 'react';
import { Box, Paper, Skeleton, Stack } from '@mui/material';
import { cardSx, RADIUS } from '../../components/dashboard/ops/dashboardTokens';

export function AutomationSkeleton() {
  return (
    <Box aria-hidden>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 2,
          mb: 3,
        }}
      >
        {Array.from({ length: 5 }).map((_, index) => (
          <Paper key={index} elevation={0} sx={[cardSx(), { p: 2.25 }]}>
            <Skeleton width="46%" height={16} />
            <Skeleton width="30%" height={40} sx={{ mt: 1 }} />
            <Skeleton width="60%" height={14} sx={{ mt: 1 }} />
          </Paper>
        ))}
      </Box>
      <Paper elevation={0} sx={[cardSx(), { p: 2, overflow: 'hidden' }]}>
        <Stack spacing={1.25}>
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} variant="rounded" height={44} sx={{ borderRadius: RADIUS.control }} />
          ))}
        </Stack>
      </Paper>
    </Box>
  );
}
