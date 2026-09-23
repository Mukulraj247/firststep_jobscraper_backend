import React, { useEffect, useMemo, useState } from 'react';
import { Box, Button, Chip, Grid, Stack, Tab, Tabs, TextField, Tooltip, Typography } from '@mui/material';
import ArrowForward from '@mui/icons-material/ArrowForward';
import BoltOutlined from '@mui/icons-material/BoltOutlined';
import CheckCircleOutline from '@mui/icons-material/CheckCircleOutline';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { FeedListCard } from '../components/FeedListCard';
import { GlassHero } from '../components/GlassHero';
import { PlanPicker, PlanPickerStickyBar } from '../components/PlanPicker';
import { JobListSkeleton } from '../components/Skeletons';
import { SlotLock, isSlotLocked } from '../components/SlotLock';
import { useRequirePortalAuth } from '../hooks/usePortalAuth.tsx';
import {
  usePortalCluster,
  usePortalClusterCompanies,
  usePortalEntitlements,
  usePortalSampleJobs,
} from '../hooks/portalQueries';
import type { DeliveryFrequency } from '../types';
import { careerPageHref, careerPageLabel } from '../utils/format';
import { humanLabel } from '../utils/displayLabels';
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
  const enabled = !loading && Boolean(slug);
  const { data: cluster = null } = usePortalCluster(slug, enabled);
  const { data: sampleJobs = [] } = usePortalSampleJobs(slug, enabled);
  const { data: companies = [], isLoading: companiesLoading } = usePortalClusterCompanies(slug, enabled);
  const { data: entitlements = null } = usePortalEntitlements(enabled);
  const [tab, setTab] = useState(0);
  const [planId, setPlanId] = useState('entitlement');
  const [frequency, setFrequency] = useState<DeliveryFrequency>('24h');
  const [companyQuery, setCompanyQuery] = useState('');

  const filteredCompanies = useMemo(() => {
    const q = companyQuery.trim().toLowerCase();
    if (!q) return companies;
    return companies.filter((name) => name.toLowerCase().includes(q));
  }, [companies, companyQuery]);

  const filteredCareerPages = useMemo(() => {
    const urls = cluster?.careerPageUrls || [];
    const q = companyQuery.trim().toLowerCase();
    if (!q) return urls;
    return urls.filter((url) => {
      const label = careerPageLabel(url).toLowerCase();
      return label.includes(q) || url.toLowerCase().includes(q);
    });
  }, [cluster?.careerPageUrls, companyQuery]);

  useEffect(() => {
    if (!cluster) return;
    setPlanId(cluster.plans[0]?.id || 'entitlement');
  }, [cluster]);

  useEffect(() => {
    if (!entitlements) return;
    const windows = entitlements.allowedWindows || [];
    if (windows.length) setFrequency(windows.includes('12h') ? '12h' : windows[0]);
  }, [entitlements]);

  if (loading || !cluster) return null;

  const selectedPlan = cluster.plans.find((p) => p.id === planId) || cluster.plans[0];
  const locked = isSlotLocked(entitlements);
  const displayName = humanLabel(cluster.name, cluster.kind === 'custom' ? 'Custom cluster' : 'Curated cluster');
  const displayDesc = humanLabel(
    cluster.description,
    cluster.kind === 'custom' ? 'Built from your request' : 'Curated roles from this cluster',
  );
  const goCheckout = () => {
    if (locked) return;
    navigate(`/user/clusters/${slug}/checkout`, { state: { planId: planId || 'entitlement', frequency } });
  };

  const freqLabel =
    frequency === '1h' ? 'Hourly' : frequency === '12h' ? 'Every 12h' : 'Daily';

  return (
    <Box sx={{ pb: { xs: 14, md: 2 } }}>
      <GlassHero dense>
        <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: STITCH.muted, mb: 1.25, fontFamily: BODY_FONT }}>
          <Box component={Link} to="/user/clusters" sx={{ color: 'inherit', textDecoration: 'none', '&:hover': { color: STITCH.primaryContainer } }}>
            Catalog
          </Box>
          {' / '}
          {displayName}
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
                fontSize: { xs: '1.45rem', md: '1.75rem' },
                lineHeight: 1.15,
                color: STITCH.primaryContainer,
              }}
            >
              {displayName}
            </Typography>
            <Typography sx={{ fontSize: '0.75rem', color: STITCH.muted, fontFamily: BODY_FONT }}>
              {cluster.kind === 'custom' ? 'Custom cluster' : 'Curated cluster'} · {cluster.jobCountPreview} openings preview
            </Typography>
          </Box>
        </Stack>

        <Typography sx={{ color: STITCH.muted, mt: 1, maxWidth: 720, fontSize: '0.95rem' }}>
          {displayDesc}
        </Typography>

        <Grid container spacing={1.5} sx={{ mt: 1.5, maxWidth: 360 }}>
          {[
            { label: 'Open tracked', value: String(cluster.jobCountPreview) },
          ].map((stat) => (
            <Grid item xs={6} key={stat.label}>
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
        <Tab
          label={
            (cluster.careerPageUrls || []).length > 0
              ? `Career pages (${cluster.careerPageUrls!.length})`
              : `Companies (${companies.length || '…'})`
          }
        />
      </Tabs>

      {tab === 0 && (
        <Grid container spacing={{ xs: 2, md: 3 }} alignItems="flex-start">
          <Grid item xs={12} md={7} lg={8}>
            <Box sx={{ ...panelSx, p: { xs: 2, md: 3 } }}>
              <Typography sx={{ fontFamily: DISPLAY_FONT, fontWeight: 600, fontSize: '1.15rem', color: STITCH.onSurface, mb: 0.5 }}>
                Activate this cluster
              </Typography>
              <Typography sx={{ color: STITCH.muted, fontSize: '0.875rem', mb: 2.5 }}>
                Uses one plan entitlement slot. Pick a delivery window allowed on your plan.
                {entitlements
                  ? ` You have ${entitlements.availableSlots} of ${entitlements.subscribedSlots ?? entitlements.includedSlots ?? entitlements.maxActiveClusters} slots remaining. Ask ops to raise your allotment after payment for extras.`
                  : ''}
              </Typography>
              <PlanPicker
                plans={cluster.plans}
                selectedPlanId={planId}
                selectedFrequency={frequency}
                allowedWindows={entitlements?.allowedWindows}
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
                  'Filters maintained by ScoutX ops — no setup on your side',
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
            <Box sx={{ position: { md: 'sticky' }, top: { md: 24 } }}>
              <Box sx={{ ...panelSx, p: { xs: 2, md: 2.5 } }}>
                <Chip
                  label="Plan entitlement"
                  size="small"
                  sx={{
                    mb: 1.5,
                    height: 22,
                    borderRadius: RADIUS.pill,
                    fontWeight: 700,
                    fontSize: '0.68rem',
                    bgcolor: tint(STITCH.secondary, 0.18),
                    color: STITCH.primary,
                  }}
                />
                <Typography sx={{ fontFamily: DISPLAY_FONT, fontWeight: 700, color: STITCH.primary }}>
                  Activation summary
                </Typography>
                <Typography sx={{ mt: 0.5, fontSize: '0.875rem', color: STITCH.muted }}>
                  {displayName}
                  {selectedPlan ? ` · ${selectedPlan.name}` : ''}
                </Typography>

                <Stack spacing={1} sx={{ mt: 2 }}>
                  {[
                    ['Plan', entitlements?.subscriptionType || 'Your plan'],
                    ['Delivery interval', freqLabel],
                    ['Slots free', String(entitlements?.availableSlots ?? '—')],
                  ].map(([k, v]) => (
                    <Stack key={k} direction="row" justifyContent="space-between">
                      <Typography sx={{ fontSize: '0.8125rem', color: STITCH.muted }}>{k}</Typography>
                      <Typography sx={{ fontSize: '0.8125rem', fontWeight: 600, color: STITCH.onSurface }}>{v}</Typography>
                    </Stack>
                  ))}
                </Stack>

                <Stack direction="row" justifyContent="space-between" alignItems="baseline" sx={{ mt: 2.5, pt: 2, borderTop: `1px solid ${STITCH.outlineVariant}` }}>
                  <Typography sx={{ fontWeight: 700, color: STITCH.primary }}>Cost</Typography>
                  <Typography sx={{ fontFamily: DISPLAY_FONT, fontWeight: 700, fontSize: '1.25rem', color: STITCH.primary }}>
                    Included
                  </Typography>
                </Stack>

                {locked ? (
                  <Box sx={{ mt: 2.5 }}>
                    <SlotLock entitlements={entitlements} compact />
                  </Box>
                ) : (
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
                )}
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
          <Box>
            <Typography sx={{ fontFamily: DISPLAY_FONT, fontWeight: 600, color: STITCH.onSurface, mb: 0.5 }}>
              Latest openings
            </Typography>
            <Typography sx={{ color: STITCH.muted, fontSize: '0.85rem', mb: 1.25 }}>
              Newest live roles matching this cluster (sorted by last seen).
            </Typography>
            <Box
              sx={{
                borderRadius: RADIUS.card,
                border: `1px solid ${STITCH.outlineVariant}`,
                bgcolor: STITCH.surfaceLowest,
                overflow: 'hidden',
              }}
            >
              {sampleJobs.map((j, idx) => (
                <Box
                  key={j.id}
                  sx={{
                    borderBottom: idx === sampleJobs.length - 1 ? 'none' : `1px solid ${STITCH.outlineVariant}`,
                  }}
                >
                  <FeedListCard job={j} onOpen={(id) => navigate(`/user/jobs/${id}`)} />
                </Box>
              ))}
            </Box>
          </Box>
        ))}

      {tab === 2 && (
        <Box sx={{ ...panelSx, p: { xs: 2.5, md: 3 }, maxWidth: 640 }}>
          <Typography sx={{ fontFamily: DISPLAY_FONT, fontWeight: 600, mb: 1 }}>Delivery schedule</Typography>
          <Typography sx={{ color: STITCH.muted, fontSize: '0.9rem', mb: 2 }}>
            Choose how often ScoutX refreshes this cluster into your feed. Changes apply at the next sync after checkout.
          </Typography>
          <Stack spacing={1}>
            {(
              [
                ['1h', 'Hourly', 'Ultra-fresh roles as they appear'],
                ['12h', 'Every 12 hours', 'Recommended balance of speed and noise'],
                ['24h', 'Daily digest', 'One consolidated batch per day'],
              ] as const
            ).map(([value, title, hint]) => {
              const allowed = !entitlements?.allowedWindows?.length || entitlements.allowedWindows.includes(value);
              const on = frequency === value;
              return (
                <Box
                  key={value}
                  onClick={() => allowed && setFrequency(value)}
                  sx={{
                    p: 2,
                    borderRadius: RADIUS.card,
                    cursor: allowed ? 'pointer' : 'not-allowed',
                    opacity: allowed ? 1 : 0.45,
                    bgcolor: on ? tint(STITCH.secondary, 0.08) : STITCH.surfaceLowest,
                    boxShadow: on ? `inset 0 0 0 2px ${STITCH.secondary}` : `inset 0 0 0 1px ${STITCH.outlineVariant}`,
                  }}
                >
                  <Typography sx={{ fontWeight: 700, color: STITCH.onSurface }}>{title}</Typography>
                  <Typography sx={{ fontSize: '0.8125rem', color: STITCH.muted }}>
                    {allowed ? hint : 'Not included on your plan'}
                  </Typography>
                </Box>
              );
            })}
          </Stack>
        </Box>
      )}

      {tab === 3 && (
        <Box sx={{ ...panelSx, p: { xs: 2, md: 3 } }}>
          {(cluster.careerPageUrls || []).length > 0 ? (
            <>
              <Typography sx={{ fontFamily: DISPLAY_FONT, fontWeight: 600, color: STITCH.onSurface, mb: 0.5 }}>
                Career pages in this cluster
              </Typography>
              <Typography sx={{ color: STITCH.muted, fontSize: '0.85rem', mb: 2 }}>
                Bound career URLs after filters ({(cluster.careerPageUrls || []).length} total).
              </Typography>
              <TextField
                size="small"
                fullWidth
                placeholder="Search career pages…"
                value={companyQuery}
                onChange={(e) => setCompanyQuery(e.target.value)}
                sx={{ mb: 2, maxWidth: 420 }}
              />
              {filteredCareerPages.length === 0 ? (
                <Typography sx={{ color: STITCH.muted, fontSize: '0.875rem' }}>
                  {companyQuery.trim() ? 'No career pages match your search.' : 'No career pages listed yet.'}
                </Typography>
              ) : (
                <Box
                  sx={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 0.75,
                    maxHeight: 480,
                    overflowY: 'auto',
                    pr: 0.5,
                  }}
                >
                  {filteredCareerPages.map((url) => (
                    <Tooltip key={url} title={url} placement="top">
                      <Chip
                        component="a"
                        href={careerPageHref(url)}
                        target="_blank"
                        rel="noopener noreferrer"
                        clickable
                        label={careerPageLabel(url)}
                        size="small"
                        sx={{
                          height: 28,
                          maxWidth: 280,
                          borderRadius: RADIUS.pill,
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          bgcolor: STITCH.surfaceLow,
                          color: STITCH.primaryContainer,
                          border: `1px solid ${STITCH.outlineVariant}`,
                          textDecoration: 'none',
                          '& .MuiChip-label': {
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          },
                        }}
                      />
                    </Tooltip>
                  ))}
                </Box>
              )}
            </>
          ) : (
            <>
              <Typography sx={{ fontFamily: DISPLAY_FONT, fontWeight: 600, color: STITCH.onSurface, mb: 0.5 }}>
                Filters & coverage
              </Typography>
              <Typography sx={{ color: STITCH.muted, fontSize: '0.85rem', mb: 2 }}>
                This cluster is filter-driven (no bound career URLs). Showing filter tags and employer names when available.
              </Typography>
              <Stack direction="row" flexWrap="wrap" gap={0.75} sx={{ mb: 2 }}>
                {(cluster.filtersSummary || []).map((tag) => (
                  <Chip
                    key={tag}
                    label={tag}
                    size="small"
                    sx={{
                      height: 28,
                      borderRadius: RADIUS.pill,
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      bgcolor: STITCH.surfaceContainer,
                      color: STITCH.onSurface,
                    }}
                  />
                ))}
              </Stack>
              <TextField
                size="small"
                fullWidth
                placeholder="Search companies…"
                value={companyQuery}
                onChange={(e) => setCompanyQuery(e.target.value)}
                sx={{ mb: 2, maxWidth: 420 }}
              />
              {companiesLoading ? (
                <Typography sx={{ color: STITCH.muted, fontSize: '0.875rem' }}>Loading companies…</Typography>
              ) : filteredCompanies.length === 0 ? (
                <Typography sx={{ color: STITCH.muted, fontSize: '0.875rem' }}>
                  {companyQuery.trim() ? 'No companies match your search.' : 'No companies listed yet.'}
                </Typography>
              ) : (
                <Box
                  sx={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 0.75,
                    maxHeight: 480,
                    overflowY: 'auto',
                    pr: 0.5,
                  }}
                >
                  {filteredCompanies.map((name) => (
                    <Chip
                      key={name}
                      label={name}
                      size="small"
                      sx={{
                        height: 28,
                        borderRadius: RADIUS.pill,
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        bgcolor: STITCH.surfaceLow,
                        color: STITCH.primaryContainer,
                        border: `1px solid ${STITCH.outlineVariant}`,
                      }}
                    />
                  ))}
                </Box>
              )}
            </>
          )}
        </Box>
      )}

      {!locked && <PlanPickerStickyBar onSubscribe={goCheckout} label="Continue" />}
    </Box>
  );
}
