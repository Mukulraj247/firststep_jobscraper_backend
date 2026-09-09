import React from 'react';
import { Box, Grid, Skeleton, Stack } from '@mui/material';
import { RADIUS, panelSx } from '../tokens';

/** Skeletons mirror the real layout so content does not jump when it loads. */

export function StatCardSkeleton() {
  return (
    <Box sx={{ ...panelSx, p: { xs: 1.75, md: 2.25 } }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Skeleton variant="text" width="60%" height={16} />
        <Skeleton variant="rounded" width={30} height={30} />
      </Stack>
      <Skeleton variant="text" width="45%" height={40} sx={{ mt: 0.5 }} />
    </Box>
  );
}

export function StatRowSkeleton({ count = 4 }: { count?: number }) {
  return (
    <Grid container spacing={{ xs: 1.5, md: 2 }}>
      {Array.from({ length: count }).map((_, i) => (
        <Grid item xs={6} md={3} key={i}>
          <StatCardSkeleton />
        </Grid>
      ))}
    </Grid>
  );
}

export function JobCardSkeleton() {
  return (
    <Box sx={{ ...panelSx, p: 2 }}>
      <Stack direction="row" spacing={2}>
        <Skeleton variant="rounded" width={44} height={44} />
        <Box sx={{ flex: 1 }}>
          <Skeleton variant="text" width="55%" height={22} />
          <Skeleton variant="text" width="38%" height={18} />
          <Stack direction="row" spacing={0.75} sx={{ mt: 1 }}>
            <Skeleton variant="rounded" width={68} height={22} sx={{ borderRadius: RADIUS.pill }} />
            <Skeleton variant="rounded" width={104} height={22} sx={{ borderRadius: RADIUS.pill }} />
          </Stack>
        </Box>
        <Skeleton variant="rounded" width={84} height={32} sx={{ borderRadius: RADIUS.pill }} />
      </Stack>
    </Box>
  );
}

export function JobListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <Stack spacing={1.5}>
      {Array.from({ length: count }).map((_, i) => (
        <JobCardSkeleton key={i} />
      ))}
    </Stack>
  );
}

export function ClusterCardSkeleton() {
  return (
    <Box sx={{ ...panelSx, p: 2.5, height: '100%' }}>
      <Stack direction="row" justifyContent="space-between" sx={{ mb: 1.5 }}>
        <Skeleton variant="rounded" width={72} height={22} sx={{ borderRadius: RADIUS.pill }} />
        <Skeleton variant="text" width={54} height={18} />
      </Stack>
      <Skeleton variant="text" width="70%" height={26} />
      <Skeleton variant="text" width="100%" height={18} />
      <Skeleton variant="text" width="85%" height={18} />
      <Stack direction="row" spacing={0.75} sx={{ mt: 2 }}>
        <Skeleton variant="rounded" width={60} height={22} sx={{ borderRadius: RADIUS.pill }} />
        <Skeleton variant="rounded" width={48} height={22} sx={{ borderRadius: RADIUS.pill }} />
      </Stack>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 2.5 }}>
        <Skeleton variant="text" width={80} height={20} />
        <Skeleton variant="rounded" width={120} height={32} sx={{ borderRadius: RADIUS.pill }} />
      </Stack>
    </Box>
  );
}

export function ClusterGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <Grid container spacing={{ xs: 1.5, md: 2 }}>
      {Array.from({ length: count }).map((_, i) => (
        <Grid item xs={12} sm={6} lg={4} key={i}>
          <ClusterCardSkeleton />
        </Grid>
      ))}
    </Grid>
  );
}

export function PanelSkeleton({ height = 120 }: { height?: number }) {
  return <Skeleton variant="rounded" height={height} sx={{ borderRadius: RADIUS.card }} />;
}
