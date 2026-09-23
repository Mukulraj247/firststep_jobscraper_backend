import React from 'react';
import {
  Avatar,
  Box,
  Button,
  Chip,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import AssignmentTurnedInOutlined from '@mui/icons-material/AssignmentTurnedInOutlined';
import Bookmark from '@mui/icons-material/Bookmark';
import BookmarkBorder from '@mui/icons-material/BookmarkBorder';
import FlagOutlined from '@mui/icons-material/FlagOutlined';
import PaymentsOutlined from '@mui/icons-material/PaymentsOutlined';
import PlaceOutlined from '@mui/icons-material/PlaceOutlined';
import ScheduleOutlined from '@mui/icons-material/ScheduleOutlined';
import PublicOutlined from '@mui/icons-material/PublicOutlined';
import type { FeedJob } from '../types';
import { humanLabel } from '../utils/displayLabels';
import { timeAgo } from '../utils/format';
import {
  BODY_FONT,
  DISPLAY_FONT,
  RADIUS,
  STITCH,
  interactivePanelSx,
  tint,
} from '../tokens';

type Props = {
  job: FeedJob;
  assigning?: boolean;
  fadingOut?: boolean;
  showCluster?: boolean;
  onOpen: (id: string) => void;
  onAssign?: (id: string) => void;
  onReport?: (id: string) => void;
  onSave?: (id: string) => void;
  onUnsave?: (id: string) => void;
};

/**
 * Large feed card (Browse Clusters style) with title, meta, signals, and actions.
 */
export function FeedJobCard({
  job,
  assigning = false,
  fadingOut = false,
  showCluster = false,
  onOpen,
  onAssign,
  onReport,
  onSave,
  onUnsave,
}: Props) {
  const posted = timeAgo(job.postedAt);
  const clusterLabel = humanLabel(job.clusterName, '');
  const snippet = (job.description || '')
    .replace(/â€¢/g, '•')
    .replace(/â€"|â€”|â€“/g, '—')
    .replace(/â€¦/g, '…')
    .replace(/Â /g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);

  return (
    <Box
      role="button"
      tabIndex={0}
      onClick={() => onOpen(job.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(job.id);
        }
      }}
      sx={{
        ...interactivePanelSx,
        p: { xs: 2, md: 2.25 },
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        opacity: fadingOut ? 0 : 1,
        transform: fadingOut ? 'scale(0.97)' : 'none',
        transition: 'opacity 0.45s ease, transform 0.45s ease',
        pointerEvents: fadingOut ? 'none' : 'auto',
        borderColor: job.assigned ? tint(STITCH.success, 0.35) : undefined,
        bgcolor: job.assigned ? tint(STITCH.success, 0.04) : STITCH.surfaceLowest,
      }}
    >
      <Stack direction="row" spacing={1.5} alignItems="flex-start" sx={{ mb: 1.5 }}>
        <Avatar
          src={job.logoUrl || undefined}
          alt=""
          variant="rounded"
          sx={{
            width: 48,
            height: 48,
            borderRadius: RADIUS.control,
            bgcolor: STITCH.surfaceLow,
            fontWeight: 700,
            fontSize: '1rem',
            color: STITCH.primary,
            flexShrink: 0,
          }}
        >
          {(job.company || '?').charAt(0).toUpperCase()}
        </Avatar>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mb: 0.5 }}>
            <Chip
              size="small"
              icon={<ScheduleOutlined sx={{ fontSize: '14px !important' }} />}
              label={posted}
              sx={metaChipSx}
            />
            {showCluster && clusterLabel && (
              <Chip size="small" label={clusterLabel} sx={metaChipSx} />
            )}
            {job.assigned && (
              <Chip
                size="small"
                label="Assigned"
                sx={{
                  height: 24,
                  borderRadius: RADIUS.pill,
                  fontWeight: 700,
                  fontSize: '0.7rem',
                  bgcolor: tint(STITCH.success, 0.16),
                  color: STITCH.success,
                }}
              />
            )}
          </Stack>
          <Typography
            component="h3"
            sx={{
              fontFamily: DISPLAY_FONT,
              fontWeight: 700,
              fontSize: { xs: '1.05rem', md: '1.15rem' },
              letterSpacing: '-0.02em',
              color: STITCH.primary,
              lineHeight: 1.3,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {job.title}
          </Typography>
          <Typography
            sx={{
              mt: 0.35,
              fontSize: '0.875rem',
              fontWeight: 600,
              color: STITCH.onSurfaceVariant,
              fontFamily: BODY_FONT,
            }}
          >
            {job.company}
          </Typography>
        </Box>
      </Stack>

      <Stack spacing={0.75} sx={{ mb: 1.5, color: STITCH.muted, fontSize: '0.8rem' }}>
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
          <PlaceOutlined sx={{ fontSize: 16 }} />
          <Typography component="span" sx={{ fontSize: 'inherit', fontFamily: BODY_FONT }}>
            {job.location || 'Location TBD'}
            {job.workMode ? ` · ${job.workMode}` : ''}
          </Typography>
        </Box>
        {job.salary && (
          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
            <PaymentsOutlined sx={{ fontSize: 16 }} />
            <Typography component="span" sx={{ fontSize: 'inherit', fontFamily: BODY_FONT, fontWeight: 600 }}>
              {job.salary}
            </Typography>
          </Box>
        )}
        {job.experience && (
          <Typography sx={{ fontSize: 'inherit', fontFamily: BODY_FONT, pl: 0.25 }}>
            Experience: {job.experience}
          </Typography>
        )}
      </Stack>

      {snippet && (
        <Typography
          sx={{
            flex: 1,
            fontSize: '0.8125rem',
            lineHeight: 1.55,
            color: STITCH.onSurfaceVariant,
            fontFamily: BODY_FONT,
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            mb: 1.5,
          }}
        >
          {snippet}
          {snippet.length >= 180 ? '…' : ''}
        </Typography>
      )}

      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        spacing={1}
        sx={{ mt: 'auto', pt: 0.5 }}
        onClick={(e) => e.stopPropagation()}
      >
        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
          {job.h1bEligible && (
            <Chip
              size="small"
              icon={<PublicOutlined sx={{ fontSize: '14px !important' }} />}
              label="H-1B"
              sx={{
                height: 24,
                borderRadius: RADIUS.pill,
                fontWeight: 700,
                fontSize: '0.68rem',
                bgcolor: tint(STITCH.secondary, 0.14),
                color: STITCH.secondaryDark,
                '& .MuiChip-icon': { color: STITCH.secondaryDark },
              }}
            />
          )}
          {job.h1bFy2026Match && (
            <Chip
              size="small"
              label="FY2026"
              sx={{
                height: 24,
                borderRadius: RADIUS.pill,
                fontWeight: 700,
                fontSize: '0.68rem',
                bgcolor: tint(STITCH.primary, 0.1),
                color: STITCH.primary,
              }}
            />
          )}
        </Stack>

        <Stack direction="row" spacing={0.25} alignItems="center">
          {onAssign && (
            <Button
              size="small"
              disabled={assigning || job.assigned}
              startIcon={<AssignmentTurnedInOutlined sx={{ fontSize: '16px !important' }} />}
              onClick={() => onAssign(job.id)}
              sx={{
                textTransform: 'none',
                fontWeight: 700,
                fontSize: '0.75rem',
                fontFamily: BODY_FONT,
                color: job.assigned ? STITCH.onSurfaceVariant : STITCH.primary,
                minWidth: 0,
                px: 1,
                borderRadius: RADIUS.control,
              }}
            >
              {assigning ? '…' : job.assigned ? 'Assigned' : 'Assign'}
            </Button>
          )}
          {onReport && (
            <Tooltip title="Report this job">
              <IconButton
                size="small"
                aria-label="Report job"
                onClick={() => onReport(job.id)}
                sx={{ color: STITCH.outline }}
              >
                <FlagOutlined sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
          )}
          <Tooltip title={job.saved ? 'Unsave' : 'Save'}>
            <IconButton
              size="small"
              aria-label={job.saved ? 'Unsave' : 'Save'}
              onClick={() => (job.saved ? onUnsave?.(job.id) : onSave?.(job.id))}
              sx={{ color: job.saved ? STITCH.primary : STITCH.outline }}
            >
              {job.saved ? <Bookmark sx={{ fontSize: 20 }} /> : <BookmarkBorder sx={{ fontSize: 20 }} />}
            </IconButton>
          </Tooltip>
        </Stack>
      </Stack>
    </Box>
  );
}

const metaChipSx = {
  height: 24,
  borderRadius: RADIUS.pill,
  fontSize: '0.7rem',
  fontWeight: 600,
  bgcolor: STITCH.surfaceLow,
  color: STITCH.onSurfaceVariant,
  '& .MuiChip-icon': { color: STITCH.onSurfaceVariant },
} as const;
