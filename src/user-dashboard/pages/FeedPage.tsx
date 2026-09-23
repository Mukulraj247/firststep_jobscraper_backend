import React, { useCallback, useEffect, useState } from 'react';
import { Box, Button, Chip, Grid, Stack, Typography } from '@mui/material';
import ChevronLeft from '@mui/icons-material/ChevronLeft';
import ChevronRight from '@mui/icons-material/ChevronRight';
import RssFeedOutlined from '@mui/icons-material/RssFeedOutlined';
import SearchOffOutlined from '@mui/icons-material/SearchOffOutlined';
import { useNavigate, useParams } from 'react-router-dom';
import { EmptyState } from '../components/EmptyState';
import { FeedFilterBar } from '../components/FeedFilterBar';
import { FeedJobCard } from '../components/FeedJobCard';
import { FeedJobModal } from '../components/FeedJobModal';
import { ReportJobDialog, type JobReportReason } from '../components/ReportJobDialog';
import { JobListSkeleton } from '../components/Skeletons';
import { useRequirePortalAuth } from '../hooks/usePortalAuth.tsx';
import { assignJob, getJob, reportJob, saveJob, unsaveJob } from '../api/portalApi';
import { usePortalFeed, usePortalSubscriptions } from '../hooks/portalQueries';
import type { DeliveryFrequency, FeedFilters, FeedJob } from '../types';
import { FREQUENCY_LABEL } from '../types';
import { countActiveFilters, pluralize } from '../utils/format';
import { BODY_FONT, DISPLAY_FONT, RADIUS, STITCH, ghostButtonSx, primaryButtonSx, tint } from '../tokens';
import { useGlobalInfoStore } from '../../context/globalInfo';

const FEED_PAGE_SIZE = 12;
/** After Assign succeeds, fade the card out then drop it from the visible list. */
const ASSIGN_FADE_MS = 2800;

