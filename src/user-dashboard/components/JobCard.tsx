import React from 'react';
import { Avatar, Box, Button, Chip, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import BookmarkAdded from '@mui/icons-material/Bookmark';
import BookmarkBorder from '@mui/icons-material/BookmarkBorder';
import OpenInNew from '@mui/icons-material/OpenInNew';
import PaymentsOutlined from '@mui/icons-material/PaymentsOutlined';
import PlaceOutlined from '@mui/icons-material/PlaceOutlined';
import ScheduleOutlined from '@mui/icons-material/ScheduleOutlined';
import type { FeedJob } from '../types';
import { timeAgo } from '../utils/format';
import {
  BODY_FONT,
  DISPLAY_FONT,
  EASE,
  FIRSTSTEP,
  MOTION_SAFE,
  RADIUS,
  SHADOW,
  STITCH,
  panelSx,
  tint,
} from '../tokens';

type Props = {
  job: FeedJob;
  onSave?: (id: string) => void;
  onUnsave?: (id: string) => void;
  onOpen?: (id: string) => void;
  /** Shows which cluster surfaced the job; useful on the "all subscriptions" feed. */
  showCluster?: boolean;
  /** Highlighted when this card is the active selection in the split feed. */
  selected?: boolean;
  /** Compact layout for the feed list column. */
  dense?: boolean;
};

const metaSx = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 0.4,
  color: FIRSTSTEP.textMuted,
  fontSize: '0.8rem',
} as const;

