import React, { useEffect, useState } from 'react';
import { Box, Button, Chip, Grid, Stack, Typography } from '@mui/material';
import ArrowBack from '@mui/icons-material/ArrowBack';
import CheckCircle from '@mui/icons-material/CheckCircle';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { GlassHero } from '../components/GlassHero';
import { SlotLock, isSlotLocked } from '../components/SlotLock';
import { useRequirePortalAuth } from '../hooks/usePortalAuth.tsx';
import { getEntitlements, startClusterService, subscribe } from '../api/portalApi';
import {
  invalidatePortalShell,
  usePortalCluster,
  usePortalEntitlements,
} from '../hooks/portalQueries';
import { useGlobalInfoStore } from '../../context/globalInfo';
import type { DeliveryFrequency } from '../types';
import { FREQUENCY_LABEL } from '../types';
import { humanLabel } from '../utils/displayLabels';
import {
  BODY_FONT,
  DISPLAY_FONT,
  RADIUS,
  STITCH,
  ghostButtonSx,
  panelSx,
  primaryButtonSx,
  tint,
} from '../tokens';
import { useQueryClient } from '@tanstack/react-query';

const FREQ_CARDS: Array<{
  value: DeliveryFrequency;
  title: string;
  hint: string;
}> = [
  { value: '1h', title: '1-Hour Window', hint: 'Highest freshness' },
  { value: '12h', title: '12-Hour Window', hint: 'Balanced freshness' },
  { value: '24h', title: '24-Hour Daily Digest', hint: 'One batch per day' },
];

