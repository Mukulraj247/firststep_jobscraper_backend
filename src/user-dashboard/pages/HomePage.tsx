import React, { useEffect, useState } from 'react';
import { Box, Button, Chip, Grid, Stack, Typography } from '@mui/material';
import ArrowForward from '@mui/icons-material/ArrowForward';
import BoltOutlined from '@mui/icons-material/BoltOutlined';
import BookmarkAdded from '@mui/icons-material/BookmarkAdded';
import CategoryOutlined from '@mui/icons-material/CategoryOutlined';
import ExploreOutlined from '@mui/icons-material/ExploreOutlined';
import HourglassTop from '@mui/icons-material/HourglassTop';
import TrendingUp from '@mui/icons-material/TrendingUp';
import TuneOutlined from '@mui/icons-material/TuneOutlined';
import Verified from '@mui/icons-material/Verified';
import { Link, useNavigate } from 'react-router-dom';
import { ClusterCard } from '../components/ClusterCard';
import { EmptyState } from '../components/EmptyState';
import { GlassHero } from '../components/GlassHero';
import { JobCard } from '../components/JobCard';
import { SectionHeading } from '../components/SectionHeading';
import { ClusterGridSkeleton, JobListSkeleton, StatRowSkeleton } from '../components/Skeletons';
import { StatCard } from '../components/StatCard';
import { useRequirePortalAuth } from '../hooks/usePortalAuth';
import { listClusters, listFeed, listRequests, listSaved, listSubscriptions, saveJob, unsaveJob } from '../mock/mockApi';
import type { Cluster, ClusterRequest, ClusterSubscription, FeedJob } from '../types';
import { FREQUENCY_LABEL } from '../types';
import { greetingFor, pluralize, timeUntil } from '../utils/format';
import {
  BODY_FONT,
  DISPLAY_FONT,
  RADIUS,
  STITCH,
  accentButtonSx,
  panelSx,
  primaryButtonSx,
} from '../tokens';

const RECOMMENDED_SLUGS = ['google-careers', 'meta-careers', 'banking-nj'];

