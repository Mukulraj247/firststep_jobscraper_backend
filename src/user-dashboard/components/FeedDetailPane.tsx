import React from 'react';
import { Box, Button, IconButton, Stack, Typography } from '@mui/material';
import AssignmentTurnedInOutlined from '@mui/icons-material/AssignmentTurnedInOutlined';
import BookmarkAdded from '@mui/icons-material/Bookmark';
import BookmarkBorder from '@mui/icons-material/BookmarkBorder';
import CloseRounded from '@mui/icons-material/CloseRounded';
import FlagOutlined from '@mui/icons-material/FlagOutlined';
import HubOutlined from '@mui/icons-material/HubOutlined';
import InfoOutlined from '@mui/icons-material/InfoOutlined';
import OpenInNew from '@mui/icons-material/OpenInNew';
import PaymentsOutlined from '@mui/icons-material/PaymentsOutlined';
import PlaceOutlined from '@mui/icons-material/PlaceOutlined';
import ScheduleOutlined from '@mui/icons-material/ScheduleOutlined';
import VerifiedUserOutlined from '@mui/icons-material/VerifiedUserOutlined';
import type { FeedJob } from '../types';
import { humanLabel } from '../utils/displayLabels';
import { timeAgo } from '../utils/format';
import { stripTrackingParams } from '../utils/stripTrackingParams';
import { JobDescriptionBody } from './JobDescriptionBody';
import { BODY_FONT, DISPLAY_FONT, RADIUS, STITCH, accentButtonSx, ghostButtonSx, tint } from '../tokens';

type Props = {
  job: FeedJob | null;
  assigning?: boolean;
  onSave?: () => void;
  onUnsave?: () => void;
  onAssign?: () => void;
  onReport?: () => void;
  onClose?: () => void;
};

