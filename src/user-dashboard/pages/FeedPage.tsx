import React, { useCallback, useEffect, useState } from 'react';
import { Box, Grid, MenuItem, Stack, TextField, Typography, useMediaQuery, useTheme } from '@mui/material';
import BoltOutlined from '@mui/icons-material/BoltOutlined';
import RssFeedOutlined from '@mui/icons-material/RssFeedOutlined';
import SearchOffOutlined from '@mui/icons-material/SearchOffOutlined';
import VerifiedUserOutlined from '@mui/icons-material/VerifiedUserOutlined';
import { useNavigate, useParams } from 'react-router-dom';
import { EmptyState } from '../components/EmptyState';
import { FeedDetailPane } from '../components/FeedDetailPane';
import { FeedFilterBar } from '../components/FeedFilterBar';
import { FeedListCard } from '../components/FeedListCard';
import { JobDetailDrawer } from '../components/JobDetailDrawer';
import { JobListSkeleton } from '../components/Skeletons';
import { useRequirePortalAuth } from '../hooks/usePortalAuth';
import { getJob, listFeed, listSubscriptions, saveJob, unsaveJob } from '../mock/mockApi';
import type { ClusterSubscription, FeedFilters, FeedJob } from '../types';
import { FREQUENCY_LABEL } from '../types';
import { countActiveFilters, pluralize } from '../utils/format';
import { BODY_FONT, DISPLAY_FONT, RADIUS, STITCH, panelSx, tint } from '../tokens';

