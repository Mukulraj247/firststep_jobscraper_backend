import React from 'react';
import {
  Avatar,
  Box,
  Button,
  Chip,
  Dialog,
  DialogContent,
  Divider,
  IconButton,
  Stack,
  Typography,
} from '@mui/material';
import BookmarkAdded from '@mui/icons-material/Bookmark';
import BookmarkBorder from '@mui/icons-material/BookmarkBorder';
import Close from '@mui/icons-material/Close';
import InfoOutlined from '@mui/icons-material/InfoOutlined';
import OpenInNew from '@mui/icons-material/OpenInNew';
import PaymentsOutlined from '@mui/icons-material/PaymentsOutlined';
import PlaceOutlined from '@mui/icons-material/PlaceOutlined';
import WorkOutline from '@mui/icons-material/WorkOutline';
import type { FeedJob } from '../types';
import { timeAgo } from '../utils/format';
import { BODY_FONT, FIRSTSTEP, RADIUS, ghostButtonSx, primaryButtonSx, tint } from '../tokens';

type Props = {
  job: FeedJob | null;
  open: boolean;
  onClose: () => void;
  onSave?: () => void;
  onUnsave?: () => void;
};

export function JobDetailDrawer({ job, open, onClose, onSave, onUnsave }: Props) {
  if (!job) return null;

  const facts = [
    job.location && { icon: PlaceOutlined, value: job.location },
    job.workMode && { icon: WorkOutline, value: job.workMode },
    job.salary && { icon: PaymentsOutlined, value: job.salary },
  ].filter(Boolean) as Array<{ icon: typeof PlaceOutlined; value: string }>;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{ sx: { borderRadius: { xs: 0, sm: RADIUS.panel }, m: { xs: 0, sm: 2 } } }}
    >
      <DialogContent sx={{ p: { xs: 2.5, md: 3 } }}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={2}>
          <Stack direction="row" spacing={2} sx={{ minWidth: 0 }}>
            <Avatar
              src={job.logoUrl}
              alt=""
              variant="rounded"
              sx={{
                width: 48,
                height: 48,
                flexShrink: 0,
                borderRadius: RADIUS.control,
                bgcolor: tint(FIRSTSTEP.navy, 0.07),
                color: FIRSTSTEP.navy,
                fontWeight: 700,
              }}
            >
              {job.company.charAt(0)}
            </Avatar>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="caption" sx={{ color: FIRSTSTEP.tealDark, fontWeight: 600 }}>
                {job.clusterName}
              </Typography>
              <Typography
                sx={{ fontWeight: 700, fontSize: '1.3rem', letterSpacing: '-0.02em', color: FIRSTSTEP.navyDeep, lineHeight: 1.25 }}
              >
                {job.title}
              </Typography>
              <Typography variant="body2" sx={{ color: FIRSTSTEP.navy, fontWeight: 600 }}>
                {job.company}
                <Box component="span" sx={{ fontWeight: 400, color: FIRSTSTEP.textMuted }}>
                  {' '}
                  · posted {timeAgo(job.postedAt)}
                </Box>
              </Typography>
            </Box>
          </Stack>
          <IconButton onClick={onClose} aria-label="Close" sx={{ flexShrink: 0 }}>
            <Close />
          </IconButton>
        </Stack>

        {facts.length > 0 && (
          <Stack
            direction="row"
            flexWrap="wrap"
            gap={{ xs: 1.5, sm: 2.5 }}
            sx={{ mt: 2 }}
            divider={<Divider orientation="vertical" flexItem sx={{ display: { xs: 'none', sm: 'block' } }} />}
          >
            {facts.map(({ icon: Icon, value }) => (
              <Stack key={value} direction="row" spacing={0.6} alignItems="center">
                <Icon sx={{ fontSize: 16, color: FIRSTSTEP.textMuted }} />
                <Typography variant="body2" sx={{ color: FIRSTSTEP.navy }}>
                  {value}
                </Typography>
              </Stack>
            ))}
          </Stack>
        )}

        {(job.h1bEligible || job.h1bFy2026Match) && (
          <Stack direction="row" flexWrap="wrap" gap={0.75} sx={{ mt: 1.75 }}>
            {job.h1bEligible && (
              <Chip
                label="H-1B sponsor signal"
                size="small"
                sx={{ borderRadius: RADIUS.pill, fontWeight: 600, bgcolor: tint(FIRSTSTEP.teal, 0.16), color: FIRSTSTEP.tealDark }}
              />
            )}
            {job.h1bFy2026Match && (
              <Chip
                label="FY2026 filing match"
                size="small"
                sx={{ borderRadius: RADIUS.pill, fontWeight: 600, bgcolor: tint(FIRSTSTEP.warning, 0.18), color: '#8a5a00' }}
              />
            )}
          </Stack>
        )}

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 2.5 }}>
          <Button
            variant="contained"
            disableElevation
            href={job.applyUrl}
            target="_blank"
            rel="noopener noreferrer"
            endIcon={<OpenInNew sx={{ fontSize: 16 }} />}
            sx={primaryButtonSx}
          >
            Apply on company site
          </Button>
          <Button
            variant="outlined"
            startIcon={job.saved ? <BookmarkAdded sx={{ fontSize: 18 }} /> : <BookmarkBorder sx={{ fontSize: 18 }} />}
            onClick={job.saved ? onUnsave : onSave}
            sx={{
              ...ghostButtonSx,
              ...(job.saved && { borderColor: FIRSTSTEP.teal, bgcolor: tint(FIRSTSTEP.teal, 0.1), color: FIRSTSTEP.tealDark }),
            }}
          >
            {job.saved ? 'Saved' : 'Save job'}
          </Button>
        </Stack>

        <Divider sx={{ my: 2.5 }} />

        <Typography
          variant="body2"
          sx={{ fontFamily: BODY_FONT, whiteSpace: 'pre-wrap', color: FIRSTSTEP.navy, lineHeight: 1.7 }}
        >
          {job.description}
        </Typography>

        <Stack
          direction="row"
          spacing={1.25}
          sx={{ mt: 2.5, p: 1.75, borderRadius: RADIUS.control, bgcolor: tint(FIRSTSTEP.warning, 0.08) }}
        >
          <InfoOutlined sx={{ fontSize: 17, color: '#8a5a00', flexShrink: 0, mt: 0.1 }} />
          <Typography variant="caption" sx={{ color: FIRSTSTEP.textMuted, lineHeight: 1.6 }}>
            ScoutText shows historical and filing signals, not guarantees. Always read the job posting before
            applying — a description stating &quot;will not sponsor&quot; overrides any badge.
          </Typography>
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