export function HomePage() {
  const { user, loading } = useRequirePortalAuth();
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [subs, setSubs] = useState<ClusterSubscription[]>([]);
  const [savedCount, setSavedCount] = useState(0);
  const [feedCount, setFeedCount] = useState(0);
  const [latestJobs, setLatestJobs] = useState<FeedJob[]>([]);
  const [openRequests, setOpenRequests] = useState<ClusterRequest[]>([]);
  const [recommended, setRecommended] = useState<Cluster[]>([]);
  const [allClusters, setAllClusters] = useState<Cluster[]>([]);

  const load = React.useCallback(async () => {
    const [s, saved, feed, reqs, clusters] = await Promise.all([
      listSubscriptions(),
      listSaved(),
      listFeed('all', {}),
      listRequests(),
      listClusters(),
    ]);
    setSubs(s.filter((x) => x.status === 'active'));
    setSavedCount(saved.length);
    setFeedCount(feed.total);
    setLatestJobs(feed.jobs.slice(0, 4));
    setOpenRequests(reqs.filter((r) => r.status !== 'published' && r.status !== 'rejected'));
    setAllClusters(clusters);
    setRecommended(clusters.filter((c) => RECOMMENDED_SLUGS.includes(c.slug)));
    setReady(true);
  }, []);

  useEffect(() => {
    if (loading || !user) return;
    load();
  }, [user, loading, load]);

  if (loading || !user) return null;

  const subscribedIds = new Set(subs.map((s) => s.clusterId));
  const firstName = user.name.split(' ')[0];
  const nextSync = subs[0] ? timeUntil(subs[0].nextRefreshAt) : null;
  const h1bSavedHint =
    latestJobs.filter((j) => j.saved && j.h1bEligible).length ||
    (savedCount > 0 ? Math.min(2, savedCount) : 0);

  return (
    <Box>
      <GlassHero>
        <Stack
          direction={{ xs: 'column', lg: 'row' }}
          justifyContent="space-between"
          alignItems={{ lg: 'center' }}
          spacing={3}
        >
          <Box sx={{ maxWidth: 640 }}>
            <Box
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 0.75,
                px: 1.5,
                py: 0.5,
                borderRadius: RADIUS.pill,
                bgcolor: 'rgba(255,255,255,0.15)',
                backdropFilter: 'blur(8px)',
                mb: 1.5,
              }}
            >
              <Box sx={{ position: 'relative', width: 8, height: 8 }}>
                <Box
                  sx={{
                    position: 'absolute',
                    inset: 0,
                    borderRadius: '50%',
                    bgcolor: STITCH.secondaryFixed,
                    animation: 'pulse 1.6s ease-out infinite',
                    '@keyframes pulse': {
                      '0%': { transform: 'scale(1)', opacity: 0.75 },
                      '100%': { transform: 'scale(2.4)', opacity: 0 },
                    },
                  }}
                />
                <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: STITCH.secondaryFixed }} />
              </Box>
              <Typography
                sx={{
                  fontSize: '0.68rem',
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: STITCH.secondaryFixed,
                  fontFamily: BODY_FONT,
                }}
              >
                Continuous Pipeline Sync
              </Typography>
            </Box>
            <Typography
              component="h1"
              sx={{
                fontFamily: DISPLAY_FONT,
                fontWeight: 700,
                letterSpacing: '-0.03em',
                fontSize: { xs: '2rem', md: '3rem' },
                lineHeight: 1.1,
              }}
            >
              {greetingFor()}, {firstName}
            </Typography>
            <Typography sx={{ mt: 1, color: STITCH.primaryFixedDim, fontSize: '1rem', maxWidth: 520 }}>
              Your job clusters are actively monitored and refreshed every 1–2 hours.
              {nextSync && (
                <>
                  {' '}
                  Next sync{' '}
                  <Box
                    component="span"
                    sx={{
                      fontWeight: 700,
                      color: STITCH.onPrimary,
                      textDecoration: 'underline',
                      textDecorationColor: 'rgba(146,243,232,0.5)',
                      textUnderlineOffset: 4,
                    }}
                  >
                    {nextSync}
                  </Box>
                  .
                </>
              )}
            </Typography>
          </Box>
          <Stack direction="row" flexWrap="wrap" gap={1} useFlexGap>
            <Button
              component={Link}
              to="/user/clusters"
              variant="contained"
              disableElevation
              startIcon={<ExploreOutlined sx={{ fontSize: 20 }} />}
              sx={accentButtonSx}
            >
              Browse New Clusters
            </Button>
            <Button
              component={Link}
              to="/user/profile"
              startIcon={<TuneOutlined sx={{ fontSize: 20 }} />}
              sx={{
                borderRadius: RADIUS.control,
                fontWeight: 600,
                textTransform: 'none',
                px: 2.5,
                color: STITCH.onPrimary,
                bgcolor: 'rgba(255,255,255,0.15)',
                backdropFilter: 'blur(8px)',
                '&:hover': { bgcolor: 'rgba(255,255,255,0.25)' },
              }}
            >
              Configure Feed Alerts
            </Button>
          </Stack>
        </Stack>
      </GlassHero>

      {!ready ? (
        <StatRowSkeleton />
      ) : (
        <Grid container spacing={2}>
          <Grid item xs={6} md={3}>
            <StatCard
              label="Active Subscriptions"
              value={`${subs.length} ${pluralize(subs.length, 'Cluster')}`}
              icon={CategoryOutlined}
              accent="navy"
              to="/user/subscriptions"
              hint={
                <Stack direction="row" alignItems="center" spacing={0.75}>
                  <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: STITCH.secondary }} />
                  <Typography noWrap sx={{ fontSize: '0.8125rem', fontWeight: 500 }}>
                    {subs.map((s) => s.clusterName).join(' · ') || 'None yet'}
                  </Typography>
                </Stack>
              }
            />
          </Grid>
          <Grid item xs={6} md={3}>
            <StatCard
              label="Jobs in Last Window"
              value={`${feedCount} New`}
              icon={BoltOutlined}
              accent="teal"
              to="/user/feed"
              hint={
                <Stack direction="row" alignItems="center" spacing={0.5} sx={{ color: STITCH.secondary, fontWeight: 600 }}>
                  <TrendingUp sx={{ fontSize: 16 }} />
                  <span>+{Math.min(12, feedCount)} in last 2 hrs</span>
                </Stack>
              }
            />
          </Grid>
          <Grid item xs={6} md={3}>
            <StatCard
              label="Saved Jobs"
              value={`${savedCount} Stored`}
              icon={BookmarkAdded}
              accent="navy"
              to="/user/saved"
              hint={
                <Stack direction="row" alignItems="center" spacing={0.5}>
                  <Verified sx={{ fontSize: 16, color: STITCH.secondary }} />
                  <span>{h1bSavedHint} with H-1B Sponsor Signals</span>
                </Stack>
              }
            />
          </Grid>
          <Grid item xs={6} md={3}>
            <StatCard
              label="Custom Requests"
              value={`${openRequests.length} Review`}
              icon={HourglassTop}
              accent="amber"
              to="/user/requests"
              hint={
                <Typography noWrap sx={{ fontSize: '0.8125rem' }}>
                  {openRequests[0] ? `“${openRequests[0].title}” cluster` : 'No open requests'}
                </Typography>
              }
            />
          </Grid>
        </Grid>
      )}

      <Box sx={{ mt: 4 }}>
        <SectionHeading
          title="Your Active Subscriptions"
          actionLabel="Manage Plans"
          actionTo="/user/subscriptions"
        />
        <Typography sx={{ color: STITCH.onSurfaceVariant, fontSize: '0.8125rem', mt: -1, mb: 2 }}>
          Instant cluster pipelines delivery to your inbox &amp; portal feed
        </Typography>

        {!ready ? (
          <JobListSkeleton count={2} />
        ) : subs.length === 0 ? (
          <EmptyState
            icon={CategoryOutlined}
            title="No clusters yet"
            description="Pick a curated cluster and choose how often you want fresh roles delivered."
            actionLabel="Browse clusters"
            actionTo="/user/clusters"
          />
        ) : (
          <Grid container spacing={2.5}>
            {subs.map((sub) => {
              const cluster = allClusters.find((c) => c.id === sub.clusterId);
              return (
                <Grid item xs={12} lg={6} key={sub.id}>
                  <Box sx={{ ...panelSx, p: 3, height: '100%', display: 'flex', flexDirection: 'column' }}>
                    <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
                      <Box>
                        <Chip
                          icon={<BoltOutlined sx={{ fontSize: '14px !important' }} />}
                          label={`${FREQUENCY_LABEL[sub.frequency]} window`}
                          size="small"
                          sx={{
                            height: 26,
                            borderRadius: RADIUS.pill,
                            fontWeight: 700,
                            fontSize: '0.7rem',
                            bgcolor: STITCH.secondaryContainer,
                            color: STITCH.onSecondaryContainer,
                            '& .MuiChip-icon': { color: STITCH.onSecondaryContainer },
                          }}
                        />
                        <Typography
                          sx={{
                            mt: 1,
                            fontFamily: DISPLAY_FONT,
                            fontWeight: 600,
                            fontSize: '1.25rem',
                            color: STITCH.onSurface,
                          }}
                        >
                          {sub.clusterName}
                        </Typography>
                        <Typography sx={{ mt: 0.5, fontSize: '0.8125rem', color: STITCH.onSurfaceVariant }}>
                          {cluster?.description.slice(0, 110) || 'Curated job cluster'}…
                        </Typography>
                      </Box>
                      <Verified sx={{ color: STITCH.secondary, fontSize: 24, flexShrink: 0 }} />
                    </Stack>

                    <Grid container spacing={1.5} sx={{ mt: 2, p: 2, borderRadius: RADIUS.control, bgcolor: STITCH.surfaceLow }}>
                      <Grid item xs={6}>
                        <Typography sx={{ fontSize: '0.68rem', textTransform: 'uppercase', color: STITCH.onSurfaceVariant, fontWeight: 600 }}>
                          Total Live Pool
                        </Typography>
                        <Typography sx={{ fontFamily: DISPLAY_FONT, fontWeight: 600, fontSize: '1rem' }}>
                          {cluster?.jobCountPreview ?? '—'} active roles
                        </Typography>
                      </Grid>
                      <Grid item xs={6}>
                        <Typography sx={{ fontSize: '0.68rem', textTransform: 'uppercase', color: STITCH.onSurfaceVariant, fontWeight: 600 }}>
                          Next Refresh
                        </Typography>
                        <Typography sx={{ fontFamily: DISPLAY_FONT, fontWeight: 600, fontSize: '1rem', color: STITCH.secondary }}>
                          {timeUntil(sub.nextRefreshAt)}
                        </Typography>
                      </Grid>
                    </Grid>

                    {cluster && (
                      <Box sx={{ mt: 2 }}>
                        <Typography
                          sx={{
                            fontSize: '0.68rem',
                            fontWeight: 700,
                            letterSpacing: '0.08em',
                            textTransform: 'uppercase',
                            color: STITCH.onSurfaceVariant,
                            mb: 0.75,
                          }}
                        >
                          Monitored Portals
                        </Typography>
                        <Stack direction="row" flexWrap="wrap" gap={0.75}>
                          {cluster.filtersSummary.slice(0, 4).map((tag) => (
                            <Box
                              key={tag}
                              sx={{
                                px: 1.25,
                                py: 0.5,
                                borderRadius: '8px',
                                bgcolor: STITCH.surfaceContainer,
                                fontSize: '0.7rem',
                                fontWeight: 600,
                                color: STITCH.onSurface,
                              }}
                            >
                              {tag}
                            </Box>
                          ))}
                        </Stack>
                      </Box>
                    )}

                    <Stack
                      direction="row"
                      justifyContent="space-between"
                      alignItems="center"
                      sx={{ mt: 'auto', pt: 2.5 }}
                    >
                      <Button
                        component={Link}
                        to="/user/subscriptions"
                        size="small"
                        sx={{ textTransform: 'none', fontWeight: 600, color: STITCH.onSurfaceVariant }}
                      >
                        Adjust Frequency
                      </Button>
                      <Button
                        component={Link}
                        to={`/user/feed/${sub.id}`}
                        variant="contained"
                        disableElevation
                        endIcon={<ArrowForward sx={{ fontSize: 16 }} />}
                        sx={primaryButtonSx}
                      >
                        View Live Feed
                      </Button>
                    </Stack>
                  </Box>
                </Grid>
              );
            })}
          </Grid>
        )}
      </Box>

      <Box sx={{ mt: 4 }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          justifyContent="space-between"
          alignItems={{ sm: 'center' }}
          spacing={1}
          sx={{ mb: 2 }}
        >
          <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap>
            <Typography
              sx={{ fontFamily: DISPLAY_FONT, fontWeight: 600, fontSize: '1.5rem', color: STITCH.onSurface }}
            >
              Recent Jobs Discovered
            </Typography>
            <Chip
              label="Last 2 Hours"
              size="small"
              sx={{
                height: 24,
                borderRadius: RADIUS.pill,
                fontWeight: 700,
                fontSize: '0.7rem',
                bgcolor: STITCH.secondaryContainer,
                color: STITCH.onSecondaryContainer,
              }}
            />
          </Stack>
          <Button
            component={Link}
            to="/user/feed"
            endIcon={<ArrowForward sx={{ fontSize: 16 }} />}
            sx={{ textTransform: 'none', fontWeight: 700, color: STITCH.secondary }}
          >
            Open full stream ({feedCount})
          </Button>
        </Stack>
        {!ready ? (
          <JobListSkeleton count={3} />
        ) : latestJobs.length === 0 ? (
          <EmptyState
            icon={BoltOutlined}
            title="Nothing new in this window"
            description="Your clusters have not surfaced new roles since the last refresh."
            actionLabel="Browse clusters"
            actionTo="/user/clusters"
          />
        ) : (
          <Stack spacing={1.5}>
            {latestJobs.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                showCluster
                onOpen={(id) => navigate(`/user/jobs/${id}`)}
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
          </Stack>
        )}
      </Box>

      <Box sx={{ mt: 4 }}>
        <SectionHeading title="Recommended Clusters for You" actionLabel="See all" actionTo="/user/clusters" />
        {!ready ? (
          <ClusterGridSkeleton count={3} />
        ) : (
          <Grid container spacing={2}>
            {recommended.map((c) => (
              <Grid item xs={12} sm={6} lg={4} key={c.id}>
                <ClusterCard cluster={c} subscribed={subscribedIds.has(c.id)} />
              </Grid>
            ))}
          </Grid>
        )}
      </Box>
    </Box>
  );
}