export function FeedPage() {
  const { subscriptionId } = useParams<{ subscriptionId?: string }>();
  const navigate = useNavigate();
  const { notify } = useGlobalInfoStore();
  const { loading } = useRequirePortalAuth();
  const [activeSub, setActiveSub] = useState<string>('all');
  const [filters, setFilters] = useState<FeedFilters>({});
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedJob, setSelectedJob] = useState<FeedJob | null>(null);
  const [knownCompanies, setKnownCompanies] = useState<string[]>([]);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [fadingIds, setFadingIds] = useState<Set<string>>(() => new Set());
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => new Set());
  const [reportJobTarget, setReportJobTarget] = useState<FeedJob | null>(null);
  const [reporting, setReporting] = useState(false);

  const subKey = (subscriptionId || activeSub) as string;
  const { data: subsAll = [] } = usePortalSubscriptions(!loading);
  const subs = subsAll.filter((x) => x.status === 'active');
  const {
    data: feedData,
    isFetching,
    refetch: refetchFeed,
  } = usePortalFeed(subKey, filters, !loading, page, FEED_PAGE_SIZE);
  const jobs = feedData?.jobs || [];
  const total = feedData?.total ?? 0;
  const frequency: DeliveryFrequency = feedData?.frequency || '24h';
  const fetching = isFetching && !feedData;
  const totalPages = Math.max(1, Math.ceil(total / FEED_PAGE_SIZE));

  const visibleJobs = jobs.filter((j) => !hiddenIds.has(j.id));

  useEffect(() => {
    if (subscriptionId) setActiveSub(subscriptionId);
  }, [subscriptionId]);

  useEffect(() => {
    setPage(1);
    setHiddenIds(new Set());
    setFadingIds(new Set());
  }, [subKey, filters]);

  useEffect(() => {
    if (!jobs.length) return;
    setKnownCompanies((prev) => {
      const next = new Set(prev);
      for (const j of jobs) {
        if (j.company) next.add(j.company);
      }
      return [...next].sort((a, b) => a.localeCompare(b));
    });
  }, [jobs]);

  const load = useCallback(async () => {
    const result = await refetchFeed();
    return result.data?.jobs || [];
  }, [refetchFeed]);

  useEffect(() => {
    if (!selectedId) {
      setSelectedJob(null);
      return;
    }
    const fromList = jobs.find((j) => j.id === selectedId) || null;
    if (fromList) setSelectedJob(fromList);

    let cancelled = false;
    getJob(selectedId)
      .then((full) => {
        if (!cancelled) setSelectedJob(full);
      })
      .catch(() => {
        /* keep list payload */
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, jobs]);

  const openJob = (id: string) => {
    setSelectedId(id);
  };

  const closeJob = () => {
    setSelectedId(null);
    setSelectedJob(null);
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

  const scheduleRemoveAssigned = (id: string) => {
    setFadingIds((prev) => new Set(prev).add(id));
    window.setTimeout(() => {
      setHiddenIds((prev) => new Set(prev).add(id));
      setFadingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setSelectedId((cur) => (cur === id ? null : cur));
    }, ASSIGN_FADE_MS);
  };

  const handleAssign = async (id: string) => {
    setAssigningId(id);
    try {
      const result = await assignJob(id);
      notify(
        result.status === 'already_assigned' ? 'info' : 'success',
        result.message ||
          (result.status === 'already_assigned'
            ? 'Already in ScoutX Jobs'
            : 'Assigned to Application Incharge ScoutX Jobs'),
      );
      setSelectedJob((prev) => (prev?.id === id ? { ...prev, assigned: true } : prev));
      scheduleRemoveAssigned(id);
      void refetchFeed();
    } catch (err: any) {
      notify('error', err?.response?.data?.error || err?.message || 'Could not assign job');
    } finally {
      setAssigningId(null);
    }
  };

  const openReport = (id: string) => {
    const job = jobs.find((j) => j.id === id) || (selectedJob?.id === id ? selectedJob : null);
    if (job) setReportJobTarget(job);
  };

  const handleReportSubmit = async (payload: { reason: JobReportReason; note: string }) => {
    if (!reportJobTarget) return;
    setReporting(true);
    try {
      const result = await reportJob(reportJobTarget.id, payload);
      notify('success', result.message || 'Report submitted');
      setReportJobTarget(null);
    } catch (err: any) {
      notify('error', err?.response?.data?.error || err?.message || 'Could not submit report');
    } finally {
      setReporting(false);
    }
  };

  if (loading) return null;

  const freqLabel = FREQUENCY_LABEL[frequency];
  const filtersActive = countActiveFilters(filters) > 0;
  const currentSub = subscriptionId || activeSub;
  const showCluster = currentSub === 'all';

  return (
    <Box data-tour="scoutx-feed-page">
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        justifyContent="space-between"
        alignItems={{ md: 'flex-end' }}
        spacing={2}
        sx={{ mb: 2.5 }}
      >
        <Box>
          <Typography
            sx={{
              fontSize: '0.68rem',
              fontWeight: 700,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              color: STITCH.secondaryDark,
              fontFamily: BODY_FONT,
              mb: 0.5,
            }}
          >
            Job wire
          </Typography>
          <Typography
            component="h1"
            sx={{
              fontFamily: DISPLAY_FONT,
              fontWeight: 700,
              fontSize: { xs: '1.45rem', md: '1.75rem' },
              letterSpacing: '-0.03em',
              color: STITCH.primary,
              lineHeight: 1.1,
            }}
          >
            My Feed
          </Typography>
          <Typography sx={{ mt: 0.75, fontSize: '0.875rem', color: STITCH.muted, fontFamily: BODY_FONT, maxWidth: 560 }}>
            {fetching
              ? 'Loading roles from your subscribed clusters…'
              : `${total} ${pluralize(total, 'role')} from your subscribed clusters${
                  subs[0] ? ` · refresh on a ${freqLabel} cadence` : ''
                }.`}
          </Typography>
        </Box>
      </Stack>

      <Stack direction="row" flexWrap="wrap" gap={0.75} useFlexGap sx={{ mb: 2 }}>
        <Chip
          label={subs.length ? `All clusters (${subs.length})` : 'All clusters'}
          onClick={() => navigate('/user/feed')}
          sx={clusterChipSx(currentSub === 'all')}
        />
        {subs.map((s) => (
          <Chip
            key={s.id}
            label={s.clusterName}
            onClick={() => navigate(`/user/feed/${s.id}`)}
            sx={clusterChipSx(currentSub === s.id)}
          />
        ))}
      </Stack>

      <FeedFilterBar filters={filters} onChange={setFilters} companyOptions={knownCompanies} />

      {fetching ? (
        <JobListSkeleton count={6} />
      ) : visibleJobs.length === 0 ? (
        filtersActive ? (
          <EmptyState
            icon={SearchOffOutlined}
            variant="filtered"
            title="No jobs match these filters"
            description="Loosen a filter or clear them all to see everything from your clusters."
            actionLabel="Clear filters"
            onAction={() => setFilters({})}
          />
        ) : (
          <EmptyState
            icon={RssFeedOutlined}
            title="No jobs in this feed yet"
            description="Nothing has been posted to your subscribed clusters. Check back after the next refresh, or subscribe to another cluster for wider coverage."
            actionLabel="Browse clusters"
            actionTo="/user/clusters"
            secondaryLabel="View saved jobs"
            secondaryTo="/user/saved"
          />
        )
      ) : (
        <>
          <Typography
            sx={{
              mb: 1.5,
              fontSize: '0.75rem',
              fontWeight: 700,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: STITCH.muted,
              fontFamily: BODY_FONT,
            }}
          >
            Newest first
          </Typography>

          <Grid container spacing={2}>
            {visibleJobs.map((job) => (
              <Grid item xs={12} sm={6} lg={4} key={job.id}>
                <FeedJobCard
                  job={job}
                  showCluster={showCluster}
                  assigning={assigningId === job.id}
                  fadingOut={fadingIds.has(job.id)}
                  onOpen={openJob}
                  onAssign={handleAssign}
                  onReport={openReport}
                  onSave={async (id) => {
                    await saveJob(id);
                    load();
                  }}
                  onUnsave={async (id) => {
                    await unsaveJob(id);
                    load();
                  }}
                />
              </Grid>
            ))}
          </Grid>

          {total > 0 && (
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              alignItems={{ sm: 'center' }}
              justifyContent="space-between"
              spacing={1.5}
              sx={{
                mt: 3,
                px: 2,
                py: 1.5,
                borderRadius: RADIUS.card,
                border: `1px solid ${STITCH.outlineVariant}`,
                bgcolor: STITCH.surfaceLowest,
              }}
            >
              <Typography sx={{ fontSize: '0.8125rem', fontWeight: 600, color: STITCH.onSurface, fontFamily: BODY_FONT }}>
                {total} {pluralize(total, 'role')} · page {page} of {totalPages}
              </Typography>
              <Stack direction="row" spacing={1}>
                <Button
                  size="small"
                  variant="outlined"
                  disabled={page <= 1 || isFetching}
                  startIcon={<ChevronLeft sx={{ fontSize: 16 }} />}
                  onClick={() => {
                    setPage((p) => Math.max(1, p - 1));
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  sx={{ ...ghostButtonSx, py: 0.75, minWidth: 0 }}
                >
                  Prev
                </Button>
                <Button
                  size="small"
                  variant="contained"
                  disableElevation
                  disabled={page >= totalPages || isFetching}
                  endIcon={<ChevronRight sx={{ fontSize: 16 }} />}
                  onClick={() => {
                    setPage((p) => Math.min(totalPages, p + 1));
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  sx={{ ...primaryButtonSx, py: 0.75, minWidth: 0 }}
                >
                  Next
                </Button>
              </Stack>
            </Stack>
          )}
        </>
      )}

      <FeedJobModal
        open={Boolean(selectedId && selectedJob)}
        job={selectedJob}
        assigning={assigningId === selectedJob?.id}
        onClose={closeJob}
        onSave={handleSave}
        onUnsave={handleUnsave}
        onAssign={selectedJob ? () => handleAssign(selectedJob.id) : undefined}
        onReport={selectedJob ? () => openReport(selectedJob.id) : undefined}
      />

      <ReportJobDialog
        open={Boolean(reportJobTarget)}
        job={reportJobTarget}
        submitting={reporting}
        onClose={() => !reporting && setReportJobTarget(null)}
        onSubmit={handleReportSubmit}
      />
    </Box>
  );
}

function clusterChipSx(active: boolean) {
  return {
    height: 40,
    borderRadius: RADIUS.pill,
    fontWeight: 700,
    fontSize: '0.78rem',
    fontFamily: BODY_FONT,
    bgcolor: active ? STITCH.primary : STITCH.surfaceLowest,
    color: active ? '#fff' : STITCH.onSurface,
    border: active ? 'none' : `1px solid ${STITCH.outlineVariant}`,
    '&:hover': {
      bgcolor: active ? STITCH.primaryContainer : tint(STITCH.primary, 0.06),
    },
  } as const;
}
