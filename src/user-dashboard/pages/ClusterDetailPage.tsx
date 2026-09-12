import React, { useEffect, useState } from 'react';
import { Box, Button, Chip, Grid, Stack, Tab, Tabs, Typography } from '@mui/material';
import ArrowForward from '@mui/icons-material/ArrowForward';
import BoltOutlined from '@mui/icons-material/BoltOutlined';
import CheckCircleOutline from '@mui/icons-material/CheckCircleOutline';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { FeedListCard } from '../components/FeedListCard';
import { GlassHero } from '../components/GlassHero';
import { PlanPicker, PlanPickerStickyBar } from '../components/PlanPicker';
import { JobListSkeleton } from '../components/Skeletons';
import { useRequirePortalAuth } from '../hooks/usePortalAuth';
import { getCluster } from '../mock/mockApi';
import { getJobsForCluster } from '../mock/mockJobs';
import type { Cluster, DeliveryFrequency } from '../types';
import {
  BODY_FONT,
  DISPLAY_FONT,
  RADIUS,
  STITCH,
  panelSx,
  primaryButtonSx,
  tint,
} from '../tokens';

export function ClusterDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { loading } = useRequirePortalAuth();
  const [cluster, setCluster] = useState<Cluster | null>(null);
  const [tab, setTab] = useState(0);
  const [planId, setPlanId] = useState('');
  const [frequency, setFrequency] = useState<DeliveryFrequency>('2h');

  useEffect(() => {
    if (loading || !slug) return;
    getCluster(slug).then((c) => {
      setCluster(c);
      setPlanId(c.plans[0]?.id || '');
    });
  }, [slug, loading]);

  if (loading || !cluster) return null;

  const sampleJobs = getJobsForCluster(cluster.id).slice(0, 8);
  const selectedPlan = cluster.plans.find((p) => p.id === planId) || cluster.plans[0];
  const goCheckout = () => navigate(`/user/clusters/${slug}/checkout`, { state: { planId, frequency } });

  return (
    <Box sx={{ pb: { xs: 14, md: 2 } }}>
      <GlassHero>
        <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: STITCH.muted, mb: 1.25, fontFamily: BODY_FONT }}>
          <Box component={Link} to="/user/clusters" sx={{ color: 'inherit', textDecoration: 'none', '&:hover': { color: STITCH.primaryContainer } }}>
            Catalog
          </Box>
          {' / '}
          {cluster.name}
        </Typography>

        <Stack direction="row" flexWrap="wrap" gap={0.75} sx={{ mb: 1.5 }}>
          <Chip
            label={cluster.kind === 'custom' ? 'Custom Built Feed' : 'Curated Official Feed'}
            size="small"
            sx={{
              height: 24,
              borderRadius: RADIUS.pill,
              fontWeight: 700,
              fontSize: '0.7rem',
              bgcolor: STITCH.secondaryFixed,
              color: STITCH.primaryContainer,
            }}
          />
          <Chip
            icon={<BoltOutlined sx={{ fontSize: '14px !important' }} />}
            label="Live 1–2h Sync"
            size="small"
            sx={{
              height: 24,
              borderRadius: RADIUS.pill,
              fontWeight: 700,
              fontSize: '0.7rem',
              bgcolor: STITCH.secondaryContainer,
              color: STITCH.primaryContainer,
              border: `1px solid ${STITCH.outlineVariant}`,
              '& .MuiChip-icon': { color: STITCH.secondary },
            }}
          />
        </Stack>

        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 1 }}>
          {cluster.companyLogos?.[0] && (
            <Box
              component="img"
              src={cluster.companyLogos[0]}
              alt=""
              sx={{ width: 44, height: 44, borderRadius: RADIUS.md, bgcolor: STITCH.surfaceLow, objectFit: 'cover' }}
            />
          )}
          <Box>
            <Typography
              component="h1"
              sx={{
                fontFamily: DISPLAY_FONT,
                fontWeight: 700,
                letterSpacing: '-0.03em',
                fontSize: { xs: '1.7rem', md: '2.25rem' },
                lineHeight: 1.15,
                color: STITCH.primaryContainer,
              }}
            >
              {cluster.name}
            </Typography>
            <Typography sx={{ fontSize: '0.75rem', color: STITCH.muted, fontFamily: BODY_FONT }}>
              Cluster ID · {cluster.id} · Synced 14m ago
            </Typography>
          </Box>
        </Stack>

        <Typography sx={{ color: STITCH.muted, mt: 1, maxWidth: 720, fontSize: '0.95rem' }}>
          {cluster.description}
        </Typography>

        <Grid container spacing={1.5} sx={{ mt: 2.5, maxWidth: 720 }}>
          {[
            { label: 'Open Tracked', value: String(cluster.jobCountPreview) },
            { label: 'H-1B Ratio', value: '96.4%' },
            { label: 'Avg. Pipeline', value: '18d' },
          ].map((stat) => (
            <Grid item xs={4} key={stat.label}>
              <Box
                sx={{
                  p: 1.5,
                  borderRadius: RADIUS.card,
                  bgcolor: STITCH.surfaceLow,
                  border: `1px solid ${STITCH.outlineVariant}`,
                  backdropFilter: 'blur(10px)',
                }}
              >
                <Typography sx={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: STITCH.muted }}>
                  {stat.label}
                </Typography>
                <Typography sx={{ fontFamily: DISPLAY_FONT, fontWeight: 700, fontSize: '1.25rem', mt: 0.25 }}>
                  {stat.value}
                </Typography>
              </Box>
            </Grid>
          ))}
        </Grid>

        <Stack direction="row" flexWrap="wrap" gap={0.75} sx={{ mt: 2 }}>
          {cluster.filtersSummary.map((f) => (
            <Chip
              key={f}
              label={f}
              size="small"
              sx={{
                height: 26,
                borderRadius: RADIUS.pill,
                fontSize: '0.72rem',
                fontWeight: 600,
                bgcolor: STITCH.surfaceLow,
                color: STITCH.primaryContainer,
                border: `1px solid ${STITCH.outlineVariant}`,
              }}
            />
          ))}
          <Chip
            label="FY2026 H-1B Filing Match"
            size="small"
            sx={{
              height: 26,
              borderRadius: RADIUS.pill,
              fontSize: '0.72rem',
              fontWeight: 700,
              bgcolor: STITCH.secondaryContainer,
              color: STITCH.onSecondaryContainer,
            }}
          />
        </Stack>
      </GlassHero>

      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v)}
        sx={{
          mb: 2.5,
          minHeight: 40,
          borderBottom: `1px solid ${STITCH.outlineVariant}`,
          '& .MuiTab-root': {
            textTransform: 'none',
            fontWeight: 600,
            minHeight: 40,
            color: STITCH.muted,
            fontFamily: BODY_FONT,
            '&.Mui-selected': { color: STITCH.primary },
          },
          '& .MuiTabs-indicator': { backgroundColor: STITCH.secondary, height: 3, borderRadius: 3 },
        }}
      >
        <Tab label="Overview & Plans" />
        <Tab label={`Sample Live Jobs (${sampleJobs.length})`} />
        <Tab label="Delivery Schedule" />
      </Tabs>

      {tab === 0 && (
        <Grid container spacing={{ xs: 2, md: 3 }} alignItems="flex-start">
          <Grid item xs={12} md={7} lg={8}>
            <Box sx={{ ...panelSx, p: { xs: 2, md: 3 } }}>
              <Typography sx={{ fontFamily: DISPLAY_FONT, fontWeight: 600, fontSize: '1.15rem', color: STITCH.onSurface, mb: 0.5 }}>
                Configure your subscription
              </Typography>
              <Typography sx={{ color: STITCH.muted, fontSize: '0.875rem', mb: 2.5 }}>
                Pick a delivery window and plan tier. Cancel anytime — no long-term contract.
              </Typography>
              <PlanPicker
                plans={cluster.plans}
                selectedPlanId={planId}
                selectedFrequency={frequency}
                onPlanChange={setPlanId}
                onFrequencyChange={setFrequency}
              />
            </Box>

            <Box sx={{ ...panelSx, p: { xs: 2, md: 3 }, mt: 2 }}>
              <Typography sx={{ fontFamily: DISPLAY_FONT, fontWeight: 600, mb: 1.5, color: STITCH.onSurface }}>
                What&apos;s included
              </Typography>
              <Stack spacing={1.25}>
                {[
                  'Filters maintained by ScoutText ops — no setup on your side',
                  'Duplicate and expired postings removed before delivery',
                  'Apply links go straight to the company career page',
                  'Pause, change window, or cancel at any time',
                ].map((item) => (
                  <Stack key={item} direction="row" spacing={1.25} alignItems="flex-start">
                    <CheckCircleOutline sx={{ fontSize: 18, color: STITCH.secondary, mt: 0.2, flexShrink: 0 }} />
                    <Typography variant="body2" sx={{ color: STITCH.onSurface }}>
                      {item}
                    </Typography>
                  </Stack>
                ))}
              </Stack>
            </Box>
          </Grid>

          <Grid item xs={12} md={5} lg={4}>
            <Box sx={{ position: { md: 'sticky' }, top: { md: 88 } }}>
              <Box sx={{ ...panelSx, p: { xs: 2, md: 2.5 } }}>
                <Chip
                  label="Demo Sandbox"
                  size="small"
                  sx={{
                    mb: 1.5,
                    height: 22,
                    borderRadius: RADIUS.pill,
                    fontWeight: 700,
                    fontSize: '0.68rem',
                    bgcolor: tint(STITCH.warning, 0.18),
                    color: '#8a5a00',
                  }}
                />
                <Typography sx={{ fontFamily: DISPLAY_FONT, fontWeight: 700, color: STITCH.primary }}>
                  Subscription summary
                </Typography>
                <Typography sx={{ mt: 0.5, fontSize: '0.875rem', color: STITCH.muted }}>
                  {cluster.name} · {selectedPlan.name}
                </Typography>

                <Stack spacing={1} sx={{ mt: 2 }}>
                  {[
                    ['Base membership', `$${selectedPlan.priceMonthly}`],
                    ['Delivery interval', frequency === '1h' ? 'Hourly' : frequency === '2h' ? 'Every 2h' : 'Daily'],
                    ['Telemetry engine', 'Included'],
                  ].map(([k, v]) => (
                    <Stack key={k} direction="row" justifyContent="space-between">
                      <Typography sx={{ fontSize: '0.8125rem', color: STITCH.muted }}>{k}</Typography>
                      <Typography sx={{ fontSize: '0.8125rem', fontWeight: 600, color: STITCH.onSurface }}>{v}</Typography>
                    </Stack>
                  ))}
                </Stack>

                <Stack direction="row" justifyContent="space-between" alignItems="baseline" sx={{ mt: 2.5, pt: 2, borderTop: `1px solid ${STITCH.outlineVariant}` }}>
                  <Typography sx={{ fontWeight: 700, color: STITCH.primary }}>Total</Typography>
                  <Typography sx={{ fontFamily: DISPLAY_FONT, fontWeight: 700, fontSize: '1.5rem', color: STITCH.primary }}>
                    ${selectedPlan.priceMonthly}
                    <Box component="span" sx={{ fontSize: '0.85rem', fontWeight: 500, color: STITCH.muted }}>
                      /month
                    </Box>
                  </Typography>
                </Stack>

                <Button
                  fullWidth
                  variant="contained"
                  disableElevation
                  endIcon={<ArrowForward sx={{ fontSize: 16 }} />}
                  onClick={goCheckout}
                  sx={{ ...primaryButtonSx, mt: 2.5, py: 1.25, display: { xs: 'none', md: 'flex' } }}
                >
                  Proceed to Checkout
                </Button>
              </Box>

              <Box sx={{ ...panelSx, p: 2, mt: 2 }}>
                <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: STITCH.muted }}>
                  Cluster health
                </Typography>
                <Typography sx={{ mt: 0.75, fontFamily: DISPLAY_FONT, fontWeight: 700, fontSize: '1.25rem', color: STITCH.secondary }}>
                  99.98% uptime
                </Typography>
                <Typography sx={{ fontSize: '0.75rem', color: STITCH.muted, mt: 0.35 }}>
                  Last 24h ingestion healthy · 0 failed syncs
                </Typography>
              </Box>

              <Box
                sx={{
                  mt: 2,
                  p: 2,
                  borderRadius: RADIUS.card,
                  bgcolor: tint(STITCH.secondary, 0.06),
                  border: `1px dashed ${tint(STITCH.secondary, 0.35)}`,
                }}
              >
                <Typography variant="body2" sx={{ color: STITCH.onSurface }}>
                  Need different filters?{' '}
                  <Box
                    component={Link}
                    to="/user/requests/new"
                    sx={{ color: STITCH.secondary, fontWeight: 700, textDecoration: 'none', '&:hover': { color: STITCH.primary } }}
                  >
                    Request a custom cluster
                  </Box>
                </Typography>
              </Box>
            </Box>
          </Grid>
        </Grid>
      )}

      {tab === 1 &&
        (sampleJobs.length === 0 ? (
          <JobListSkeleton count={3} />
        ) : (
          <Stack spacing={1.5}>
            <Typography sx={{ fontFamily: DISPLAY_FONT, fontWeight: 600, color: STITCH.onSurface }}>
              Live sample stream
            </Typography>
            {sampleJobs.map((j) => (
              <FeedListCard key={j.id} job={j} onOpen={(id) => navigate(`/user/jobs/${id}`)} />
            ))}
          </Stack>
        ))}

      {tab === 2 && (
        <Box sx={{ ...panelSx, p: { xs: 2.5, md: 3 }, maxWidth: 640 }}>
          <Typography sx={{ fontFamily: DISPLAY_FONT, fontWeight: 600, mb: 1 }}>Delivery schedule</Typography>
          <Typography sx={{ color: STITCH.muted, fontSize: '0.9rem', mb: 2 }}>
            Choose how often ScoutText refreshes this cluster into your feed. Changes apply at the next sync after checkout.
          </Typography>
          <Stack spacing={1}>
            {(
              [
                ['1h', 'Hourly', 'Ultra-fresh roles as they appear'],
                ['2h', 'Every 2 hours', 'Recommended balance of speed and noise'],
                ['24h', 'Daily digest', 'One consolidated batch per day'],
              ] as const
            ).map(([value, title, hint]) => {
              const on = frequency === value;
              return (
                <Box
                  key={value}
                  onClick={() => setFrequency(value)}
                  sx={{
                    p: 2,
                    borderRadius: RADIUS.card,
                    cursor: 'pointer',
                    bgcolor: on ? tint(STITCH.secondary, 0.08) : STITCH.surfaceLowest,
                    boxShadow: on ? `inset 0 0 0 2px ${STITCH.secondary}` : `inset 0 0 0 1px ${STITCH.outlineVariant}`,
                  }}
                >
                  <Typography sx={{ fontWeight: 700, color: STITCH.onSurface }}>{title}</Typography>
                  <Typography sx={{ fontSize: '0.8125rem', color: STITCH.muted }}>{hint}</Typography>
                </Box>
              );
            })}
          </Stack>
        </Box>
      )}

      <PlanPickerStickyBar price={selectedPlan.priceMonthly} onSubscribe={goCheckout} />
    </Box>
  );
}
