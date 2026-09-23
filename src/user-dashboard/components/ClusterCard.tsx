import React from 'react';
import { Avatar, AvatarGroup, Box, Button, Chip, Stack, Tooltip, Typography } from '@mui/material';
import LockOutlined from '@mui/icons-material/LockOutlined';
import WorkOutline from '@mui/icons-material/WorkOutline';
import { Link } from 'react-router-dom';
import type { Cluster } from '../types';
import { humanLabel } from '../utils/displayLabels';
import { careerPageHref, careerPageLabel } from '../utils/format';
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

type Props = { cluster: Cluster; subscribed?: boolean; locked?: boolean };

export function ClusterCard({ cluster, subscribed = false, locked = false }: Props) {
  const custom = cluster.kind === 'custom';
  const showLocked = locked && !subscribed;
  const displayName = humanLabel(cluster.name, custom ? 'Custom cluster' : 'Curated cluster');
  const displayDesc = humanLabel(
    cluster.description,
    custom ? 'Built from your request' : 'Curated roles from this cluster',
  );
  const careerUrls = (cluster.careerPageUrls || []).filter(Boolean);
  const showCareerUrls = careerUrls.length > 0;
  const previewChips = showCareerUrls
    ? careerUrls.slice(0, 6)
    : (cluster.filtersSummary || []).slice(0, 6);
  const moreCount = showCareerUrls
    ? Math.max(0, careerUrls.length - previewChips.length)
    : Math.max(0, (cluster.filtersSummary || []).length - previewChips.length);

  return (
    <Box
      sx={{
        ...interactivePanelSx,
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        p: 2,
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
          {showLocked && (
            <Chip
              icon={<LockOutlined sx={{ fontSize: '14px !important' }} />}
              label="Locked"
              size="small"
              sx={{
                height: 22,
                borderRadius: RADIUS.pill,
                fontSize: '0.7rem',
                fontWeight: 700,
                bgcolor: tint(STITCH.warning, 0.16),
                color: STITCH.warning,
                '& .MuiChip-icon': { color: STITCH.warning },
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
        {displayName}
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
        {displayDesc}
      </Typography>

      {previewChips.length > 0 && (
        <Box sx={{ mb: 1.5 }}>
          <Typography
            sx={{
              fontSize: '0.65rem',
              fontWeight: 700,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: STITCH.onSurfaceVariant,
              mb: 0.5,
            }}
          >
            {showCareerUrls ? 'Career pages' : 'Filters'}
          </Typography>
          <Stack direction="row" flexWrap="wrap" gap={0.5}>
            {previewChips.map((item) => {
              if (showCareerUrls) {
                const label = careerPageLabel(item);
                return (
                  <Tooltip key={item} title={item} placement="top">
                    <Chip
                      component="a"
                      href={careerPageHref(item)}
                      target="_blank"
                      rel="noopener noreferrer"
                      clickable
                      label={label}
                      size="small"
                      onClick={(e) => e.stopPropagation()}
                      sx={{
                        height: 22,
                        maxWidth: 180,
                        borderRadius: RADIUS.pill,
                        fontSize: '0.68rem',
                        bgcolor: tint(STITCH.primaryContainer, 0.08),
                        color: STITCH.onSurface,
                        border: 'none',
                        textDecoration: 'none',
                        '& .MuiChip-label': {
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        },
                      }}
                    />
                  </Tooltip>
                );
              }
              return (
                <Chip
                  key={item}
                  label={item}
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
              );
            })}
            {moreCount > 0 && (
              <Chip
                label={`+${moreCount} more`}
                size="small"
                sx={{
                  height: 22,
                  borderRadius: RADIUS.pill,
                  fontSize: '0.68rem',
                  bgcolor: STITCH.surfaceContainer,
                  color: STITCH.onSurfaceVariant,
                }}
              />
            )}
          </Stack>
        </Box>
      )}

      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 2, color: STITCH.onSurfaceVariant }}>
        <Stack direction="row" alignItems="center" spacing={0.5}>
          <WorkOutline sx={{ fontSize: 14 }} />
          <Typography sx={{ fontSize: '0.75rem', fontWeight: 600 }}>~{cluster.jobCountPreview} active jobs</Typography>
        </Stack>
      </Stack>

      <Stack direction="row" spacing={1} sx={{ mt: 'auto' }}>
        <Button
          component={Link}
          to={`/user/clusters/${cluster.slug}`}
          variant="outlined"
          fullWidth
          sx={{ ...ghostButtonSx, py: 1 }}
        >
          Preview Jobs
        </Button>
        {showLocked ? (
          <Button
            variant="contained"
            disableElevation
            fullWidth
            disabled
            startIcon={<LockOutlined sx={{ fontSize: 16 }} />}
            sx={{ ...primaryButtonSx, py: 1, opacity: 0.7 }}
          >
            Locked
          </Button>
        ) : (
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
        )}
      </Stack>
    </Box>
  );
}
