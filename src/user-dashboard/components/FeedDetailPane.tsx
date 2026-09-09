import React from 'react';
import { Avatar, Box, Button, Chip, Stack, Typography } from '@mui/material';
import BookmarkAdded from '@mui/icons-material/Bookmark';
import BookmarkBorder from '@mui/icons-material/BookmarkBorder';
import HubOutlined from '@mui/icons-material/HubOutlined';
import InfoOutlined from '@mui/icons-material/InfoOutlined';
import OpenInNew from '@mui/icons-material/OpenInNew';
import PaymentsOutlined from '@mui/icons-material/PaymentsOutlined';
import PlaceOutlined from '@mui/icons-material/PlaceOutlined';
import ScheduleOutlined from '@mui/icons-material/ScheduleOutlined';
import VerifiedUserOutlined from '@mui/icons-material/VerifiedUserOutlined';
import type { FeedJob } from '../types';
import { timeAgo } from '../utils/format';
import {
  BODY_FONT,
  DISPLAY_FONT,
  RADIUS,
  STITCH,
  accentButtonSx,
  ghostButtonSx,
  panelSx,
  tint,
} from '../tokens';

type Props = {
  job: FeedJob | null;
  onSave?: () => void;
  onUnsave?: () => void;
};

/** Persistent right-hand job detail pane used by the Stitch feed split view. */
export function FeedDetailPane({ job, onSave, onUnsave }: Props) {
  if (!job) {
    return (
      <Box
        sx={{
          ...panelSx,
          p: 4,
          minHeight: 420,
          display: 'grid',
          placeItems: 'center',
          textAlign: 'center',
          position: { lg: 'sticky' },
          top: { lg: 88 },
        }}
      >
        <Box>
          <Typography sx={{ fontFamily: DISPLAY_FONT, fontWeight: 600, color: STITCH.onSurface }}>
            Select a role
          </Typography>
          <Typography sx={{ mt: 0.75, color: STITCH.muted, fontSize: '0.875rem', maxWidth: 280, mx: 'auto' }}>
            Pick a job from the list to see the full description, H-1B signals, and apply link here.
          </Typography>
        </Box>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        ...panelSx,
        p: { xs: 2.5, md: 3 },
        position: { lg: 'sticky' },
        top: { lg: 88 },
        maxHeight: { lg: 'calc(100dvh - 104px)' },
        overflowY: { lg: 'auto' },
      }}
    >
      <Stack direction="row" spacing={2} alignItems="flex-start">
        <Avatar
          src={job.logoUrl}
          alt=""
          variant="rounded"
          sx={{
            width: 56,
            height: 56,
            flexShrink: 0,
            borderRadius: '16px',
            bgcolor: STITCH.surfaceLow,
            color: STITCH.primary,
            fontWeight: 700,
            fontSize: '1.25rem',
            fontFamily: DISPLAY_FONT,
          }}
        >
          {job.company.charAt(0)}
        </Avatar>
        <Box sx={{ minWidth: 0 }}>
          <Stack direction="row" flexWrap="wrap" alignItems="center" gap={0.75}>
            <Typography sx={{ fontFamily: DISPLAY_FONT, fontWeight: 700, color: STITCH.primary, fontSize: '1.05rem' }}>
              {job.company}
            </Typography>
            <Chip
              label="Tier-1 Subscribed"
              size="small"
              sx={{
                height: 22,
                borderRadius: RADIUS.pill,
                fontWeight: 700,
                fontSize: '0.68rem',
                bgcolor: STITCH.secondaryContainer,
                color: STITCH.onSecondaryContainer,
              }}
            />
          </Stack>
          <Typography
            component="h2"
            sx={{
              fontFamily: DISPLAY_FONT,
              fontWeight: 700,
              fontSize: { xs: '1.25rem', md: '1.5rem' },
              letterSpacing: '-0.02em',
              color: STITCH.primary,
              mt: 0.5,
              lineHeight: 1.25,
            }}
          >
            {job.title}
          </Typography>
          <Stack direction="row" flexWrap="wrap" gap={1.5} sx={{ mt: 1, color: STITCH.onSurfaceVariant, fontSize: '0.8125rem' }}>
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
            <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.4, color: STITCH.secondary, fontWeight: 600 }}>
              <ScheduleOutlined sx={{ fontSize: 16 }} />
              Posted {timeAgo(job.postedAt)}
            </Box>
          </Stack>
        </Box>
      </Stack>

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 2.5 }}>
        <Button
          variant="contained"
          disableElevation
          href={job.applyUrl}
          target="_blank"
          rel="noopener noreferrer"
          endIcon={<OpenInNew sx={{ fontSize: 16 }} />}
          sx={{ ...accentButtonSx, py: 1.35, flex: { xs: 1, sm: 'none' } }}
        >
          Apply on Company Site
        </Button>
        <Button
          variant="text"
          startIcon={job.saved ? <BookmarkAdded sx={{ fontSize: 18 }} /> : <BookmarkBorder sx={{ fontSize: 18 }} />}
          onClick={job.saved ? onUnsave : onSave}
          sx={{
            ...ghostButtonSx,
            py: 1.25,
            border: 'none',
            bgcolor: STITCH.surfaceLow,
            color: job.saved ? STITCH.error : STITCH.onSurfaceVariant,
            ...(job.saved && {
              color: STITCH.error,
              bgcolor: STITCH.surfaceLow,
            }),
          }}
        >
          {job.saved ? 'Saved to Bookmarks' : 'Save job'}
        </Button>
      </Stack>

      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ mt: 2, p: 1.5, borderRadius: RADIUS.control, bgcolor: STITCH.surfaceLow }}
      >
        <Stack direction="row" alignItems="center" spacing={1}>
          <HubOutlined sx={{ fontSize: 20, color: STITCH.secondary }} />
          <Typography sx={{ fontSize: '0.8125rem', color: STITCH.onSurface }}>
            Part of Cluster:{' '}
            <Box component="strong" sx={{ color: STITCH.primary }}>
              {job.clusterName}
            </Box>
          </Typography>
        </Stack>
        <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, color: STITCH.secondary, display: { xs: 'none', sm: 'block' } }}>
          Real-time Hook
        </Typography>
      </Stack>

      {(job.h1bEligible || job.h1bFy2026Match) && (
        <Box
          sx={{
            mt: 2.5,
            p: 2,
            borderRadius: RADIUS.card,
            background: `linear-gradient(135deg, ${STITCH.surfaceLow} 0%, ${STITCH.surfaceLowest} 48%, ${tint(STITCH.secondaryBright, 0.18)} 100%)`,
            border: `1px solid ${tint(STITCH.secondaryBright, 0.2)}`,
          }}
        >
          <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1} sx={{ mb: 1.5 }}>
            <Stack direction="row" alignItems="center" spacing={0.75}>
              <VerifiedUserOutlined sx={{ fontSize: 22, color: STITCH.secondary }} />
              <Typography sx={{ fontFamily: DISPLAY_FONT, fontWeight: 700, color: STITCH.primary, fontSize: '1rem' }}>
                H-1B Sponsor &amp; Visa Intelligence
              </Typography>
            </Stack>
            <Chip
              label="High Confidence"
              size="small"
              sx={{
                height: 22,
                borderRadius: RADIUS.pill,
                fontWeight: 700,
                fontSize: '0.68rem',
                bgcolor: STITCH.secondary,
                color: STITCH.onSecondary,
              }}
            />
          </Stack>

          <Stack spacing={1}>
            {job.h1bEligible && (
              <Box sx={{ p: 1.5, borderRadius: '8px', bgcolor: 'rgba(255,255,255,0.8)' }}>
                <Typography sx={{ fontWeight: 700, fontSize: '0.8125rem', color: STITCH.primary }}>
                  H-1B Sponsor Signal: High Confidence
                </Typography>
                <Typography sx={{ fontSize: '0.75rem', color: STITCH.muted, mt: 0.35 }}>
                  Historical DOL LCA filings suggest this employer sponsors software roles. Always verify the live posting.
                </Typography>
              </Box>
            )}
            {job.h1bFy2026Match && (
              <Box sx={{ p: 1.5, borderRadius: '8px', bgcolor: 'rgba(255,255,255,0.8)' }}>
                <Typography sx={{ fontWeight: 700, fontSize: '0.8125rem', color: STITCH.primary }}>
                  FY2026 Filing Match
                </Typography>
                <Typography sx={{ fontSize: '0.75rem', color: STITCH.muted, mt: 0.35 }}>
                  Title and location overlap with FY2026 certified filings for similar roles.
                </Typography>
              </Box>
            )}
            <Stack direction="row" spacing={1} sx={{ p: 1.25, borderRadius: '8px', bgcolor: tint(STITCH.surfaceHighest, 0.55) }}>
              <InfoOutlined sx={{ fontSize: 16, color: STITCH.outline, mt: 0.15, flexShrink: 0 }} />
              <Typography sx={{ fontSize: '0.7rem', color: STITCH.muted, lineHeight: 1.55 }}>
                <strong>Honest disclaimer:</strong> ScoutText shows historical and filing signals, not legal guarantees.
                If a posting says &quot;will not sponsor,&quot; that overrides any badge.
              </Typography>
            </Stack>
          </Stack>
        </Box>
      )}

      <Box sx={{ mt: 3 }}>
        <Typography sx={{ fontFamily: DISPLAY_FONT, fontWeight: 700, color: STITCH.primary, fontSize: '1.05rem' }}>
          About the Role
        </Typography>
        <Typography
          sx={{
            mt: 1.25,
            fontFamily: BODY_FONT,
            whiteSpace: 'pre-wrap',
            color: STITCH.onSurfaceVariant,
            fontSize: '0.9rem',
            lineHeight: 1.7,
          }}
        >
          {job.description}
        </Typography>
      </Box>
    </Box>
  );
}
