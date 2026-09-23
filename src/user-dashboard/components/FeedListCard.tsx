import React from 'react';
import { Box, Button, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import AssignmentTurnedInOutlined from '@mui/icons-material/AssignmentTurnedInOutlined';
import Bookmark from '@mui/icons-material/Bookmark';
import BookmarkBorder from '@mui/icons-material/BookmarkBorder';
import CheckCircleOutline from '@mui/icons-material/CheckCircleOutline';
import FlagOutlined from '@mui/icons-material/FlagOutlined';
import VerifiedUserOutlined from '@mui/icons-material/VerifiedUserOutlined';
import type { FeedJob } from '../types';
import { timeAgo } from '../utils/format';
import { BODY_FONT, DISPLAY_FONT, EASE, RADIUS, STITCH, tint } from '../tokens';

type Props = {
  job: FeedJob;
  selected?: boolean;
  frequencyLabel?: string;
  assigning?: boolean;
  onOpen?: (id: string) => void;
  onSave?: (id: string) => void;
  onUnsave?: (id: string) => void;
  onAssign?: (id: string) => void;
  onReport?: (id: string) => void;
};

/** Editorial job-wire row — not a LinkedIn-style card. */
export function FeedListCard({
  job,
  selected = false,
  frequencyLabel,
  assigning = false,
  onOpen,
  onSave,
  onUnsave,
  onAssign,
  onReport,
}: Props) {
  const posted = timeAgo(job.postedAt);
  const toggleSave = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (job.saved) onUnsave?.(job.id);
    else onSave?.(job.id);
  };

  return (
    <Box
      id={`feed-job-${job.id}`}
      onClick={() => onOpen?.(job.id)}
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      aria-expanded={onOpen ? selected : undefined}
      onKeyDown={(e) => {
        if (!onOpen) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(job.id);
        }
      }}
      sx={{
        display: 'grid',
        gridTemplateColumns: {
          xs: '40px 1fr auto',
          md: '56px 40px minmax(0, 1fr) 120px auto',
        },
        alignItems: 'center',
        columnGap: { xs: 1.25, md: 1.75 },
        rowGap: 0.5,
        px: { xs: 1.5, md: 2 },
        py: { xs: 1.35, md: 1.5 },
        cursor: onOpen ? 'pointer' : 'default',
        bgcolor: selected ? tint(STITCH.secondary, 0.1) : 'transparent',
        borderLeft: selected ? `3px solid ${STITCH.secondary}` : '3px solid transparent',
        transition: `background 180ms ${EASE}`,
        '&:hover': {
          bgcolor: selected ? tint(STITCH.secondary, 0.14) : tint(STITCH.primary, 0.04),
        },
        '&:focus-visible': {
          outline: `2px solid ${STITCH.secondary}`,
          outlineOffset: -2,
        },
      }}
    >
      <Typography
        sx={{
          display: { xs: 'none', md: 'block' },
          fontFamily: BODY_FONT,
          fontSize: '0.72rem',
          fontWeight: 700,
          letterSpacing: '0.02em',
          color: selected ? STITCH.secondaryDark : STITCH.muted,
          whiteSpace: 'nowrap',
        }}
      >
        {posted || 'now'}
      </Typography>

      <Box
        sx={{
          width: 40,
          height: 40,
          flexShrink: 0,
          borderRadius: RADIUS.sm,
          bgcolor: STITCH.surfaceLow,
          color: STITCH.primary,
          fontFamily: DISPLAY_FONT,
          fontWeight: 700,
          fontSize: '0.95rem',
          display: 'grid',
          placeItems: 'center',
          backgroundImage: job.logoUrl ? `url(${job.logoUrl})` : undefined,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          gridColumn: { xs: '1', md: '2' },
        }}
      >
        {!job.logoUrl && job.company.charAt(0)}
      </Box>

      <Box sx={{ minWidth: 0, gridColumn: { xs: '2', md: '3' } }}>
        <Typography
          sx={{
            fontFamily: DISPLAY_FONT,
            fontWeight: 650,
            fontSize: { xs: '0.95rem', md: '1.02rem' },
            lineHeight: 1.3,
            letterSpacing: '-0.015em',
            color: STITCH.primary,
          }}
        >
          {job.title}
        </Typography>
        <Typography
          sx={{
            mt: 0.2,
            fontSize: '0.78rem',
            color: STITCH.onSurfaceVariant,
            fontFamily: BODY_FONT,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {job.company}
          {job.location ? ` · ${job.location}` : ''}
          {job.workMode ? ` · ${job.workMode}` : ''}
        </Typography>
        <Stack
          direction="row"
          spacing={0.6}
          flexWrap="wrap"
          useFlexGap
          sx={{ mt: 0.65, display: { xs: 'flex', md: 'none' } }}
        >
          {job.h1bEligible && <SignalChip kind="h1b" />}
          {job.h1bFy2026Match && <SignalChip kind="fy" />}
          <Typography sx={{ fontSize: '0.68rem', fontWeight: 600, color: STITCH.muted, alignSelf: 'center' }}>
            {posted || 'Just added'}
            {frequencyLabel ? ` · ${frequencyLabel}` : ''}
          </Typography>
        </Stack>
      </Box>

      <Box sx={{ display: { xs: 'none', md: 'flex' }, flexDirection: 'column', alignItems: 'flex-end', gap: 0.45 }}>
        <Typography
          sx={{
            fontSize: '0.8rem',
            fontWeight: 700,
            color: STITCH.onSurface,
            fontFamily: BODY_FONT,
            textAlign: 'right',
          }}
        >
          {job.salary || '—'}
        </Typography>
        <Stack direction="row" spacing={0.5} justifyContent="flex-end" flexWrap="wrap" useFlexGap>
          {job.h1bEligible && <SignalChip kind="h1b" />}
          {job.h1bFy2026Match && <SignalChip kind="fy" />}
        </Stack>
      </Box>

      <Stack
        direction="row"
        alignItems="center"
        spacing={0.25}
        onClick={(e) => e.stopPropagation()}
        sx={{ justifyContent: 'flex-end' }}
      >
        {onAssign && (
          <Tooltip title={job.assigned ? 'Already in Application Incharge ScoutX Jobs' : 'Assign to Application Incharge ScoutX Jobs'}>
            <span>
              <Button
                size="small"
                disabled={assigning || job.assigned}
                startIcon={<AssignmentTurnedInOutlined sx={{ fontSize: '16px !important' }} />}
                onClick={() => onAssign(job.id)}
                sx={{
                  display: { xs: 'none', sm: 'inline-flex' },
                  textTransform: 'none',
                  fontWeight: 700,
                  fontSize: '0.75rem',
                  fontFamily: BODY_FONT,
                  color: job.assigned ? STITCH.onSurfaceVariant : STITCH.primary,
                  minWidth: 0,
                  px: 1,
                  py: 0.5,
                  borderRadius: RADIUS.control,
                  '&:hover': { bgcolor: tint(STITCH.secondary, 0.16) },
                }}
              >
                {assigning ? '…' : job.assigned ? 'Assigned' : 'Assign'}
              </Button>
            </span>
          </Tooltip>
        )}
        {onAssign && (
          <Tooltip title={job.assigned ? 'Already assigned' : 'Assign to ScoutX Jobs'}>
            <IconButton
              size="small"
              disabled={assigning || job.assigned}
              onClick={() => onAssign(job.id)}
              aria-label={job.assigned ? 'Already assigned' : 'Assign to ScoutX Jobs'}
              sx={{
                display: { xs: 'inline-flex', sm: 'none' },
                width: 40,
                height: 40,
                color: job.assigned ? STITCH.onSurfaceVariant : STITCH.primary,
              }}
            >
              <AssignmentTurnedInOutlined sx={{ fontSize: 20 }} />
            </IconButton>
          </Tooltip>
        )}
        {onReport && (
          <Tooltip title="Report this job">
            <IconButton
              size="small"
              onClick={() => onReport(job.id)}
              aria-label="Report job"
              sx={{
                width: 40,
                height: 40,
                color: STITCH.outline,
                '&:hover': { color: STITCH.error, bgcolor: tint(STITCH.error, 0.08) },
              }}
            >
              <FlagOutlined sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
        )}
        <IconButton
          size="small"
          onClick={toggleSave}
          aria-label={job.saved ? 'Unsave' : 'Save'}
          sx={{
            width: 44,
            height: 44,
            color: job.saved ? STITCH.primary : STITCH.outline,
            '&:hover': { color: STITCH.primary, bgcolor: tint(STITCH.secondary, 0.16) },
          }}
        >
          {job.saved ? <Bookmark sx={{ fontSize: 20 }} /> : <BookmarkBorder sx={{ fontSize: 20 }} />}
        </IconButton>
      </Stack>
    </Box>
  );
}

function SignalChip({ kind }: { kind: 'h1b' | 'fy' }) {
  const h1b = kind === 'h1b';
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.35,
        px: 0.75,
        py: 0.15,
        borderRadius: RADIUS.pill,
        bgcolor: h1b ? STITCH.secondaryContainer : tint(STITCH.primary, 0.08),
        color: h1b ? STITCH.onSecondaryContainer : STITCH.primary,
        fontSize: '0.65rem',
        fontWeight: 700,
        fontFamily: BODY_FONT,
        whiteSpace: 'nowrap',
      }}
    >
      {h1b ? <VerifiedUserOutlined sx={{ fontSize: 12 }} /> : <CheckCircleOutline sx={{ fontSize: 12 }} />}
      {h1b ? 'H-1B' : 'FY26'}
    </Box>
  );
}
