import React from 'react';
import { Box, Paper, Skeleton, Stack } from '@mui/material';
import { cardSx, RADIUS } from '../../components/dashboard/ops/dashboardTokens';

export function RunsSkeleton() {
  return (
    <Box aria-hidden>
      <Paper elevation={0} sx={[cardSx(), { p: { xs: 2.5, md: 3.5 }, mb: 3 }]}>
        <Skeleton width="22%" height={14} />
        <Skeleton width="38%" height={36} sx={{ mt: 1 }} />
        <Skeleton width="72%" height={18} sx={{ mt: 1.25 }} />
        <Skeleton width="28%" height={28} sx={{ mt: 2, borderRadius: RADIUS.pill }} />
      </Paper>
      <Paper elevation={0} sx={[cardSx(), { p: 2, mb: 2.5 }]}>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: '1fr 1fr', xl: 'repeat(5, 1fr)' },
            gap: 1.5,
          }}
        >
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} variant="rounded" height={44} sx={{ borderRadius: RADIUS.control }} />
          ))}
        </Box>
      </Paper>
      <Paper elevation={0} sx={[cardSx(), { overflow: 'hidden' }]}>
        <Stack spacing={0}>
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton
              key={index}
              variant="rectangular"
              height={68}
              sx={{ borderBottom: index < 5 ? '1px solid' : 'none', borderColor: 'divider' }}
            />
          ))}
        </Stack>
      </Paper>
    </Box>
  );
}
