import React from 'react';
import { Box, Button, Chip, IconButton, Tooltip, Typography } from '@mui/material';
import AssignmentTurnedInOutlined from '@mui/icons-material/AssignmentTurnedInOutlined';
import Bookmark from '@mui/icons-material/Bookmark';
import FlagOutlined from '@mui/icons-material/FlagOutlined';
import OpenInNew from '@mui/icons-material/OpenInNew';
import PlaceOutlined from '@mui/icons-material/PlaceOutlined';
import ScheduleOutlined from '@mui/icons-material/ScheduleOutlined';
import WorkOutlineOutlined from '@mui/icons-material/WorkOutlineOutlined';
import type { FeedJob } from '../types';
import { timeAgo } from '../utils/format';
import { stripTrackingParams } from '../utils/stripTrackingParams';
import { BODY_FONT, DISPLAY_FONT, EASE, MOTION_SAFE, STITCH, tint } from '../tokens';

type Props = {
  job: FeedJob;
  assigning?: boolean;
  onOpen?: (id: string) => void;
  onAssign?: (id: string) => void;
  onUnsave?: (id: string) => void;
  onReport?: (id: string) => void;
};

function truncateText(raw: string, max: number): string {
  const text = String(raw || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max).trim()}…`;
}

function companyInitials(name: string): string {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

/**
 * First Step Job Board–style card for ScoutX library / saved jobs.
 * Fixed min-height, dense chips, dual footer actions — matches FS JobBoard cards.
 */
export function LibraryJobCard({
  job,
  assigning = false,
  onOpen,
  onAssign,
  onUnsave,
  onReport,
}: Props) {
  const [logoFailed, setLogoFailed] = React.useState(false);
  React.useEffect(() => {
    setLogoFailed(false);
  }, [job.id, job.logoUrl]);
  const posted = timeAgo(job.postedAt);
  const skills = Array.isArray(job.skills) ? job.skills.filter(Boolean) : [];
  const description = truncateText(job.description || '', 140);
  const showLogo = Boolean(job.logoUrl) && !logoFailed;

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
        height: '100%',
        minHeight: 380,
        display: 'flex',
        flexDirection: 'column',
        borderRadius: '16px',
        border: `1px solid ${tint(STITCH.primary, 0.08)}`,
        boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
        bgcolor: STITCH.surfaceLowest,
        transition: `all 0.3s ${EASE}`,
        overflow: 'hidden',
        position: 'relative',
        cursor: onOpen ? 'pointer' : 'default',
        '&:hover': {
          [MOTION_SAFE]: { transform: 'translateY(-4px)' },
          boxShadow: `0 12px 32px ${tint(STITCH.primary, 0.12)}`,
          borderColor: tint(STITCH.primary, 0.2),
        },
        '&:focus-visible': {
          outline: `2px solid ${STITCH.secondary}`,
          outlineOffset: 2,
        },
      }}
    >
      {posted && (
        <Box
          sx={{
            position: 'absolute',
            top: 12,
            right: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
            px: 1,
            py: 0.25,
            borderRadius: '8px',
            bgcolor: tint(STITCH.secondary, 0.12),
            color: STITCH.secondaryDark,
            zIndex: 1,
          }}
        >
          <ScheduleOutlined sx={{ fontSize: 11 }} />
          <Typography sx={{ fontSize: '0.65rem', fontWeight: 600, fontFamily: BODY_FONT, lineHeight: 1.2 }}>
            {posted}
          </Typography>
        </Box>
      )}

      <Box
        sx={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          p: { xs: 2, sm: 2.5 },
        }}
      >
        <Typography
          sx={{
            fontFamily: DISPLAY_FONT,
            fontWeight: 700,
            fontSize: { xs: '0.85rem', sm: '0.9rem' },
            lineHeight: 1.3,
            mb: 0.8,
            pr: 5,
            color: STITCH.onSurface,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {job.title}
        </Typography>

        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mb: 1 }}>
          <Box
            sx={{
              width: 36,
              height: 36,
              borderRadius: '10px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              bgcolor: showLogo ? 'transparent' : tint(STITCH.primary, 0.08),
              border: `1px solid ${tint(STITCH.primary, 0.1)}`,
              overflow: 'hidden',
              flexShrink: 0,
            }}
          >
            {showLogo ? (
              <Box
                component="img"
                src={job.logoUrl}
                alt=""
                sx={{ width: '100%', height: '100%', objectFit: 'contain' }}
                onError={() => setLogoFailed(true)}
              />
            ) : (
              <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, color: STITCH.primary }}>
                {companyInitials(job.company)}
              </Typography>
            )}
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography
              sx={{
                fontWeight: 600,
                fontSize: '0.78rem',
                color: STITCH.onSurface,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontFamily: BODY_FONT,
              }}
            >
              {job.company}
            </Typography>
            {job.location && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4, mt: 0.2 }}>
                <PlaceOutlined sx={{ fontSize: 12, color: STITCH.muted, flexShrink: 0 }} />
                <Typography
                  sx={{
                    fontSize: '0.68rem',
                    color: STITCH.muted,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    fontFamily: BODY_FONT,
                  }}
                >
                  {job.location}
                </Typography>
              </Box>
            )}
          </Box>
        </Box>

        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1 }}>
          {job.jobCategory && job.jobCategory !== 'Other' && (
            <Chip
              label={job.jobCategory}
              size="small"
              sx={{
                height: 22,
                fontSize: '0.62rem',
                fontWeight: 600,
                bgcolor: tint(STITCH.primary, 0.06),
                color: STITCH.primary,
                border: `1px solid ${tint(STITCH.primary, 0.12)}`,
                '& .MuiChip-label': { px: 0.6 },
              }}
            />
          )}
          {job.jobType && (
            <Chip
              icon={<WorkOutlineOutlined sx={{ fontSize: '12px !important' }} />}
              label={job.jobType}
              size="small"
              sx={{
                height: 22,
                fontSize: '0.62rem',
                fontWeight: 600,
                bgcolor: tint('#0288d1', 0.07),
                color: '#01579b',
                border: `1px solid ${tint('#0288d1', 0.15)}`,
                '& .MuiChip-label': { px: 0.6 },
                '& .MuiChip-icon': { ml: 0.5, color: 'inherit' },
              }}
            />
          )}
          {job.workMode && (
            <Chip
              label={job.workMode}
              size="small"
              sx={{
                height: 22,
                fontSize: '0.62rem',
                fontWeight: 600,
                bgcolor: tint(STITCH.secondary, 0.1),
                color: STITCH.secondaryDark,
                border: `1px solid ${tint(STITCH.secondary, 0.2)}`,
                '& .MuiChip-label': { px: 0.6 },
              }}
            />
          )}
          {job.experience && (
            <Chip
              label={job.experience}
              size="small"
              sx={{
                height: 22,
                fontSize: '0.62rem',
                fontWeight: 600,
                bgcolor: tint(STITCH.secondary, 0.08),
                color: STITCH.secondaryDark,
                border: `1px solid ${tint(STITCH.secondary, 0.15)}`,
                '& .MuiChip-label': { px: 0.6 },
              }}
            />
          )}
          {job.h1bEligible && (
            <Chip
              label="H-1B signal"
              size="small"
              sx={{
                height: 22,
                fontSize: '0.62rem',
                fontWeight: 600,
                bgcolor: tint(STITCH.secondary, 0.14),
                color: STITCH.secondaryDark,
                border: `1px solid ${tint(STITCH.secondary, 0.25)}`,
                '& .MuiChip-label': { px: 0.6 },
              }}
            />
          )}
        </Box>

        {(job.salary || job.experience) && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1, flexWrap: 'wrap' }}>
            {job.salary && (
              <Typography sx={{ fontSize: '0.68rem', fontWeight: 600, color: STITCH.success }}>
                {job.salary}
              </Typography>
            )}
          </Box>
        )}

        {skills.length > 0 && (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.4, mb: 1 }}>
            {skills.slice(0, 4).map((skill) => (
              <Chip
                key={skill}
                label={skill}
                size="small"
                sx={{
                  height: 20,
                  fontSize: '0.6rem',
                  fontWeight: 600,
                  bgcolor: tint(STITCH.primary, 0.08),
                  color: STITCH.primaryDark,
                  border: `1px solid ${tint(STITCH.primary, 0.15)}`,
                  '& .MuiChip-label': { px: 0.7 },
                }}
              />
            ))}
            {skills.length > 4 && (
              <Tooltip title={skills.slice(4).join(', ')} arrow>
                <Chip
                  label={`+${skills.length - 4}`}
                  size="small"
                  sx={{
                    height: 20,
                    fontSize: '0.6rem',
                    fontWeight: 700,
                    bgcolor: tint(STITCH.secondary, 0.1),
                    color: STITCH.secondaryDark,
                    border: `1px solid ${tint(STITCH.secondary, 0.2)}`,
                    '& .MuiChip-label': { px: 0.7 },
                  }}
                />
              </Tooltip>
            )}
          </Box>
        )}

        {description && (
          <Typography
            sx={{
              fontSize: '0.7rem',
              color: STITCH.muted,
              lineHeight: 1.5,
              mb: 1,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              flex: 1,
              fontFamily: BODY_FONT,
            }}
          >
            {description}
          </Typography>
        )}

        <Box
          sx={{
            display: 'flex',
            gap: 1,
            pt: 1.5,
            borderTop: `1px solid ${tint(STITCH.outline, 0.35)}`,
            mt: 'auto',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <Button
            size="small"
            variant="outlined"
            href={stripTrackingParams(job.applyUrl)}
            target="_blank"
            rel="noopener noreferrer"
            endIcon={<OpenInNew sx={{ fontSize: 13 }} />}
            sx={{
              flex: 1,
              fontSize: '0.72rem',
              fontWeight: 600,
              textTransform: 'none',
              borderRadius: '10px',
              py: 0.5,
              borderColor: tint(STITCH.primary, 0.3),
              color: STITCH.primary,
              '&:hover': {
                borderColor: STITCH.primary,
                bgcolor: tint(STITCH.primary, 0.04),
              },
            }}
          >
            View
          </Button>
          {onAssign && (
            <Button
              size="small"
              variant="contained"
              disabled={assigning || job.assigned}
              startIcon={<AssignmentTurnedInOutlined sx={{ fontSize: 14 }} />}
              onClick={() => onAssign(job.id)}
              sx={{
                flex: 1,
                fontSize: '0.72rem',
                fontWeight: 600,
                textTransform: 'none',
                borderRadius: '10px',
                py: 0.5,
                bgcolor: STITCH.primary,
                boxShadow: 'none',
                '&:hover': { bgcolor: STITCH.primaryDark, boxShadow: 'none' },
                '&.Mui-disabled': {
                  bgcolor: tint(STITCH.primary, 0.25),
                  color: '#fff',
                },
              }}
            >
              {assigning ? '…' : job.assigned ? 'Assigned' : 'Assign'}
            </Button>
          )}
        </Box>

        <Box
          sx={{ display: 'flex', justifyContent: 'flex-end', gap: 0.25, mt: 0.75 }}
          onClick={(e) => e.stopPropagation()}
        >
          {onReport && (
            <Tooltip title="Report this job">
              <IconButton size="small" onClick={() => onReport(job.id)} aria-label="Report job">
                <FlagOutlined sx={{ fontSize: 16, color: STITCH.muted }} />
              </IconButton>
            </Tooltip>
          )}
          {onUnsave && (
            <Tooltip title="Remove from saved">
              <IconButton
                size="small"
                onClick={() => onUnsave(job.id)}
                aria-label="Remove from saved"
                sx={{
                  color: STITCH.secondaryDark,
                  bgcolor: tint(STITCH.secondary, 0.12),
                  '&:hover': { bgcolor: tint(STITCH.secondary, 0.2) },
                }}
              >
                <Bookmark sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
          )}
        </Box>
      </Box>
    </Box>
  );
}
