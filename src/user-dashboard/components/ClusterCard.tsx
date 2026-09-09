import React from 'react';
import { Avatar, AvatarGroup, Box, Button, Chip, Stack, Typography } from '@mui/material';
import WorkOutline from '@mui/icons-material/WorkOutline';
import { Link } from 'react-router-dom';
import type { Cluster } from '../types';
import {
  BODY_FONT,
  DISPLAY_FONT,
  RADIUS,
  STITCH,
  ghostButtonSx,
  interactivePanelSx,
  primaryButtonSx,
  tint,
} from '../tokens';

type Props = { cluster: Cluster; subscribed?: boolean };

export function ClusterCard({ cluster, subscribed = false }: Props) {
  const minPrice = Math.min(...cluster.plans.map((p) => p.priceMonthly));
  const custom = cluster.kind === 'custom';

  return (
    <Box
      sx={{
        ...interactivePanelSx,
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        p: 2.5,
        color: 'inherit',
      }}
    >
      <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
        <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
          <Chip
            label={custom ? 'Custom Built' : 'Curated'}
            size="small"
            sx={{
              height: 22,
              borderRadius: RADIUS.pill,
              fontSize: '0.7rem',
              fontWeight: 700,
              bgcolor: custom ? tint(STITCH.primaryContainer, 0.1) : tint(STITCH.secondaryBright, 0.16),
              color: custom ? STITCH.primaryContainer : STITCH.secondaryDark,
            }}
          />
          <Chip
            label="1–2h refresh"
            size="small"
            sx={{
              height: 22,
              borderRadius: RADIUS.pill,
              fontSize: '0.7rem',
              fontWeight: 600,
              bgcolor: STITCH.surfaceLow,
              color: STITCH.onSurfaceVariant,
            }}
          />
          {subscribed && (
            <Chip
              label="Subscribed"
              size="small"
              sx={{
                height: 22,
                borderRadius: RADIUS.pill,
                fontSize: '0.7rem',
                fontWeight: 700,
                bgcolor: tint(STITCH.success, 0.16),
                color: STITCH.success,
              }}
            />
          )}
        </Stack>
      </Stack>

      {cluster.companyLogos && cluster.companyLogos.length > 0 && (
        <AvatarGroup
          max={5}
          sx={{
            justifyContent: 'flex-start',
            mb: 1.5,
            '& .MuiAvatar-root': {
              width: 28,
              height: 28,
              fontSize: '0.65rem',
              borderColor: STITCH.surfaceLowest,
              bgcolor: STITCH.surfaceLow,
            },
          }}
        >
          {cluster.companyLogos.map((logo) => (
            <Avatar key={logo} src={logo} alt="" />
          ))}
        </AvatarGroup>
      )}

      <Typography
        sx={{
          fontFamily: DISPLAY_FONT,
          fontWeight: 600,
          fontSize: '1.15rem',
          letterSpacing: '-0.02em',
          color: STITCH.onSurface,
        }}
      >
        {cluster.name}
      </Typography>
      <Typography
        sx={{
          color: STITCH.onSurfaceVariant,
          mt: 0.5,
          mb: 1.5,
          fontSize: '0.8125rem',
          fontFamily: BODY_FONT,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {cluster.description}
      </Typography>

      <Stack direction="row" flexWrap="wrap" gap={0.5} sx={{ mb: 1.5 }}>
        {cluster.filtersSummary.slice(0, 3).map((tag) => (
          <Chip
            key={tag}
            label={tag}
            size="small"
            sx={{
              height: 22,
              borderRadius: RADIUS.pill,
              fontSize: '0.68rem',
              bgcolor: STITCH.surfaceContainer,
              color: STITCH.onSurface,
              border: 'none',
            }}
          />
        ))}
      </Stack>

      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 1.5, color: STITCH.onSurfaceVariant }}>
        <Stack direction="row" alignItems="center" spacing={0.5}>
          <WorkOutline sx={{ fontSize: 14 }} />
          <Typography sx={{ fontSize: '0.75rem', fontWeight: 600 }}>~{cluster.jobCountPreview} active jobs</Typography>
        </Stack>
        <Typography sx={{ fontSize: '0.75rem' }}>Updated 18m ago</Typography>
      </Stack>

      <Typography sx={{ fontSize: '0.8125rem', color: STITCH.onSurfaceVariant, mb: 2 }}>
        Billing tier:{' '}
        <Box component="span" sx={{ fontWeight: 700, color: STITCH.onSurface }}>
          From ${minPrice}/mo
        </Box>
      </Typography>

      <Stack direction="row" spacing={1} sx={{ mt: 'auto' }}>
        <Button
          component={Link}
          to={`/user/clusters/${cluster.slug}`}
          variant="outlined"
          fullWidth
          sx={{ ...ghostButtonSx, py: 1 }}
        >
          Preview 5 Jobs
        </Button>
        <Button
          component={Link}
          to={`/user/clusters/${cluster.slug}`}
          variant="contained"
          disableElevation
          fullWidth
          sx={{ ...primaryButtonSx, py: 1 }}
        >
          {subscribed ? 'View cluster' : 'Subscribe Now'}
        </Button>
      </Stack>
    </Box>
  );
}