export function FeedPage() {
  const { subscriptionId } = useParams<{ subscriptionId?: string }>();
  const navigate = useNavigate();
  const theme = useTheme();
  const isSplit = useMediaQuery(theme.breakpoints.up('lg'));
  const { loading } = useRequirePortalAuth();
  const [subs, setSubs] = useState<ClusterSubscription[]>([]);
  const [activeSub, setActiveSub] = useState<string>('all');
  const [filters, setFilters] = useState<FeedFilters>({});
  const [jobs, setJobs] = useState<FeedJob[]>([]);
  const [fetching, setFetching] = useState(true);
  const [frequency, setFrequency] = useState<'1h' | '2h' | '24h'>('2h');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedJob, setSelectedJob] = useState<FeedJob | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const load = useCallback(async () => {
    const subKey = subscriptionId || activeSub;
    const result = await listFeed(subKey as string | 'all', filters);
    setJobs(result.jobs);
    setFrequency(result.frequency);
    setFetching(false);
    return result.jobs;
  }, [subscriptionId, activeSub, filters]);

  useEffect(() => {
    if (loading) return;
    listSubscriptions().then((s) => {
      setSubs(s.filter((x) => x.status === 'active'));
      if (subscriptionId) setActiveSub(subscriptionId);
    });
  }, [loading, subscriptionId]);

  useEffect(() => {
    if (loading) return;
    setFetching(true);
    load().then((list) => {
      if (list.length === 0) {
        setSelectedId(null);
        setSelectedJob(null);
        return;
      }
      setSelectedId((prev) => {
        if (prev && list.some((j) => j.id === prev)) return prev;
        return list[0].id;
      });
    });
  }, [loading, load]);

  useEffect(() => {
    if (!selectedId) {
      setSelectedJob(null);
      return;
    }
    const fromList = jobs.find((j) => j.id === selectedId);
    if (fromList) {
      setSelectedJob(fromList);
      return;
    }
    getJob(selectedId).then(setSelectedJob);
  }, [selectedId, jobs]);

  const openJob = async (id: string) => {
    setSelectedId(id);
    if (!isSplit) {
      const job = await getJob(id);
      setSelectedJob(job);
      setDrawerOpen(true);
    }
  };

  const handleSave = async () => {
    if (!selectedJob) return;
    setSelectedJob(await saveJob(selectedJob.id));
    load();
  };

  const handleUnsave = async () => {
    if (!selectedJob) return;
    setSelectedJob(await unsaveJob(selectedJob.id));
    load();
  };

  if (loading) return null;

  const freqLabel = FREQUENCY_LABEL[frequency];
  const filtersActive = countActiveFilters(filters) > 0;
  const h1bCount = jobs.filter((j) => j.h1bEligible || j.h1bFy2026Match).length;

  const listCards = (
    <Stack spacing={1.5}>
      {jobs.map((job) => (
        <FeedListCard
          key={job.id}
          job={job}
          selected={isSplit && job.id === selectedId}
          frequencyLabel={freqLabel}
          onOpen={openJob}
          onSave={async (id) => {
            await saveJob(id);
            load();
          }}
          onUnsave={async (id) => {
            await unsaveJob(id);
            load();
          }}
        />
      ))}
      {jobs.length > 0 && (
        <Box sx={{ p: 2, textAlign: 'center', borderRadius: RADIUS.card, bgcolor: STITCH.surfaceLow }}>
          <Typography sx={{ fontSize: '0.8125rem', fontWeight: 600, color: STITCH.onSurface, fontFamily: BODY_FONT }}>
            {Math.max(0, jobs.length > 4 ? jobs.length - 4 : 0) || 'More'} roles available in current {freqLabel} batch
          </Typography>
          <Typography sx={{ mt: 0.5, fontSize: '0.75rem', color: STITCH.secondary, fontWeight: 700, fontFamily: BODY_FONT }}>
            Load older deliveries
          </Typography>
        </Box>
      )}
    </Stack>
  );

  return (
    <Box>
      <Box
        sx={{
          ...panelSx,
          p: 2,
          mb: 2,
          display: 'flex',
          flexDirection: { xs: 'column', xl: 'row' },
          alignItems: { xl: 'center' },
          justifyContent: 'space-between',
          gap: 2,
        }}
      >
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25} alignItems={{ sm: 'center' }} sx={{ flex: 1, minWidth: 0 }}>
          <TextField
            select
            size="small"
            value={subscriptionId || activeSub}
            onChange={(e) => {
              const v = e.target.value;
              navigate(v === 'all' ? '/user/feed' : `/user/feed/${v}`);
            }}
            sx={{
              minWidth: { xs: '100%', sm: 280 },
              '& .MuiOutlinedInput-root': {
                borderRadius: RADIUS.control,
                bgcolor: STITCH.surfaceLow,
                fontFamily: BODY_FONT,
                fontWeight: 600,
                '& fieldset': { border: 'none' },
              },
            }}
          >
            <MenuItem value="all">
              All Subscribed
              {subs.length > 0 ? ` (${subs.map((s) => s.clusterName.split(' ')[0]).join(' + ')})` : ''}
            </MenuItem>
            {subs.map((s) => (
              <MenuItem key={s.id} value={s.id}>
                {s.clusterName}
              </MenuItem>
            ))}
          </TextField>

          <Stack
            direction="row"
            alignItems="center"
            spacing={1}
            sx={{ px: 2, py: 1.15, borderRadius: RADIUS.control, bgcolor: STITCH.surfaceLow }}
          >
            <Box sx={{ position: 'relative', width: 8, height: 8 }}>
              <Box
                sx={{
                  position: 'absolute',
                  inset: 0,
                  borderRadius: '50%',
                  bgcolor: STITCH.secondary,
                  animation: 'feedPulse 1.6s ease-out infinite',
                  '@keyframes feedPulse': {
                    '0%': { transform: 'scale(1)', opacity: 0.75 },
                    '100%': { transform: 'scale(2.4)', opacity: 0 },
                  },
                }}
              />
              <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: STITCH.secondary }} />
            </Box>
            <Typography sx={{ fontSize: '0.75rem', fontWeight: 500, color: STITCH.onSurfaceVariant, fontFamily: BODY_FONT }}>
              Refreshed every {freqLabel} · Showing jobs posted in last {freqLabel} (synced 14m ago)
            </Typography>
          </Stack>
        </Stack>

        {!fetching && (
          <Stack direction="row" spacing={1} flexShrink={0}>
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                px: 2,
                py: 1.25,
                borderRadius: RADIUS.control,
                bgcolor: STITCH.surfaceContainer,
              }}
            >
              <BoltOutlined sx={{ fontSize: 22, color: STITCH.primary }} />
              <Box>
                <Typography sx={{ fontFamily: DISPLAY_FONT, fontWeight: 700, fontSize: '1.15rem', lineHeight: 1.1, color: STITCH.primary }}>
                  {jobs.length}
                </Typography>
                <Typography sx={{ fontSize: '0.68rem', fontWeight: 600, color: STITCH.onSurfaceVariant, lineHeight: 1.2 }}>
                  {pluralize(jobs.length, 'job')} in this
                  <br />
                  window
                </Typography>
              </Box>
            </Box>
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                px: 2,
                py: 1.25,
                borderRadius: RADIUS.control,
                bgcolor: tint(STITCH.secondaryContainer, 0.5),
              }}
            >
              <VerifiedUserOutlined sx={{ fontSize: 22, color: STITCH.onSecondaryContainer }} />
              <Box>
                <Typography
                  sx={{
                    fontFamily: DISPLAY_FONT,
                    fontWeight: 700,
                    fontSize: '1.15rem',
                    lineHeight: 1.1,
                    color: STITCH.onSecondaryContainer,
                  }}
                >
                  {h1bCount}
                </Typography>
                <Typography sx={{ fontSize: '0.68rem', fontWeight: 600, color: STITCH.onSecondaryContainer, lineHeight: 1.2 }}>
                  H-1B friendly
                  <br />
                  matches
                </Typography>
              </Box>
            </Box>
          </Stack>
        )}
      </Box>

      <FeedFilterBar filters={filters} onChange={setFilters} />

      {fetching ? (
        <JobListSkeleton count={5} />
      ) : jobs.length === 0 ? (
        filtersActive ? (
          <EmptyState
            icon={SearchOffOutlined}
            variant="filtered"
            title="No jobs match these filters"
            description="Loosen a filter or clear them all to see everything from this refresh window."
            actionLabel="Clear filters"
            onAction={() => setFilters({})}
          />
        ) : (
          <EmptyState
            icon={RssFeedOutlined}
            title="No new jobs in this window"
            description={`Nothing new has been posted in the last ${freqLabel}. Check back after the next refresh, or subscribe to another cluster for wider coverage.`}
            actionLabel="Browse clusters"
            actionTo="/user/clusters"
            secondaryLabel="View saved jobs"
            secondaryTo="/user/saved"
          />
        )
      ) : isSplit ? (
        <Grid container spacing={2.5} alignItems="flex-start">
          <Grid item xs={12} lg={5}>
            {listCards}
          </Grid>
          <Grid item xs={12} lg={7}>
            <FeedDetailPane job={selectedJob} onSave={handleSave} onUnsave={handleUnsave} />
          </Grid>
        </Grid>
      ) : (
        <>
          {listCards}
          <JobDetailDrawer
            job={selectedJob}
            open={drawerOpen}
            onClose={() => setDrawerOpen(false)}
            onSave={handleSave}
            onUnsave={handleUnsave}
          />
        </>
      )}
    </Box>
  );
}
