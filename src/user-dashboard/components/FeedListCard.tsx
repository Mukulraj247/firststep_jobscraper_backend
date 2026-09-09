import React from 'react';
import { Box, IconButton, Stack, Typography } from '@mui/material';
import Favorite from '@mui/icons-material/Favorite';
import FavoriteBorder from '@mui/icons-material/FavoriteBorder';
import VerifiedUserOutlined from '@mui/icons-material/VerifiedUserOutlined';
import CheckCircleOutline from '@mui/icons-material/CheckCircleOutline';
import type { FeedJob } from '../types';
import { timeAgo } from '../utils/format';
import {
  BODY_FONT,
  DISPLAY_FONT,
  EASE,
  RADIUS,
  SHADOW,
  STITCH,
  panelSx,
  tint,
} from '../tokens';

type Props = {
  job: FeedJob;
  selected?: boolean;
  frequencyLabel?: string;
  onOpen?: (id: string) => void;
  onSave?: (id: string) => void;
  onUnsave?: (id: string) => void;
};

/** Stitch live-feed list card (company row + salary + H-1B footer strip). */
export function FeedListCard({ job, selected = false, frequencyLabel, onOpen, onSave, onUnsave }: Props) {
  const posted = timeAgo(job.postedAt);
  const toggleSave = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (job.saved) onUnsave?.(job.id);
    else onSave?.(job.id);
  };

  return (
    <Box
      onClick={() => onOpen?.(job.id)}
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onKeyDown={(e) => {
        if (!onOpen) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(job.id);
        }
      }}
      sx={{
        ...panelSx,
        p: 2,
        cursor: onOpen ? 'pointer' : 'default',
        overflow: 'hidden',
        transition: `box-shadow 200ms ${EASE}, background 200ms ${EASE}`,
        ...(selected
          ? {
              boxShadow: SHADOW.md,
              background: `linear-gradient(90deg, ${tint(STITCH.secondary, 0.1)} 0%, ${STITCH.surfaceLowest} 55%)`,
            }
          : {
              '&:hover': { boxShadow: SHADOW.sm },
            }),
        '&:focus-visible': {
          outline: `2px solid ${STITCH.secondary}`,
          outlineOffset: 2,
        },
      }}
    >
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
        <Stack direction="row" spacing={1.25} alignItems="flex-start" sx={{ minWidth: 0 }}>
          <Box
            sx={{
              width: 44,
              height: 44,
              flexShrink: 0,
              borderRadius: RADIUS.control,
              bgcolor: STITCH.surfaceLow,
              color: STITCH.primary,
              fontFamily: DISPLAY_FONT,
              fontWeight: 700,
              fontSize: '1.05rem',
              display: 'grid',
              placeItems: 'center',
              backgroundImage: job.logoUrl ? `url(${job.logoUrl})` : undefined,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }}
          >
            {!job.logoUrl && job.company.charAt(0)}
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Stack direction="row" alignItems="center" spacing={0.75} flexWrap="wrap" useFlexGap>
              <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: STITCH.onSurface, fontFamily: BODY_FONT }}>
                {job.company}
              </Typography>
              {job.workMode && (
                <Box
                  component="span"
                  sx={{
                    px: 0.75,
                    py: 0.2,
                    borderRadius: '4px',
                    fontSize: '0.68rem',
                    fontWeight: 600,
                    fontFamily: BODY_FONT,
                    bgcolor:
                      job.workMode === 'Remote'
                        ? tint(STITCH.secondaryContainer, 0.4)
                        : STITCH.surfaceContainer,
                    color: job.workMode === 'Remote' ? STITCH.secondary : STITCH.onSurfaceVariant,
                  }}
                >
                  {job.workMode}
                </Box>
              )}
            </Stack>
            <Typography
              sx={{
                mt: 0.35,
                fontFamily: DISPLAY_FONT,
                fontWeight: 600,
                fontSize: '1rem',
                lineHeight: 1.35,
                color: selected ? STITCH.primary : STITCH.onSurface,
                letterSpacing: '-0.01em',
              }}
            >
              {job.title}
            </Typography>
            <Typography sx={{ mt: 0.35, fontSize: '0.8125rem', color: STITCH.onSurfaceVariant, fontFamily: BODY_FONT }}>
              {job.location}
            </Typography>
          </Box>
        </Stack>
        <IconButton
          size="small"
          onClick={toggleSave}
          aria-label={job.saved ? 'Unsave' : 'Save'}
          sx={{
            color: job.saved ? STITCH.error : STITCH.outline,
            '&:hover': { color: STITCH.error },
          }}
        >
          {job.saved ? <Favorite sx={{ fontSize: 22 }} /> : <FavoriteBorder sx={{ fontSize: 22 }} />}
        </IconButton>
      </Stack>

      <Stack direction="row" justifyContent="space-between" alignItems="baseline" sx={{ mt: 1.25 }} spacing={1}>
        <Typography sx={{ fontSize: '0.875rem', fontWeight: 700, color: selected ? STITCH.primary : STITCH.onSurface, fontFamily: BODY_FONT }}>
          {job.salary || 'Salary not listed'}
        </Typography>
        <Typography
          sx={{
            fontSize: '0.68rem',
            fontWeight: 700,
            color: selected ? STITCH.secondary : STITCH.onSurfaceVariant,
            fontFamily: BODY_FONT,
            whiteSpace: 'nowrap',
          }}
        >
          {posted ? `Added ${posted}` : 'Just added'}
          {frequencyLabel ? ` (${frequencyLabel} window)` : ''}
        </Typography>
      </Stack>

      {(job.h1bEligible || job.h1bFy2026Match || job.experience) && (
        <Stack
          direction="row"
          flexWrap="wrap"
          gap={0.75}
          sx={{
            mt: 1.25,
            mx: -2,
            mb: -2,
            px: 1.5,
            py: 1.25,
            bgcolor: tint(STITCH.surfaceLow, selected ? 0.85 : 0.55),
            borderBottomLeftRadius: RADIUS.card,
            borderBottomRightRadius: RADIUS.card,
          }}
        >
          {job.h1bEligible && (
            <Box
              component="span"
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 0.4,
                px: 1,
                py: 0.25,
                borderRadius: RADIUS.pill,
                bgcolor: STITCH.secondaryContainer,
                color: STITCH.onSecondaryContainer,
                fontSize: '0.68rem',
                fontWeight: 700,
                fontFamily: BODY_FONT,
              }}
            >
              <VerifiedUserOutlined sx={{ fontSize: 13 }} />
              H-1B Sponsor Signal
            </Box>
          )}
          {job.h1bFy2026Match && (
            <Box
              component="span"
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 0.4,
                px: 1,
                py: 0.25,
                borderRadius: RADIUS.pill,
                bgcolor: STITCH.primaryContainer,
                color: STITCH.onPrimary,
                fontSize: '0.68rem',
                fontWeight: 700,
                fontFamily: BODY_FONT,
              }}
            >
              <CheckCircleOutline sx={{ fontSize: 13 }} />
              FY2026 Match
            </Box>
          )}
          {job.experience && !job.h1bEligible && (
            <Box
              component="span"
              sx={{
                px: 1,
                py: 0.25,
                borderRadius: RADIUS.pill,
                bgcolor: STITCH.surfaceContainer,
                color: STITCH.onSurfaceVariant,
                fontSize: '0.68rem',
                fontWeight: 600,
                fontFamily: BODY_FONT,
              }}
            >
              {job.experience}
            </Box>
          )}
        </Stack>
      )}
    </Box>
  );
}
