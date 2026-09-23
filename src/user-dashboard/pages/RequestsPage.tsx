import React, { useMemo, useState } from 'react';
import { Box, Button, Chip, Grid, Stack, Step, StepLabel, Stepper, Typography } from '@mui/material';
import AddCircleOutline from '@mui/icons-material/AddCircleOutline';
import EditNoteOutlined from '@mui/icons-material/EditNoteOutlined';
import { Link } from 'react-router-dom';
import { EmptyState } from '../components/EmptyState';
import { GlassHero } from '../components/GlassHero';
import { PanelSkeleton } from '../components/Skeletons';
import { useRequirePortalAuth } from '../hooks/usePortalAuth.tsx';
import { usePortalClusters, usePortalRequests } from '../hooks/portalQueries';
import type { ClusterRequest } from '../types';
import { humanLabel } from '../utils/displayLabels';
import {
  BODY_FONT,
  DISPLAY_FONT,
  RADIUS,
  STITCH,
  accentButtonSx,
  panelSx,
  primaryButtonSx,
  tint,
} from '../tokens';

const STATUS_LABEL: Record<ClusterRequest['status'], string> = {
  submitted: 'Submitted',
  in_review: 'In Review',
  published: 'Live',
  rejected: 'Rejected',
};

const STATUS_HINT: Record<ClusterRequest['status'], string> = {
  submitted: 'Our team has your request — triage usually starts within a day.',
  in_review: 'Ops is configuring automations and filters for your companies.',
  published: 'Your cluster is live — open it from the catalog or your feed.',
  rejected: 'We could not build this one — check notes from the team.',
};

const TIMELINE_STEPS = ['Submitted', 'In review', 'Live'] as const;

function timelineActiveStep(status: ClusterRequest['status']): number {
  if (status === 'published') return 2;
  if (status === 'in_review') return 1;
  if (status === 'rejected') return 0;
  return 0;
}

const statusChipSx = (status: ClusterRequest['status']) => {
  switch (status) {
    case 'published':
      return { bgcolor: tint(STITCH.success, 0.16), color: STITCH.success };
    case 'in_review':
      return { bgcolor: tint(STITCH.warning, 0.18), color: '#8a5a00' };
    case 'rejected':
      return { bgcolor: STITCH.errorContainer, color: STITCH.error };
    default:
      return { bgcolor: STITCH.surfaceContainer, color: STITCH.onSurfaceVariant };
  }
};

type FilterKey = 'all' | 'published' | 'pipeline';

