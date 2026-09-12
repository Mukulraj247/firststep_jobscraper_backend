import React, { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Divider,
  FormControlLabel,
  Grid,
  Stack,
  Switch,
  Typography,
} from '@mui/material';
import ArrowBack from '@mui/icons-material/ArrowBack';
import BoltOutlined from '@mui/icons-material/BoltOutlined';
import CheckCircle from '@mui/icons-material/CheckCircle';
import CreditCardOutlined from '@mui/icons-material/CreditCardOutlined';
import LockOutlined from '@mui/icons-material/LockOutlined';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { GlassHero } from '../components/GlassHero';
import { useRequirePortalAuth } from '../hooks/usePortalAuth';
import { getCluster, listSubscriptions, subscribe } from '../mock/mockApi';
import { useGlobalInfoStore } from '../../context/globalInfo';
import type { Cluster, ClusterSubscription, DeliveryFrequency } from '../types';
import { FREQUENCY_LABEL } from '../types';
import {
  BODY_FONT,
  DISPLAY_FONT,
  RADIUS,
  STITCH,
  accentButtonSx,
  ghostButtonSx,
  panelSx,
  primaryButtonSx,
  tint,
} from '../tokens';

const FREQ_CARDS: Array<{
  value: DeliveryFrequency;
  title: string;
  badge?: string;
  priceDelta: string;
  hint: string;
}> = [
  { value: '2h', title: '2-Hour Window', badge: 'Included in Pro', priceDelta: '+$0/mo', hint: 'Balanced freshness' },
  { value: '1h', title: '1-Hour Window', badge: 'Ultra Fresh', priceDelta: '+$10/mo', hint: 'Highest velocity' },
  { value: '24h', title: '24-Hour Daily Digest', badge: 'Consolidated', priceDelta: '+$0/mo', hint: 'One batch per day' },
];