export function CheckoutPage() {
  const { slug } = useParams<{ slug: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { notify } = useGlobalInfoStore();
  const { user, loading } = useRequirePortalAuth();
  const queryClient = useQueryClient();
  const enabled = !loading && Boolean(slug);
  const { data: cluster = null } = usePortalCluster(slug, enabled);
  const { data: entitlementsQuery = null, refetch: refetchEnts } = usePortalEntitlements(enabled);
  const [entitlementsOverride, setEntitlementsOverride] = useState<
    import('../types').PortalEntitlements | null
  >(null);
  const entitlements = entitlementsOverride || entitlementsQuery;
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const state = location.state as { planId?: string; frequency?: DeliveryFrequency } | null;
  const [frequency, setFrequency] = useState<DeliveryFrequency>(state?.frequency || '24h');

  useEffect(() => {
    if (!entitlements) return;
    const windows = entitlements.allowedWindows || [];
    if (windows.length && !windows.includes(frequency)) {
      setFrequency(windows.includes('12h') ? '12h' : windows[0]);
    }
  }, [entitlements, frequency]);

  const needsStart =
    Boolean(entitlements) &&
    (entitlements?.maxActiveClusters ?? 0) > 0 &&
    !entitlements?.clusterServiceStarted;

  const handleStartThenStay = async () => {
    setStarting(true);
    setError(null);
    try {
      const ents = await startClusterService();
      setEntitlementsOverride(ents);
      await invalidatePortalShell(queryClient);
      notify('success', 'Cluster monitoring started');
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || 'Could not start';
      setError(msg);
      notify('error', msg);
    } finally {
      setStarting(false);
    }
  };

  const confirm = async () => {
    if (!cluster) return;
    if (needsStart) {
      setError('Start cluster monitoring before activating a cluster');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const sub = await subscribe(cluster.id, 'entitlement', frequency);
      setSuccess(true);
      await invalidatePortalShell(queryClient);
      notify('success', 'Cluster activated');
      setTimeout(() => navigate(`/user/feed/${sub.id}`), 1000);
    } catch (err: any) {
      const code = err?.response?.data?.code;
      const msg =
        err?.response?.data?.error ||
        err?.message ||
        'Could not activate cluster. Check your plan slots.';
      setError(msg);
      notify('error', msg);
      if (code === 'cluster_service_not_started') {
        const ents = await getEntitlements().catch(() => null);
        if (ents) setEntitlementsOverride(ents);
        await refetchEnts();
      }
      setSubmitting(false);
    }
  };

  if (loading || !cluster || !user) return null;

  const clusterName = humanLabel(cluster.name, 'Cluster');
  const clusterDesc = humanLabel(cluster.description, 'Curated roles from this cluster');

  if (success) {
    return (
      <Box sx={{ textAlign: 'center', py: { xs: 6, md: 10 } }}>
        <CheckCircle sx={{ fontSize: 64, color: STITCH.secondary, mb: 2 }} />
        <Typography sx={{ fontFamily: DISPLAY_FONT, fontWeight: 700, fontSize: '1.4rem', color: STITCH.primary }}>
          Cluster activated
        </Typography>
        <Typography sx={{ color: STITCH.muted, mt: 1 }}>Taking you to your {clusterName} feed…</Typography>
      </Box>
    );
  }

  const allowed = entitlements?.allowedWindows || [];
  const planLabel =
    entitlements?.subscriptionTypeDisplay ||
    entitlements?.subscriptionType ||
    user.firstStepPlan?.subscriptionType ||
    '—';
  const locked = isSlotLocked(entitlements);
  const slotFullError =
    Boolean(error) &&
    /slot|free cluster|plan includes/i.test(String(error || ''));

  return (
    <Box>
      <Button
        component={Link}
        to={`/user/clusters/${slug}`}
        startIcon={<ArrowBack sx={{ fontSize: 17 }} />}
        sx={{ mb: 1.5, textTransform: 'none', fontWeight: 600, color: STITCH.muted, '&:hover': { color: STITCH.primary } }}
      >
        Back to cluster
      </Button>

      <GlassHero dense>
        <Box>
          <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: STITCH.muted, mb: 1, fontFamily: BODY_FONT }}>
            Clusters › {clusterName} › Activate
          </Typography>
          <Typography
            component="h1"
            sx={{
              fontFamily: DISPLAY_FONT,
              fontWeight: 700,
              letterSpacing: '-0.03em',
              fontSize: { xs: '1.5rem', md: '2rem' },
              lineHeight: 1.15,
              color: STITCH.primaryContainer,
            }}
          >
            Activate cluster
          </Typography>
          <Typography sx={{ mt: 0.75, color: STITCH.muted, maxWidth: 560 }}>
            Uses one slot from your allotment (Premium Plus includes 2 in-plan; other plans get
            slots only when ops assigns them). Extra clusters need ops to raise your limit — no
            payment in ScoutX.
          </Typography>
        </Box>
      </GlassHero>

      {needsStart && (
        <Box sx={{ ...panelSx, p: 2.5, mb: 2, border: `1px solid ${STITCH.outlineVariant}` }}>
          <Typography sx={{ fontWeight: 700, color: STITCH.primary }}>
            Start cluster monitoring first
          </Typography>
          <Typography sx={{ mt: 0.75, fontSize: '0.875rem', color: STITCH.muted }}>
            Your plan is active, but ScoutX cluster monitoring has not been started yet.
          </Typography>
          <Button
            variant="contained"
            disableElevation
            disabled={starting}
            onClick={handleStartThenStay}
            sx={{ ...primaryButtonSx, mt: 2 }}
          >
            {starting ? 'Starting…' : 'Start subscription'}
          </Button>
        </Box>
      )}

      <Grid container spacing={{ xs: 2, md: 3 }} alignItems="flex-start">
        <Grid item xs={12} md={7}>
          <Box sx={{ ...panelSx, p: { xs: 2.5, md: 3 } }}>
            <Chip
              label="Plan entitlement"
              size="small"
              sx={{ fontWeight: 700, bgcolor: STITCH.secondaryContainer, color: STITCH.onSecondaryContainer, mb: 1.5 }}
            />
            <Typography sx={{ fontFamily: DISPLAY_FONT, fontWeight: 700, fontSize: '1.25rem', color: STITCH.primary }}>
              {clusterName}
            </Typography>
            <Typography sx={{ mt: 0.75, color: STITCH.muted, fontSize: '0.875rem' }}>{clusterDesc}</Typography>

            <Typography sx={{ mt: 3, mb: 1.25, fontWeight: 700, color: STITCH.primary }}>Delivery window</Typography>
            <Stack spacing={1}>
              {FREQ_CARDS.map((card) => {
                const enabled = !allowed.length || allowed.includes(card.value);
                const on = frequency === card.value;
                return (
                  <Box
                    key={card.value}
                    onClick={() => enabled && !needsStart && setFrequency(card.value)}
                    sx={{
                      p: 2,
                      borderRadius: RADIUS.card,
                      cursor: enabled && !needsStart ? 'pointer' : 'not-allowed',
                      opacity: enabled && !needsStart ? 1 : 0.45,
                      bgcolor: on ? tint(STITCH.secondary, 0.08) : STITCH.surfaceLowest,
                      boxShadow: on
                        ? `inset 0 0 0 2px ${STITCH.secondary}`
                        : `inset 0 0 0 1px ${STITCH.outlineVariant}`,
                    }}
                  >
                    <Typography sx={{ fontWeight: 700 }}>{card.title}</Typography>
                    <Typography sx={{ fontSize: '0.8125rem', color: STITCH.muted }}>
                      {enabled ? card.hint : 'Not on your plan'}
                    </Typography>
                  </Box>
                );
              })}
            </Stack>

            {(locked || slotFullError) && (
              <Box sx={{ mt: 2 }}>
                <SlotLock entitlements={entitlements} />
              </Box>
            )}

            {error && !slotFullError && (
              <Typography sx={{ mt: 2, color: STITCH.error, fontSize: '0.875rem' }}>{error}</Typography>
            )}

            <Stack direction="row" spacing={1.5} sx={{ mt: 3 }}>
              <Button
                variant="contained"
                disableElevation
                disabled={
                  submitting ||
                  needsStart ||
                  locked ||
                  (entitlements != null && entitlements.availableSlots <= 0)
                }
                onClick={confirm}
                sx={primaryButtonSx}
              >
                {submitting ? 'Activating…' : 'Activate cluster'}
              </Button>
              <Button component={Link} to={`/user/clusters/${slug}`} sx={ghostButtonSx}>
                Cancel
              </Button>
            </Stack>
          </Box>
        </Grid>

        <Grid item xs={12} md={5}>
          <Box sx={{ ...panelSx, p: 2.5 }}>
            <Typography sx={{ fontFamily: DISPLAY_FONT, fontWeight: 700, color: STITCH.primary }}>
              Entitlement check
            </Typography>
            <Stack spacing={1} sx={{ mt: 2 }}>
              {[
                ['Plan', planLabel],
                ['Service started', needsStart ? 'No' : 'Yes'],
                ['Active clusters', String(entitlements?.activeClusterCount ?? '—')],
                ['Included slots', String(entitlements?.includedSlots ?? entitlements?.maxActiveClusters ?? '—')],
                ['Free included', String(entitlements?.availableSlots ?? '—')],
                [
                  'Purchased extras',
                  String(entitlements?.extraActiveCount ?? 0),
                ],
                ['Window', FREQUENCY_LABEL[frequency]],
              ].map(([k, v]) => (
                <Stack key={k} direction="row" justifyContent="space-between">
                  <Typography sx={{ fontSize: '0.8125rem', color: STITCH.muted }}>{k}</Typography>
                  <Typography sx={{ fontSize: '0.8125rem', fontWeight: 600 }}>{v}</Typography>
                </Stack>
              ))}
            </Stack>
          </Box>
        </Grid>
      </Grid>
    </Box>
  );
}