export function RequestsPage() {
  const { loading } = useRequirePortalAuth();
  const { data: requests = [], isLoading } = usePortalRequests(!loading);
  const { data: clusters = [] } = usePortalClusters(!loading);
  const ready = !isLoading;
  const [filter, setFilter] = useState<FilterKey>('all');

  const pipeline = useMemo(
    () => requests.filter((r) => r.status === 'submitted' || r.status === 'in_review'),
    [requests],
  );
  const published = useMemo(() => requests.filter((r) => r.status === 'published'), [requests]);

  const visible = useMemo(() => {
    if (filter === 'published') return published;
    if (filter === 'pipeline') return pipeline;
    return requests;
  }, [filter, requests, published, pipeline]);

  const clusterSlugFor = (req: ClusterRequest) => {
    if (!req.resultClusterId) return null;
    return clusters.find((c) => c.id === req.resultClusterId)?.slug || null;
  };

  if (loading) return null;

  return (
    <Box>
      <GlassHero dense>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          justifyContent="space-between"
          alignItems={{ md: 'center' }}
          spacing={2}
        >
          <Box sx={{ maxWidth: 640 }}>
            <Typography
              sx={{
                fontSize: '0.68rem',
                fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: STITCH.primaryContainer,
                fontFamily: BODY_FONT,
                mb: 1,
              }}
            >
              Cluster studio
            </Typography>
            <Typography
              component="h1"
              sx={{
                fontFamily: DISPLAY_FONT,
                fontWeight: 700,
                letterSpacing: '-0.03em',
                fontSize: { xs: '1.45rem', md: '1.7rem' },
                lineHeight: 1.15,
                color: STITCH.primaryContainer,
              }}
            >
              My Requests
            </Typography>
            <Typography sx={{ mt: 0.75, color: STITCH.muted }}>
              Custom clusters you&apos;ve asked us to build. Track progress here — typically live within
              24–48 hours after triage.
            </Typography>
          </Box>
          <Button
            component={Link}
            to="/user/requests/new"
            variant="contained"
            disableElevation
            startIcon={<AddCircleOutline sx={{ fontSize: 18 }} />}
            sx={{ ...accentButtonSx, flexShrink: 0 }}
          >
            Create Custom Role Cluster
          </Button>
        </Stack>
      </GlassHero>

      {!ready ? (
        <Stack spacing={1.5}>
          <PanelSkeleton height={116} />
          <PanelSkeleton height={116} />
        </Stack>
      ) : requests.length === 0 ? (
        <EmptyState
          icon={EditNoteOutlined}
          title="No requests yet"
          description="If none of the curated clusters fit your search, describe the roles, companies and locations you want and we'll build one for you."
          actionLabel="Request a cluster"
          actionTo="/user/requests/new"
          secondaryLabel="Browse clusters"
          secondaryTo="/user/clusters"
        />
      ) : (
        <>
          <Stack direction="row" flexWrap="wrap" gap={0.75} sx={{ mb: 2.5 }}>
            {(
              [
                ['all', `All (${requests.length})`],
                ['published', `Active Feed (${published.length})`],
                ['pipeline', `In Pipeline (${pipeline.length})`],
              ] as const
            ).map(([key, label]) => {
              const on = filter === key;
              return (
                <Chip
                  key={key}
                  label={label}
                  onClick={() => setFilter(key)}
                  sx={{
                    borderRadius: RADIUS.pill,
                    fontWeight: on ? 700 : 500,
                    bgcolor: on ? STITCH.primaryContainer : STITCH.surfaceLowest,
                    color: on ? STITCH.onPrimary : STITCH.muted,
                    boxShadow: on ? 'none' : `inset 0 0 0 1px ${STITCH.outlineVariant}`,
                  }}
                />
              );
            })}
          </Stack>

          <Typography sx={{ fontFamily: DISPLAY_FONT, fontWeight: 600, fontSize: '1.15rem', mb: 1.5, color: STITCH.onSurface }}>
            My Existing Requests
          </Typography>

          <Grid container spacing={2}>
            {visible.map((req) => {
              const slug = clusterSlugFor(req);
              const title = humanLabel(req.title, 'Custom cluster request');
              const tags = [
                ...(req.roles || []).slice(0, 3),
                ...(req.industries || []).slice(0, 2),
                ...(req.locations || []).slice(0, 2),
              ].filter((t) => humanLabel(t, '') !== '');
              return (
                <Grid item xs={12} md={6} lg={4} key={req.id}>
                  <Box sx={{ ...panelSx, p: 2.5, height: '100%', display: 'flex', flexDirection: 'column' }}>
                    <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
                      <Typography sx={{ fontFamily: DISPLAY_FONT, fontWeight: 700, color: STITCH.primary, fontSize: '1.05rem' }}>
                        {title}
                      </Typography>
                      <Chip
                        label={STATUS_LABEL[req.status]}
                        size="small"
                        sx={{
                          height: 22,
                          borderRadius: RADIUS.pill,
                          fontWeight: 700,
                          fontSize: '0.68rem',
                          ...statusChipSx(req.status),
                        }}
                      />
                    </Stack>
                    <Typography sx={{ mt: 1, fontSize: '0.8125rem', color: STITCH.muted }}>
                      {STATUS_HINT[req.status]}
                    </Typography>

                    {req.status !== 'rejected' && (
                      <Stepper
                        activeStep={timelineActiveStep(req.status)}
                        alternativeLabel
                        sx={{
                          mt: 1.5,
                          mb: 0.5,
                          '& .MuiStepLabel-label': { fontSize: '0.68rem', fontWeight: 600 },
                          '& .MuiStepIcon-root.Mui-active, & .MuiStepIcon-root.Mui-completed': {
                            color: STITCH.secondary,
                          },
                        }}
                      >
                        {TIMELINE_STEPS.map((label) => (
                          <Step key={label} completed={timelineActiveStep(req.status) > TIMELINE_STEPS.indexOf(label)}>
                            <StepLabel>{label}</StepLabel>
                          </Step>
                        ))}
                      </Stepper>
                    )}

                    <Stack direction="row" flexWrap="wrap" gap={0.5} sx={{ mt: 1.5 }}>
                      {tags.slice(0, 5).map((tag) => (
                        <Chip
                          key={tag}
                          label={tag}
                          size="small"
                          sx={{
                            height: 22,
                            fontSize: '0.68rem',
                            bgcolor: STITCH.surfaceContainer,
                            color: STITCH.onSurface,
                            border: 'none',
                          }}
                        />
                      ))}
                      {req.urls && req.urls.length > 0 && (
                        <Chip
                          label={`${req.urls.length} URL${req.urls.length === 1 ? '' : 's'}`}
                          size="small"
                          sx={{
                            height: 22,
                            fontSize: '0.68rem',
                            bgcolor: tint(STITCH.secondary, 0.14),
                            color: STITCH.primary,
                            border: 'none',
                          }}
                        />
                      )}
                    </Stack>
                    <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 'auto', pt: 2 }}>
                      <Typography sx={{ fontSize: '0.72rem', color: STITCH.muted }}>
                        Submitted {new Date(req.submittedAt).toLocaleDateString()}
                      </Typography>
                      {req.status === 'published' ? (
                        <Button
                          component={Link}
                          to={slug ? `/user/clusters/${slug}` : '/user/clusters'}
                          size="small"
                          sx={{ ...primaryButtonSx, py: 0.5 }}
                        >
                          View cluster
                        </Button>
                      ) : req.status === 'rejected' ? (
                        <Button
                          component={Link}
                          to="/user/requests/new"
                          size="small"
                          sx={{ textTransform: 'none', fontWeight: 700, color: STITCH.secondary }}
                        >
                          Submit again
                        </Button>
                      ) : (
                        <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: STITCH.secondary }}>
                          Tracking…
                        </Typography>
                      )}
                    </Stack>
                  </Box>
                </Grid>
              );
            })}
          </Grid>
        </>
      )}
    </Box>
  );
}