export function CheckoutPage() {
  const { slug } = useParams<{ slug: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { notify } = useGlobalInfoStore();
  const { user, loading } = useRequirePortalAuth();
  const [cluster, setCluster] = useState<Cluster | null>(null);
  const [activeSubs, setActiveSubs] = useState<ClusterSubscription[]>([]);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [inAppNotify, setInAppNotify] = useState(true);

  const state = location.state as { planId?: string; frequency?: DeliveryFrequency } | null;
  const planId = state?.planId || '';
  const [frequency, setFrequency] = useState<DeliveryFrequency>(state?.frequency || '2h');

  useEffect(() => {
    if (loading || !slug) return;
    getCluster(slug).then(setCluster);
    listSubscriptions().then((s) => setActiveSubs(s.filter((x) => x.status === 'active')));
  }, [slug, loading]);

  const plan = cluster?.plans.find((p) => p.id === planId) || cluster?.plans[0];
  const deliverySurcharge = frequency === '1h' ? 10 : 0;
  const total = (plan?.priceMonthly ?? 0) + deliverySurcharge;

  const confirm = async () => {
    if (!cluster || !plan) return;
    setSubmitting(true);
    const sub = await subscribe(cluster.id, plan.id, frequency);
    setSuccess(true);
    notify('success', "You're subscribed!");
    setTimeout(() => navigate(`/user/feed/${sub.id}`), 1200);
  };

  if (loading || !cluster || !plan) return null;

  if (success) {
    return (
      <Box sx={{ textAlign: 'center', py: { xs: 6, md: 10 } }}>
        <CheckCircle sx={{ fontSize: 64, color: STITCH.secondary, mb: 2 }} />
        <Typography sx={{ fontFamily: DISPLAY_FONT, fontWeight: 700, fontSize: '1.4rem', color: STITCH.primary }}>
          You&apos;re subscribed
        </Typography>
        <Typography sx={{ color: STITCH.muted, mt: 1 }}>Taking you to your {cluster.name} feed…</Typography>
      </Box>
    );
  }

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
        <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ md: 'center' }} spacing={2}>
          <Box>
            <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: STITCH.muted, mb: 1, fontFamily: BODY_FONT }}>
              Clusters › {cluster.name} › Checkout & Delivery Window
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
              Subscription Checkout & Delivery Window
            </Typography>
            <Typography sx={{ mt: 0.75, color: STITCH.muted, maxWidth: 560 }}>
              Confirm plan, delivery cadence, and demo billing — nothing is charged in this sandbox.
            </Typography>
          </Box>
          <Box
            sx={{
              px: 2,
              py: 1.5,
              borderRadius: RADIUS.card,
              bgcolor: STITCH.surfaceLow,
              border: `1px solid ${STITCH.outlineVariant}`,
              minWidth: 180,
            }}
          >
            <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, color: STITCH.muted }}>
              Cluster Dispatcher
            </Typography>
            <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mt: 0.5 }}>
              <CheckCircle sx={{ fontSize: 16, color: STITCH.secondaryFixed }} />
              <Typography sx={{ fontSize: '0.8rem', fontWeight: 600 }}>Standby for Provisioning</Typography>
            </Stack>
          </Box>
        </Stack>
      </GlassHero>

      <Grid container spacing={{ xs: 2, md: 3 }} alignItems="flex-start">
        <Grid item xs={12} md={7}>
          <Box sx={{ ...panelSx, p: { xs: 2.5, md: 3 } }}>
            <Stack direction="row" spacing={0.75} sx={{ mb: 1.5 }}>
              <Chip label="Live Feed Cluster" size="small" sx={{ fontWeight: 700, bgcolor: STITCH.primaryContainer, color: STITCH.onPrimary }} />
              <Chip label="Tier-1 Track" size="small" sx={{ fontWeight: 700, bgcolor: STITCH.secondaryContainer, color: STITCH.onSecondaryContainer }} />
            </Stack>
            <Typography sx={{ fontFamily: DISPLAY_FONT, fontWeight: 700, fontSize: '1.25rem', color: STITCH.primary }}>
              {cluster.name} — {plan.name}
            </Typography>
            <Typography sx={{ mt: 0.75, color: STITCH.muted, fontSize: '0.875rem' }}>{cluster.description}</Typography>
            <Typography sx={{ mt: 2, fontFamily: DISPLAY_FONT, fontWeight: 700, fontSize: '1.75rem', color: STITCH.primary }}>
              ${plan.priceMonthly}
              <Box component="span" sx={{ fontSize: '0.9rem', fontWeight: 500, color: STITCH.muted }}>
                {' '}
                / month
              </Box>
            </Typography>
            <Stack direction="row" flexWrap="wrap" gap={2} sx={{ mt: 2 }}>
              {[
                [`${cluster.jobCountPreview} active`, 'Indexed Roles'],
                ['98.4%', 'H-1B Verified'],
                ['V3 Semantic', 'Dedup Engine'],
              ].map(([v, l]) => (
                <Box key={l}>
                  <Typography sx={{ fontWeight: 700, fontSize: '0.875rem', color: STITCH.onSurface }}>{v}</Typography>
                  <Typography sx={{ fontSize: '0.7rem', color: STITCH.muted }}>{l}</Typography>
                </Box>
              ))}
            </Stack>
          </Box>

          <Box sx={{ ...panelSx, p: { xs: 2.5, md: 3 }, mt: 2 }}>
            <Typography sx={{ fontFamily: DISPLAY_FONT, fontWeight: 700, color: STITCH.primary, mb: 1.5 }}>
              Select Delivery Window
            </Typography>
            <Stack spacing={1.25}>
              {FREQ_CARDS.map((card) => {
                const on = frequency === card.value;
                return (
                  <Box
                    key={card.value}
                    onClick={() => setFrequency(card.value)}
                    sx={{
                      p: 2,
                      borderRadius: RADIUS.card,
                      cursor: 'pointer',
                      bgcolor: on ? tint(STITCH.secondary, 0.08) : STITCH.surfaceLowest,
                      boxShadow: on ? `inset 0 0 0 2px ${STITCH.secondary}` : `inset 0 0 0 1px ${STITCH.outlineVariant}`,
                    }}
                  >
                    <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                      <Box>
                        <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
                          <Typography sx={{ fontWeight: 700, color: STITCH.onSurface }}>{card.title}</Typography>
                          {card.badge && (
                            <Chip
                              label={card.badge}
                              size="small"
                              sx={{
                                height: 20,
                                fontSize: '0.65rem',
                                fontWeight: 700,
                                bgcolor: on ? STITCH.secondaryContainer : STITCH.surfaceContainer,
                                color: on ? STITCH.onSecondaryContainer : STITCH.onSurfaceVariant,
                              }}
                            />
                          )}
                        </Stack>
                        <Typography sx={{ fontSize: '0.8rem', color: STITCH.muted, mt: 0.35 }}>{card.hint}</Typography>
                      </Box>
                      <Typography sx={{ fontWeight: 700, color: STITCH.onSurface, fontSize: '0.875rem' }}>
                        {card.priceDelta}
                      </Typography>
                    </Stack>
                  </Box>
                );
              })}
            </Stack>
          </Box>

          <Box sx={{ ...panelSx, p: { xs: 2.5, md: 3 }, mt: 2 }}>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
              <LockOutlined sx={{ fontSize: 18, color: STITCH.secondary }} />
              <Typography sx={{ fontWeight: 700, color: STITCH.primary }}>Demo Mode: Mock Billing Active</Typography>
            </Stack>
            <Box
              sx={{
                p: 2.5,
                borderRadius: RADIUS.card,
                background: `linear-gradient(135deg, ${STITCH.primaryContainer} 0%, ${STITCH.tertiaryContainer} 100%)`,
                color: STITCH.onPrimary,
              }}
            >
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <CreditCardOutlined />
                <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.08em' }}>VISA · SANDBOX</Typography>
              </Stack>
              <Typography sx={{ mt: 2.5, fontFamily: 'monospace', fontSize: '1.1rem', letterSpacing: '0.12em' }}>
                •••• •••• •••• 4242
              </Typography>
              <Typography sx={{ mt: 1, fontSize: '0.8rem', opacity: 0.85 }}>{user?.name || 'Demo User'}</Typography>
            </Box>
            <Typography sx={{ mt: 1.25, fontSize: '0.75rem', color: STITCH.muted }}>
              SSL Sandbox Tokenization · Change Test Card (demo)
            </Typography>
          </Box>

          <Box sx={{ ...panelSx, p: { xs: 2, md: 2.5 }, mt: 2 }}>
            <FormControlLabel
              control={<Switch checked={inAppNotify} onChange={(_, v) => setInAppNotify(v)} color="success" />}
              label={
                <Box>
                  <Typography sx={{ fontWeight: 600, fontSize: '0.875rem' }}>In-app feed notifications</Typography>
                  <Typography sx={{ fontSize: '0.75rem', color: STITCH.muted }}>Enabled for this cluster</Typography>
                </Box>
              }
              sx={{ width: '100%', m: 0, justifyContent: 'space-between', ml: 0 }}
              labelPlacement="start"
            />
            <Divider sx={{ my: 1.5 }} />
            <FormControlLabel
              control={<Switch checked={false} disabled />}
              label={
                <Box>
                  <Typography sx={{ fontWeight: 600, fontSize: '0.875rem' }}>Email digest</Typography>
                  <Typography sx={{ fontSize: '0.75rem', color: STITCH.muted }}>Coming soon</Typography>
                </Box>
              }
              sx={{ width: '100%', m: 0, justifyContent: 'space-between', ml: 0 }}
              labelPlacement="start"
            />
          </Box>

          <Button
            fullWidth
            variant="contained"
            disableElevation
            disabled={submitting}
            startIcon={<BoltOutlined />}
            onClick={confirm}
            sx={{ ...accentButtonSx, mt: 2.5, py: 1.5, fontSize: '0.95rem' }}
          >
            {submitting ? 'Confirming…' : 'Confirm & Activate Subscription (Demo)'}
          </Button>
        </Grid>

        <Grid item xs={12} md={5}>
          <Box sx={{ ...panelSx, p: { xs: 2.5, md: 3 }, position: { md: 'sticky' }, top: { md: 88 } }}>
            <Typography sx={{ fontFamily: DISPLAY_FONT, fontWeight: 700, color: STITCH.primary, mb: 2 }}>
              Order Summary
            </Typography>
            <Stack spacing={1.25}>
              {[
                ['Plan', `${plan.name} — $${plan.priceMonthly}`],
                ['Delivery window', `Every ${FREQUENCY_LABEL[frequency]}${deliverySurcharge ? ` (+$${deliverySurcharge})` : ''}`],
                ['Telemetry engine', '$0'],
                ['Fees', '$0'],
              ].map(([k, v]) => (
                <Stack key={k} direction="row" justifyContent="space-between">
                  <Typography sx={{ fontSize: '0.8125rem', color: STITCH.muted }}>{k}</Typography>
                  <Typography sx={{ fontSize: '0.8125rem', fontWeight: 600, color: STITCH.onSurface, textAlign: 'right' }}>
                    {v}
                  </Typography>
                </Stack>
              ))}
            </Stack>
            <Divider sx={{ my: 2 }} />
            <Stack direction="row" justifyContent="space-between" alignItems="baseline">
              <Typography sx={{ fontWeight: 700 }}>Total Due Today</Typography>
              <Typography sx={{ fontFamily: DISPLAY_FONT, fontWeight: 700, fontSize: '1.5rem' }}>
                ${total.toFixed(2)}
              </Typography>
            </Stack>
            <Box sx={{ mt: 2, p: 1.5, borderRadius: RADIUS.control, bgcolor: STITCH.surfaceLow }}>
              <Typography sx={{ fontSize: '0.75rem', color: STITCH.muted }}>
                Sandbox notice: this is a mock checkout. No card is charged and no real Stripe session is created.
              </Typography>
            </Box>
            <Stack spacing={1} sx={{ mt: 2 }}>
              {[
                'Instant feed access after confirm',
                `${FREQUENCY_LABEL[frequency]} refresh cadence`,
                'Pause or cancel anytime',
                'H-1B signals where available',
              ].map((item) => (
                <Stack key={item} direction="row" spacing={1} alignItems="flex-start">
                  <CheckCircle sx={{ fontSize: 16, color: STITCH.secondary, mt: 0.2 }} />
                  <Typography sx={{ fontSize: '0.8rem', color: STITCH.onSurface }}>{item}</Typography>
                </Stack>
              ))}
            </Stack>
          </Box>
        </Grid>
      </Grid>

      {activeSubs.length > 0 && (
        <Box sx={{ mt: 4 }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
            <Typography sx={{ fontFamily: DISPLAY_FONT, fontWeight: 600, fontSize: '1.25rem' }}>
              Active Subscriptions Manager
            </Typography>
            <Chip
              label={`${activeSubs.length} Pipelines Running`}
              size="small"
              sx={{ fontWeight: 700, bgcolor: STITCH.secondaryContainer, color: STITCH.onSecondaryContainer }}
            />
          </Stack>
          <Grid container spacing={2}>
            {activeSubs.map((sub) => (
              <Grid item xs={12} sm={6} key={sub.id}>
                <Box sx={{ ...panelSx, p: 2.5 }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Typography sx={{ fontWeight: 700, color: STITCH.primary }}>{sub.clusterName}</Typography>
                    <Chip label="Active" size="small" sx={{ fontWeight: 700, bgcolor: tint(STITCH.success, 0.16), color: STITCH.success }} />
                  </Stack>
                  <Box sx={{ mt: 1.5, p: 1.5, borderRadius: RADIUS.control, bgcolor: STITCH.surfaceLow }}>
                    <Typography sx={{ fontSize: '0.75rem', color: STITCH.muted }}>
                      Delivery · Every {FREQUENCY_LABEL[sub.frequency]}
                    </Typography>
                  </Box>
                  <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
                    <Button component={Link} to="/user/subscriptions" size="small" sx={{ ...ghostButtonSx, flex: 1 }}>
                      Change window
                    </Button>
                    <Button component={Link} to={`/user/feed/${sub.id}`} size="small" sx={{ ...primaryButtonSx, flex: 1 }}>
                      View feed
                    </Button>
                  </Stack>
                </Box>
              </Grid>
            ))}
          </Grid>
        </Box>
      )}
    </Box>
  );
}
