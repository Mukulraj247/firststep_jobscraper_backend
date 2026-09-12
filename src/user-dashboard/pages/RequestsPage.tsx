import React, { useEffect, useMemo, useState } from 'react';
import { Box, Button, Chip, Grid, Stack, Typography } from '@mui/material';
import AddCircleOutline from '@mui/icons-material/AddCircleOutline';
import EditNoteOutlined from '@mui/icons-material/EditNoteOutlined';
import { Link } from 'react-router-dom';
import { EmptyState } from '../components/EmptyState';
import { GlassHero } from '../components/GlassHero';
import { PanelSkeleton } from '../components/Skeletons';
import { useRequirePortalAuth } from '../hooks/usePortalAuth';
import { listRequests } from '../mock/mockApi';
import type { ClusterRequest } from '../types';
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
  published: 'Published',
  rejected: 'Rejected',
};

const STATUS_HINT: Record<ClusterRequest['status'], string> = {
  submitted: 'Queue status: Pending curator assignment.',
  in_review: 'Estimated live delivery: Tomorrow.',
  published: 'Your cluster is live — subscribe from the catalog.',
  rejected: 'We could not build this one — check notes from the team.',
};

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
  const [requests, setRequests] = useState<ClusterRequest[]>([]);
  const [ready, setReady] = useState(false);
  const [filter, setFilter] = useState<FilterKey>('all');

  useEffect(() => {
    if (loading) return;
    listRequests().then((list) => {
      setRequests(list);
      setReady(true);
    });
  }, [loading]);

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
                fontSize: { xs: '1.6rem', md: '2rem' },
                lineHeight: 1.15,
                color: STITCH.primaryContainer,
              }}
            >
              My Requests
            </Typography>
            <Typography sx={{ mt: 0.75, color: STITCH.muted }}>
              Custom clusters you&apos;ve asked us to build. We&apos;ll notify you here when one goes live — typically
              24–48 hours after dispatch.
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
            {visible.map((req) => (
              <Grid item xs={12} md={6} lg={4} key={req.id}>
                <Box sx={{ ...panelSx, p: 2.5, height: '100%', display: 'flex', flexDirection: 'column' }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
                    <Typography sx={{ fontFamily: DISPLAY_FONT, fontWeight: 700, color: STITCH.primary, fontSize: '1.05rem' }}>
                      {req.title}
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
                  <Typography sx={{ mt: 1, fontSize: '0.8125rem', color: STITCH.muted, flex: 1 }}>
                    {STATUS_HINT[req.status]}
                  </Typography>
                  <Stack direction="row" flexWrap="wrap" gap={0.5} sx={{ mt: 1.5 }}>
                    {[...req.industries, ...req.locations].slice(0, 4).map((tag) => (
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
                  </Stack>
                  <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 2 }}>
                    <Typography sx={{ fontSize: '0.72rem', color: STITCH.muted }}>
                      Submitted {new Date(req.submittedAt).toLocaleDateString()}
                    </Typography>
                    {req.status === 'published' ? (
                      <Button component={Link} to="/user/clusters" size="small" sx={{ ...primaryButtonSx, py: 0.5 }}>
                        View Active Cluster
                      </Button>
                    ) : (
                      <Button component={Link} to="/user/requests/new" size="small" sx={{ textTransform: 'none', fontWeight: 700, color: STITCH.secondary }}>
                        Track progress
                      </Button>
                    )}
                  </Stack>
                </Box>
              </Grid>
            ))}
          </Grid>
        </>
      )}
    </Box>
  );
}
