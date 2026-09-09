import React, { useEffect, useState } from 'react';
import { Avatar, Box, Button, Chip, Divider, Stack, Typography } from '@mui/material';
import ArrowBack from '@mui/icons-material/ArrowBack';
import BookmarkAdded from '@mui/icons-material/Bookmark';
import BookmarkBorder from '@mui/icons-material/BookmarkBorder';
import InfoOutlined from '@mui/icons-material/InfoOutlined';
import OpenInNew from '@mui/icons-material/OpenInNew';
import PaymentsOutlined from '@mui/icons-material/PaymentsOutlined';
import PlaceOutlined from '@mui/icons-material/PlaceOutlined';
import ScheduleOutlined from '@mui/icons-material/ScheduleOutlined';
import WorkOutline from '@mui/icons-material/WorkOutline';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useRequirePortalAuth } from '../hooks/usePortalAuth';
import { getJob, saveJob, unsaveJob } from '../mock/mockApi';
import type { FeedJob } from '../types';
import { timeAgo } from '../utils/format';
import { BODY_FONT, FIRSTSTEP, RADIUS, ghostButtonSx, panelSx, primaryButtonSx, tint } from '../tokens';

export function JobDetailPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const { loading } = useRequirePortalAuth();
  const [job, setJob] = useState<FeedJob | null>(null);

  useEffect(() => {
    if (loading || !jobId) return;
    getJob(jobId).then(setJob);
  }, [jobId, loading]);

  if (loading || !job) return null;

  const toggleSave = async () => setJob(job.saved ? await unsaveJob(job.id) : await saveJob(job.id));

  const facts = [
    job.location && { icon: PlaceOutlined, label: 'Location', value: job.location },
    job.workMode && { icon: WorkOutline, label: 'Work mode', value: job.workMode },
    job.salary && { icon: PaymentsOutlined, label: 'Compensation', value: job.salary },
    job.experience && { icon: ScheduleOutlined, label: 'Experience', value: job.experience },
  ].filter(Boolean) as Array<{ icon: typeof PlaceOutlined; label: string; value: string }>;

  return (
    <Box sx={{ maxWidth: 820, mx: 'auto' }}>
      <Button
        onClick={() => navigate(-1)}
        startIcon={<ArrowBack sx={{ fontSize: 17 }} />}
        sx={{ mb: 1.5, textTransform: 'none', fontWeight: 600, color: FIRSTSTEP.textMuted, '&:hover': { color: FIRSTSTEP.navy } }}
      >
        Back
      </Button>

      <Box sx={{ ...panelSx, p: { xs: 2.5, md: 3 } }}>
        <Stack direction="row" spacing={2} alignItems="flex-start">
          <Avatar
            src={job.logoUrl}
            alt=""
            variant="rounded"
            sx={{
              width: 56,
              height: 56,
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
            <Typography
              component="h1"
              sx={{ fontWeight: 700, letterSpacing: '-0.03em', fontSize: { xs: '1.4rem', md: '1.75rem' }, lineHeight: 1.2, color: FIRSTSTEP.navyDeep }}
            >
              {job.title}
            </Typography>
            <Typography sx={{ fontWeight: 600, color: FIRSTSTEP.navy, mt: 0.5 }}>{job.company}</Typography>
            <Typography variant="caption" sx={{ color: FIRSTSTEP.textMuted }}>
              Posted {timeAgo(job.postedAt)} · via{' '}
              <Box component={Link} to="/user/feed" sx={{ color: FIRSTSTEP.tealDark, fontWeight: 600, textDecoration: 'none' }}>
                {job.clusterName}
              </Box>
            </Typography>
          </Box>
        </Stack>

        <Stack direction="row" flexWrap="wrap" gap={0.75} sx={{ mt: 2 }}>
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
          {job.sectorIndustry && (
            <Chip
              label={job.sectorIndustry}
              size="small"
              variant="outlined"
              sx={{ borderRadius: RADIUS.pill, color: FIRSTSTEP.textMuted, borderColor: FIRSTSTEP.border }}
            />
          )}
        </Stack>

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
            onClick={toggleSave}
            sx={{
              ...ghostButtonSx,
              ...(job.saved && { borderColor: FIRSTSTEP.teal, bgcolor: tint(FIRSTSTEP.teal, 0.1), color: FIRSTSTEP.tealDark }),
            }}
          >
            {job.saved ? 'Saved' : 'Save job'}
          </Button>
        </Stack>
      </Box>

      {facts.length > 0 && (
        <Box sx={{ ...panelSx, p: { xs: 2, md: 2.5 }, mt: 2 }}>
          <Stack
            direction="row"
            flexWrap="wrap"
            divider={<Divider orientation="vertical" flexItem sx={{ display: { xs: 'none', sm: 'block' } }} />}
            sx={{ gap: { xs: 1.75, sm: 3 } }}
          >
            {facts.map(({ icon: Icon, label, value }) => (
              <Stack key={label} direction="row" spacing={1.25} alignItems="center">
                <Icon sx={{ fontSize: 18, color: FIRSTSTEP.tealDark }} />
                <Box>
                  <Typography variant="caption" sx={{ color: FIRSTSTEP.textMuted, display: 'block', lineHeight: 1.2 }}>
                    {label}
                  </Typography>
                  <Typography variant="body2" sx={{ fontWeight: 600, color: FIRSTSTEP.navyDeep }}>
                    {value}
                  </Typography>
                </Box>
              </Stack>
            ))}
          </Stack>
        </Box>
      )}

      <Box sx={{ ...panelSx, p: { xs: 2.5, md: 3 }, mt: 2 }}>
        <Typography sx={{ fontWeight: 700, color: FIRSTSTEP.navyDeep, mb: 1.5 }}>About this role</Typography>
        <Typography
          sx={{ fontFamily: BODY_FONT, whiteSpace: 'pre-wrap', color: FIRSTSTEP.navy, lineHeight: 1.7, fontSize: '0.92rem' }}
        >
          {job.description}
        </Typography>
      </Box>

      <Stack
        direction="row"
        spacing={1.25}
        sx={{ mt: 2, p: 2, borderRadius: RADIUS.card, bgcolor: tint(FIRSTSTEP.warning, 0.08) }}
      >
        <InfoOutlined sx={{ fontSize: 18, color: '#8a5a00', flexShrink: 0, mt: 0.15 }} />
        <Typography variant="body2" sx={{ color: FIRSTSTEP.textMuted }}>
          ScoutText shows historical and filing signals, not guarantees. Always read the original posting before
          applying.
        </Typography>
      </Stack>
    </Box>
  );
}