/** Inline dossier that expands under a wire row. */
export function FeedDetailPane({
  job,
  assigning = false,
  onSave,
  onUnsave,
  onAssign,
  onReport,
  onClose,
}: Props) {
  if (!job) return null;

  return (
    <Box
      sx={{
        mx: { xs: 1, md: 1.5 },
        mb: 1.25,
        p: { xs: 2, md: 2.75 },
        borderRadius: RADIUS.card,
        bgcolor: STITCH.surfaceLowest,
        border: `1px solid ${STITCH.outlineVariant}`,
        borderLeft: `3px solid ${STITCH.secondary}`,
        boxShadow: '0 8px 28px rgba(2, 51, 69, 0.08)',
      }}
    >
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontFamily: DISPLAY_FONT, fontWeight: 700, color: STITCH.primary, fontSize: '0.92rem' }}>
            {job.company}
          </Typography>
          <Typography
            component="h2"
            sx={{
              fontFamily: DISPLAY_FONT,
              fontWeight: 700,
              fontSize: { xs: '1.15rem', md: '1.35rem' },
              letterSpacing: '-0.02em',
              color: STITCH.primary,
              mt: 0.35,
              lineHeight: 1.25,
            }}
          >
            {job.title}
          </Typography>
          <Stack direction="row" flexWrap="wrap" gap={1.25} sx={{ mt: 1, color: STITCH.onSurfaceVariant, fontSize: '0.8rem' }}>
            <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.4 }}>
              <PlaceOutlined sx={{ fontSize: 16 }} />
              {job.location}
              {job.workMode ? ` (${job.workMode})` : ''}
            </Box>
            {job.salary && (
              <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.4 }}>
                <PaymentsOutlined sx={{ fontSize: 16 }} />
                {job.salary}
              </Box>
            )}
            <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.4, color: STITCH.secondaryDark, fontWeight: 600 }}>
              <ScheduleOutlined sx={{ fontSize: 16 }} />
              Posted {timeAgo(job.postedAt)}
            </Box>
          </Stack>
        </Box>
        {onClose && (
          <IconButton aria-label="Close job details" onClick={onClose} size="small" sx={{ color: STITCH.muted }}>
            <CloseRounded />
          </IconButton>
        )}
      </Stack>

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 2 }} flexWrap="wrap" useFlexGap>
        <Button
          variant="contained"
          disableElevation
          href={stripTrackingParams(job.applyUrl)}
          target="_blank"
          rel="noopener noreferrer"
          endIcon={<OpenInNew sx={{ fontSize: 16 }} />}
          sx={{ ...accentButtonSx, py: 1.15, flex: { xs: 1, sm: 'none' } }}
        >
          Apply on company site
        </Button>
        {onAssign && (
          <Button
            variant="outlined"
            disabled={assigning || job.assigned}
            startIcon={<AssignmentTurnedInOutlined sx={{ fontSize: 18 }} />}
            onClick={onAssign}
            sx={{ ...ghostButtonSx, py: 1.1 }}
          >
            {assigning ? 'Assigning…' : job.assigned ? 'Assigned' : 'Assign'}
          </Button>
        )}
        <Button
          variant="text"
          startIcon={job.saved ? <BookmarkAdded sx={{ fontSize: 18 }} /> : <BookmarkBorder sx={{ fontSize: 18 }} />}
          onClick={job.saved ? onUnsave : onSave}
          sx={{
            ...ghostButtonSx,
            py: 1.1,
            border: 'none',
            bgcolor: STITCH.surfaceLow,
            color: job.saved ? STITCH.primary : STITCH.onSurfaceVariant,
          }}
        >
          {job.saved ? 'Saved' : 'Save job'}
        </Button>
        {onReport && (
          <Button
            variant="text"
            startIcon={<FlagOutlined sx={{ fontSize: 18 }} />}
            onClick={onReport}
            sx={{
              ...ghostButtonSx,
              py: 1.1,
              border: 'none',
              color: STITCH.muted,
              '&:hover': { color: STITCH.error, bgcolor: tint(STITCH.error, 0.06) },
            }}
          >
            Report
          </Button>
        )}
      </Stack>

      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        sx={{ mt: 1.75, p: 1.25, borderRadius: RADIUS.control, bgcolor: STITCH.surfaceLow }}
      >
        <HubOutlined sx={{ fontSize: 18, color: STITCH.secondary }} />
        <Typography sx={{ fontSize: '0.8125rem', color: STITCH.onSurface, fontFamily: BODY_FONT }}>
          Cluster:{' '}
          <Box component="strong" sx={{ color: STITCH.primary }}>
            {humanLabel(job.clusterName, 'Cluster')}
          </Box>
        </Typography>
      </Stack>

      {(job.h1bEligible || job.h1bFy2026Match) && (
        <Box
          sx={{
            mt: 2,
            p: 1.75,
            borderRadius: RADIUS.card,
            background: `linear-gradient(135deg, ${STITCH.surfaceLow} 0%, ${tint(STITCH.secondaryBright, 0.16)} 100%)`,
          }}
        >
          <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mb: 1 }}>
            <VerifiedUserOutlined sx={{ fontSize: 20, color: STITCH.secondary }} />
            <Typography sx={{ fontFamily: DISPLAY_FONT, fontWeight: 700, color: STITCH.primary, fontSize: '0.95rem' }}>
              H-1B sponsor & visa intelligence
            </Typography>
          </Stack>
          {job.h1bEligible && (
            <Typography sx={{ fontSize: '0.8rem', color: STITCH.muted, mb: 0.75 }}>
              Historical DOL LCA filings suggest this employer sponsors similar roles. Always verify the live posting.
            </Typography>
          )}
          {job.h1bFy2026Match && (
            <Typography sx={{ fontSize: '0.8rem', color: STITCH.muted, mb: 0.75 }}>
              Title and location overlap with FY2026 certified filings for similar roles.
            </Typography>
          )}
          <Stack direction="row" spacing={1} alignItems="flex-start">
            <InfoOutlined sx={{ fontSize: 16, color: STITCH.outline, mt: 0.15, flexShrink: 0 }} />
            <Typography sx={{ fontSize: '0.7rem', color: STITCH.muted, lineHeight: 1.55 }}>
              Historical signals only — not a legal guarantee. If a posting says “will not sponsor,” that overrides any
              badge.
            </Typography>
          </Stack>
        </Box>
      )}

      <Box sx={{ mt: 2.5 }}>
        <JobDescriptionBody description={job.description || ''} />
      </Box>
    </Box>
  );
}
