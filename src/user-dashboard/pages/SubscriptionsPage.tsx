import React, { useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Grid,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import PauseCircleOutline from '@mui/icons-material/PauseCircleOutline';
import PlayCircleOutline from '@mui/icons-material/PlayCircleOutline';
import RssFeedOutlined from '@mui/icons-material/RssFeedOutlined';
import SubscriptionsOutlined from '@mui/icons-material/SubscriptionsOutlined';
import { Link } from 'react-router-dom';
import { EmptyState } from '../components/EmptyState';
import { GlassHero } from '../components/GlassHero';
import { SectionHeading } from '../components/SectionHeading';
import { PanelSkeleton } from '../components/Skeletons';
import { SlotLock } from '../components/SlotLock';
import { useRequirePortalAuth } from '../hooks/usePortalAuth.tsx';
import {
  cancelSubscription,
  changeFrequency,
  pauseSubscription,
  resumeSubscription,
  startClusterService,
} from '../api/portalApi';
import {
  invalidatePortalShell,
  usePortalClusters,
  usePortalEntitlements,
  usePortalSubscriptions,
} from '../hooks/portalQueries';
import type { DeliveryFrequency, ClusterSubscription } from '../types';
import { FREQUENCY_LABEL } from '../types';
import { humanLabel } from '../utils/displayLabels';
import { timeUntil } from '../utils/format';
import {
  BODY_FONT,
  DISPLAY_FONT,
  FIRSTSTEP,
  RADIUS,
  STITCH,
  ghostButtonSx,
  panelSx,
  primaryButtonSx,
  tint,
} from '../tokens';
import { useGlobalInfoStore } from '../../context/globalInfo';
import BoltOutlined from '@mui/icons-material/BoltOutlined';
import { useQueryClient } from '@tanstack/react-query';

export function SubscriptionsPage() {
  const { loading } = useRequirePortalAuth();
  const { notify } = useGlobalInfoStore();
  const queryClient = useQueryClient();
  const enabled = !loading;
  const { data: subs = [], isLoading: subsLoading, refetch: refetchSubs } = usePortalSubscriptions(enabled);
  const { data: clusters = [] } = usePortalClusters(enabled);
  const { data: entitlements = null, refetch: refetchEnts } = usePortalEntitlements(enabled);
  const ready = !subsLoading;
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [slotFull, setSlotFull] = useState(false);

  const clusterFor = (clusterId: string) => clusters.find((c) => c.id === clusterId);

  const load = async () => {
    await invalidatePortalShell(queryClient);
    await Promise.all([refetchSubs(), refetchEnts()]);
  };

  if (loading) return null;

  const active = subs.filter((s) => s.status === 'active');
  const inactive = subs.filter((s) => s.status !== 'active');
  const needsStart =
    Boolean(entitlements) &&
    (entitlements?.maxActiveClusters ?? 0) > 0 &&
    !entitlements?.clusterServiceStarted;
  const planLabel =
    entitlements?.subscriptionTypeDisplay || entitlements?.subscriptionType || 'plan';

  const handleStart = async () => {
    setStarting(true);
    try {
      await startClusterService();
      await load();
      notify('success', 'Cluster monitoring started');
    } catch (err: any) {
      notify('error', err?.response?.data?.error || err?.message || 'Could not start');
    } finally {
      setStarting(false);
    }
  };

  const renderCard = (sub: ClusterSubscription) => {
    const paused = sub.status !== 'active';
    const matched = clusterFor(sub.clusterId);
    const slug = matched?.slug ?? '';
    const name = humanLabel(sub.clusterName || matched?.name, 'Custom cluster');

    return (
      <Box key={sub.id} sx={{ ...panelSx, p: { xs: 2, md: 2.25 }, height: '100%', opacity: paused ? 0.82 : 1 }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          justifyContent="space-between"
          alignItems={{ sm: 'flex-start' }}
          spacing={1}
        >
          <Box sx={{ minWidth: 0 }}>
            <Stack direction="row" alignItems="center" spacing={1}>
              <Box
                aria-hidden
                sx={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  flexShrink: 0,
                  bgcolor: paused ? FIRSTSTEP.warning : FIRSTSTEP.success,
                  boxShadow: `0 0 0 3px ${tint(paused ? FIRSTSTEP.warning : FIRSTSTEP.success, 0.18)}`,
                }}
              />
              <Typography sx={{ fontWeight: 700, fontSize: '1.05rem', color: FIRSTSTEP.navyDeep }}>
                {name}
              </Typography>
            </Stack>
            <Stack direction="row" flexWrap="wrap" gap={0.75} sx={{ mt: 1 }}>
              <Chip
                label={paused ? 'Paused' : 'Active'}
                size="small"
                sx={{
                  height: 22,
                  borderRadius: RADIUS.pill,
                  fontSize: '0.68rem',
                  fontWeight: 700,
                  bgcolor: tint(paused ? FIRSTSTEP.warning : FIRSTSTEP.success, 0.16),
                  color: paused ? '#8a5a00' : FIRSTSTEP.success,
                }}
              />
              <Chip
                label={
                  sub.source === 'admin_assigned' ||
                  sub.source === 'request_fulfillment' ||
                  clusterFor(sub.clusterId)?.kind === 'custom'
                    ? 'Purchased / assigned'
                    : 'Plan included'
                }
                size="small"
                variant="outlined"
                sx={{ height: 22, borderRadius: RADIUS.pill, fontSize: '0.68rem', color: FIRSTSTEP.textMuted, borderColor: FIRSTSTEP.border }}
              />
              {!paused && (
                <Chip
                  label={`Next refresh ${timeUntil(sub.nextRefreshAt)}`}
                  size="small"
                  variant="outlined"
                  sx={{ height: 22, borderRadius: RADIUS.pill, fontSize: '0.68rem', color: FIRSTSTEP.textMuted, borderColor: FIRSTSTEP.border }}
                />
              )}
            </Stack>
          </Box>
          {slug && (
            <Button
              component={Link}
              to={`/user/clusters/${slug}`}
              size="small"
              sx={{ textTransform: 'none', fontWeight: 600, color: FIRSTSTEP.tealDark, flexShrink: 0 }}
            >
              Cluster detail
            </Button>
          )}
        </Stack>

        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1}
          alignItems={{ sm: 'center' }}
          sx={{ mt: 2, pt: 2, borderTop: `1px solid ${FIRSTSTEP.border}` }}
        >
          <TextField
            select
            size="small"
            label="Delivery window"
            value={sub.frequency}
            onChange={async (e) => {
              await changeFrequency(sub.id, e.target.value as DeliveryFrequency);
              load();
            }}
            sx={{
              minWidth: 175,
              '& .MuiOutlinedInput-root': { borderRadius: RADIUS.control, bgcolor: FIRSTSTEP.white },
            }}
          >
            {(['1h', '12h', '24h'] as DeliveryFrequency[]).map((f) => (
              <MenuItem key={f} value={f}>
                Every {FREQUENCY_LABEL[f]}
              </MenuItem>
            ))}
          </TextField>

          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ ml: { sm: 'auto' } }}>
            <Button
              size="small"
              variant="outlined"
              startIcon={
                paused ? <PlayCircleOutline sx={{ fontSize: 17 }} /> : <PauseCircleOutline sx={{ fontSize: 17 }} />
              }
              onClick={async () => {
                try {
                  await (paused ? resumeSubscription(sub.id) : pauseSubscription(sub.id));
                  setSlotFull(false);
                  load();
                } catch (err: any) {
                  const code = err?.response?.data?.code;
                  if (code === 'portal.slot_full') {
                    setSlotFull(true);
                    notify('error', err?.response?.data?.error || 'All free cluster slots are in use');
                    await load();
                    return;
                  }
                  notify('error', err?.response?.data?.error || err?.message || 'Action failed');
                }
              }}
              sx={ghostButtonSx}
            >
              {paused ? 'Resume' : 'Pause'}
            </Button>
            <Button
              size="small"
              onClick={() => setCancelId(sub.id)}
              sx={{ textTransform: 'none', fontWeight: 600, borderRadius: RADIUS.pill, color: FIRSTSTEP.danger }}
            >
              Cancel
            </Button>
            <Button
              component={Link}
              to={`/user/feed/${sub.id}`}
              size="small"
              variant="contained"
              disableElevation
              startIcon={<RssFeedOutlined sx={{ fontSize: 17 }} />}
              sx={primaryButtonSx}
            >
              View feed
            </Button>
          </Stack>
        </Stack>
      </Box>
    );
  };

  return (
    <Box>
      <GlassHero dense>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          justifyContent="space-between"
          alignItems={{ md: 'center' }}
          spacing={2.5}
        >
          <Box sx={{ maxWidth: 560 }}>
            <Box
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 0.75,
                px: 1.25,
                py: 0.45,
                borderRadius: RADIUS.pill,
                bgcolor: STITCH.secondaryContainer,
                mb: 1.25,
              }}
            >
              <Typography
                sx={{
                  fontSize: '0.68rem',
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: STITCH.primaryContainer,
                  fontFamily: BODY_FONT,
                }}
              >
                Delivery & entitlements
              </Typography>
            </Box>
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
              Subscriptions
            </Typography>
            <Typography sx={{ mt: 0.75, color: STITCH.muted, fontSize: '0.95rem' }}>
              Change how often each cluster delivers, pause one temporarily, or cancel anytime. Changes take
              effect at the next refresh.
            </Typography>
          </Box>
          {ready && active.length > 0 && (
            <Stack direction="row" flexWrap="wrap" gap={1} useFlexGap>
              <Box
                sx={{
                  px: 2,
                  py: 1.25,
                  borderRadius: RADIUS.card,
                  bgcolor: STITCH.surfaceLow,
                  border: `1px solid ${STITCH.outlineVariant}`,
                  minWidth: 100,
                }}
              >
                <Typography sx={{ fontSize: '0.68rem', color: STITCH.muted, fontWeight: 600 }}>
                  Active
                </Typography>
                <Typography sx={{ fontFamily: DISPLAY_FONT, fontWeight: 700, fontSize: '1.35rem' }}>
                  {active.length}
                </Typography>
              </Box>
              <Box
                sx={{
                  px: 2,
                  py: 1.25,
                  borderRadius: RADIUS.card,
                  bgcolor: STITCH.surfaceLow,
                  border: `1px solid ${STITCH.outlineVariant}`,
                  minWidth: 120,
                }}
              >
                <Typography sx={{ fontSize: '0.68rem', color: STITCH.muted, fontWeight: 600 }}>
                  Billing
                </Typography>
                <Typography sx={{ fontFamily: DISPLAY_FONT, fontWeight: 700, fontSize: '1.15rem' }}>
                  Included
                </Typography>
              </Box>
            </Stack>
          )}
        </Stack>
      </GlassHero>

      {slotFull && (
        <SlotLock entitlements={entitlements} sx={{ mb: 2.5 }} />
      )}

      {!ready ? (
        <Stack spacing={2}>
          <PanelSkeleton height={168} />
          <PanelSkeleton height={168} />
        </Stack>
      ) : needsStart ? (
        <EmptyState
          icon={BoltOutlined}
          title="Start your cluster subscription"
          description={`Your ${planLabel} plan includes ${entitlements?.maxActiveClusters ?? 0} free slot${(entitlements?.maxActiveClusters ?? 0) === 1 ? '' : 's'}. Start monitoring, then pick included clusters. Extra clusters are assigned by ops after purchase.`}
          actionLabel={starting ? 'Starting…' : 'Start subscription'}
          onAction={starting ? undefined : handleStart}
        />
      ) : subs.length === 0 ? (
        <EmptyState
          icon={SubscriptionsOutlined}
          title="No subscriptions yet"
          description="Subscribe to a cluster to start receiving fresh roles on your own schedule."
          actionLabel="Browse clusters"
          actionTo="/user/clusters"
          secondaryLabel="Request a custom cluster"
          secondaryTo="/user/requests/new"
        />
      ) : (
        <Stack spacing={3}>
          {active.length > 0 && (
            <Box>
              <SectionHeading title="Active" count={active.length} />
              <Grid container spacing={1.5}>{active.map((sub) => (
                <Grid item xs={12} md={6} key={sub.id}>{renderCard(sub)}</Grid>
              ))}</Grid>
            </Box>
          )}
          {inactive.length > 0 && (
            <Box>
              <SectionHeading title="Paused" count={inactive.length} />
              <Grid container spacing={1.5}>{inactive.map((sub) => (
                <Grid item xs={12} md={6} key={sub.id}>{renderCard(sub)}</Grid>
              ))}</Grid>
            </Box>
          )}
        </Stack>
      )}

      <Dialog
        open={!!cancelId}
        onClose={() => setCancelId(null)}
        PaperProps={{ sx: { borderRadius: RADIUS.card, p: 1, maxWidth: 400 } }}
      >
        <DialogTitle sx={{ fontWeight: 700, color: FIRSTSTEP.navyDeep }}>Cancel this subscription?</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ color: FIRSTSTEP.textMuted }}>
            You&apos;ll stop receiving new jobs from this cluster. Saved jobs stay in your library and you can
            re-subscribe at any time.
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setCancelId(null)} sx={{ textTransform: 'none', fontWeight: 600, color: FIRSTSTEP.navy }}>
            Keep subscription
          </Button>
          <Button
            variant="contained"
            disableElevation
            onClick={async () => {
              if (cancelId) await cancelSubscription(cancelId);
              setCancelId(null);
              load();
            }}
            sx={{
              borderRadius: RADIUS.pill,
              textTransform: 'none',
              fontWeight: 700,
              bgcolor: FIRSTSTEP.danger,
              '&:hover': { bgcolor: '#c0392b' },
            }}
          >
            Cancel subscription
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