export function JobCard({ job, onSave, onUnsave, onOpen, showCluster = false, selected = false, dense = false }: Props) {
  const toggleSave = () => (job.saved ? onUnsave?.(job.id) : onSave?.(job.id));
  const posted = timeAgo(job.postedAt);

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
        p: dense ? 1.75 : { xs: 1.75, md: 2 },
        cursor: onOpen ? 'pointer' : 'default',
        transition: `border-color 200ms ${EASE}, box-shadow 200ms ${EASE}, transform 200ms ${EASE}, background 200ms ${EASE}`,
        ...(selected
          ? {
              borderColor: tint(STITCH.secondaryBright, 0.55),
              boxShadow: SHADOW.md,
              background: `linear-gradient(90deg, ${tint(STITCH.secondaryBright, 0.12)} 0%, ${STITCH.surfaceLowest} 42%)`,
            }
          : {
              '&:hover': onOpen
                ? {
                    borderColor: tint(STITCH.secondaryBright, 0.45),
                    boxShadow: SHADOW.cardHover,
                    [MOTION_SAFE]: { transform: 'translateY(-2px)' },
                  }
                : undefined,
            }),
        '&:focus-visible': {
          outline: `2px solid ${STITCH.secondaryBright}`,
          outlineOffset: 2,
        },
      }}
    >
      <Stack direction="row" spacing={{ xs: 1.5, md: 2 }} alignItems="flex-start">
        <Avatar
          src={job.logoUrl}
          alt=""
          variant="rounded"
          sx={{
            width: 44,
            height: 44,
            flexShrink: 0,
            borderRadius: RADIUS.control,
            bgcolor: tint(FIRSTSTEP.navy, 0.07),
            color: FIRSTSTEP.navy,
            fontWeight: 700,
            fontSize: '1rem',
          }}
        >
          {job.company.charAt(0)}
        </Avatar>

        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" alignItems="flex-start" spacing={1} justifyContent="space-between">
            <Typography
              sx={{
                fontWeight: 700,
                color: STITCH.onSurface,
                fontFamily: DISPLAY_FONT,
                fontSize: '0.98rem',
                lineHeight: 1.35,
                minWidth: 0,
              }}
            >
              {job.title}
            </Typography>
            {posted && (
              <Typography
                variant="caption"
                sx={{ color: FIRSTSTEP.textMuted, flexShrink: 0, whiteSpace: 'nowrap', mt: 0.25 }}
              >
                {posted}
              </Typography>
            )}
          </Stack>

          <Typography noWrap sx={{ fontWeight: 600, color: FIRSTSTEP.navy, fontSize: '0.85rem', mt: 0.25 }}>
            {job.company}
          </Typography>

          <Stack direction="row" flexWrap="wrap" gap={{ xs: 1, md: 1.5 }} sx={{ mt: 0.5 }}>
            <Box sx={metaSx}>
              <PlaceOutlined sx={{ fontSize: 14 }} />
              {job.location}
            </Box>
            {job.salary && (
              <Box sx={metaSx}>
                <PaymentsOutlined sx={{ fontSize: 14 }} />
                {job.salary}
              </Box>
            )}
            {job.experience && (
              <Box sx={metaSx}>
                <ScheduleOutlined sx={{ fontSize: 14 }} />
                {job.experience}
              </Box>
            )}
          </Stack>

          <Stack direction="row" flexWrap="wrap" gap={0.5} sx={{ mt: 1.25 }}>
            {job.workMode && (
              <Chip
                label={job.workMode}
                size="small"
                sx={{
                  height: 22,
                  borderRadius: RADIUS.pill,
                  fontSize: '0.68rem',
                  fontWeight: 600,
                  bgcolor: tint(FIRSTSTEP.navy, 0.07),
                  color: FIRSTSTEP.navy,
                }}
              />
            )}
            {job.h1bEligible && (
              <Chip
                label="H-1B sponsor signal"
                size="small"
                sx={{
                  height: 22,
                  borderRadius: RADIUS.pill,
                  fontSize: '0.68rem',
                  fontWeight: 600,
                  bgcolor: tint(FIRSTSTEP.teal, 0.16),
                  color: FIRSTSTEP.tealDark,
                }}
              />
            )}
            {job.h1bFy2026Match && (
              <Chip
                label="FY2026 filing match"
                size="small"
                sx={{
                  height: 22,
                  borderRadius: RADIUS.pill,
                  fontSize: '0.68rem',
                  fontWeight: 600,
                  bgcolor: tint(FIRSTSTEP.warning, 0.18),
                  color: '#8a5a00',
                }}
              />
            )}
            {showCluster && job.clusterName && (
              <Chip
                label={job.clusterName}
                size="small"
                variant="outlined"
                sx={{
                  height: 22,
                  borderRadius: RADIUS.pill,
                  fontSize: '0.68rem',
                  color: FIRSTSTEP.textMuted,
                  borderColor: FIRSTSTEP.border,
                }}
              />
            )}
          </Stack>
        </Box>

        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          alignItems="center"
          spacing={0.5}
          sx={{ flexShrink: 0 }}
          onClick={(e) => e.stopPropagation()}
        >
          <Tooltip title={job.saved ? 'Remove from saved' : 'Save job'}>
            <IconButton
              size="small"
              onClick={toggleSave}
              aria-label={job.saved ? 'Remove from saved' : 'Save job'}
              sx={{
                color: job.saved ? FIRSTSTEP.tealDark : FIRSTSTEP.textMuted,
                bgcolor: job.saved ? tint(FIRSTSTEP.teal, 0.14) : 'transparent',
                '&:hover': { bgcolor: tint(FIRSTSTEP.teal, 0.18), color: FIRSTSTEP.tealDark },
              }}
            >
              {job.saved ? <BookmarkAdded sx={{ fontSize: 19 }} /> : <BookmarkBorder sx={{ fontSize: 19 }} />}
            </IconButton>
          </Tooltip>
          <Button
            href={job.applyUrl}
            target="_blank"
            rel="noopener noreferrer"
            size="small"
            variant="outlined"
            endIcon={<OpenInNew sx={{ fontSize: 13 }} />}
            sx={{
              borderRadius: RADIUS.pill,
              fontWeight: 700,
              textTransform: 'none',
              whiteSpace: 'nowrap',
              color: FIRSTSTEP.navy,
              borderColor: FIRSTSTEP.border,
              '&:hover': { borderColor: FIRSTSTEP.teal, bgcolor: tint(FIRSTSTEP.teal, 0.08) },
            }}
          >
            Direct Portal
          </Button>
        </Stack>
      </Stack>
    </Box>
  );
}
