import React, { useMemo, useState } from 'react';
import { Box, Button, Chip, Grid, InputAdornment, Stack, TextField, Typography } from '@mui/material';
import AddCircleOutline from '@mui/icons-material/AddCircleOutline';
import ArrowForward from '@mui/icons-material/ArrowForward';
import SearchOffOutlined from '@mui/icons-material/SearchOffOutlined';
import SearchOutlined from '@mui/icons-material/SearchOutlined';
import { Link, useLocation } from 'react-router-dom';
import { ClusterCard } from '../components/ClusterCard';
import { EmptyState } from '../components/EmptyState';
import { GlassHero } from '../components/GlassHero';
import { ClusterGridSkeleton } from '../components/Skeletons';
import { SlotLock, isSlotLocked } from '../components/SlotLock';
import { useRequirePortalAuth } from '../hooks/usePortalAuth.tsx';
import {
  usePortalClusters,
  usePortalEntitlements,
  usePortalSubscriptions,
} from '../hooks/portalQueries';
import { pluralize } from '../utils/format';
import {
  BODY_FONT,
  DISPLAY_FONT,
  RADIUS,
  STITCH,
  ghostButtonSx,
  primaryButtonSx,
  tint,
} from '../tokens';

const INDUSTRIES = [
  { key: '', label: 'All Clusters' },
  { key: 'Software', label: 'Curated Tech' },
  { key: 'Banking', label: 'Finance & Banking' },
  { key: 'H-1B', label: 'H-1B Sponsor Heavy' },
  { key: 'Remote', label: 'Remote Focused' },
  { key: 'Custom', label: 'Custom Built' },
];

export function ClustersPage() {
  const { loading } = useRequirePortalAuth();
  const location = useLocation();
  const pickState = location.state as { pickSlots?: number; planLabel?: string } | null;
  const enabled = !loading;
  const { data: clusters = [], isLoading: clustersLoading } = usePortalClusters(enabled);
  const { data: subs = [] } = usePortalSubscriptions(enabled);
  const { data: entitlements = null } = usePortalEntitlements(enabled);
  const ready = !clustersLoading;
  const subscribedIds = useMemo(
    () => new Set(subs.filter((s) => s.status !== 'pending').map((s) => s.clusterId)),
    [subs]
  );
  const [search, setSearch] = useState('');
  const [industryFilter, setIndustryFilter] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return clusters.filter((c) => {
      const companies = (c.includedCompanies || []).join(' ');
      const careerPages = (c.careerPageUrls || []).join(' ');
      const roles = (c.filter?.frozenCategories || []).join(' ');
      const locations = (c.filter?.frozenStates || []).join(' ');
      const hay = `${c.name} ${c.description} ${(c.filtersSummary || []).join(' ')} ${companies} ${careerPages} ${roles} ${locations}`.toLowerCase();
      const matchSearch = !q || hay.includes(q);
      if (!industryFilter) return matchSearch;
      if (industryFilter === 'Custom') return matchSearch && c.kind === 'custom';
      if (industryFilter === 'H-1B') {
        return (
          matchSearch &&
          (c.filtersSummary.some((f) => /h-?1b|sponsor/i.test(f)) || /h-?1b|sponsor/i.test(c.description))
        );
      }
      if (industryFilter === 'Remote') {
        return matchSearch && c.filtersSummary.some((f) => /remote/i.test(f));
      }
      return (
        matchSearch &&
        c.filtersSummary.some((f) => f.toLowerCase().includes(industryFilter.toLowerCase()))
      );
    });
  }, [clusters, search, industryFilter]);

  if (loading) return null;

  const totalJobs = clusters.reduce((sum, c) => sum + c.jobCountPreview, 0);
  const hasFilters = Boolean(search.trim() || industryFilter);
  const planSlots =
    entitlements?.subscribedSlots ??
    entitlements?.includedSlots ??
    entitlements?.maxActiveClusters ??
    pickState?.pickSlots ??
    0;
  const used = entitlements?.activeClusterCount ?? entitlements?.includedActiveCount ?? 0;
  const remaining =
    entitlements?.availableSlots ?? Math.max(0, planSlots - used);
  const showPickBanner =
    Boolean(pickState?.pickSlots) ||
    (Boolean(entitlements?.clusterServiceStarted) && remaining > 0);
  const locked = isSlotLocked(entitlements);
  const showLockBanner =
    Boolean(entitlements?.clusterServiceStarted) && remaining === 0 && locked;

  return (
    <Box data-tour="scoutx-clusters-page">
      <GlassHero dense>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          justifyContent="space-between"
          alignItems={{ md: 'flex-start' }}
          spacing={2}
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
                bgcolor: STITCH.secondaryContainer,
                mb: 1.5,
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
                Real-time syndication
              </Typography>
            </Box>
            <Typography
              component="h1"
              sx={{
                fontFamily: DISPLAY_FONT,
                fontWeight: 700,
                letterSpacing: '-0.02em',
                fontSize: { xs: '1.5rem', md: '1.85rem' },
                lineHeight: 1.15,
                color: STITCH.primaryContainer,
              }}
            >
              Cluster Catalog
            </Typography>
            <Typography sx={{ mt: 1, color: STITCH.muted, maxWidth: 520 }}>
              Subscribe to curated or customized real-time job clusters delivered directly to your feed on a 1h, 2h,
              or 24h cadence.
            </Typography>
          </Box>
          <Button
            component={Link}
            to="/user/requests/new"
            variant="outlined"
            startIcon={<AddCircleOutline sx={{ fontSize: 18 }} />}
            sx={{
              ...ghostButtonSx,
              flexShrink: 0,
              alignSelf: { md: 'center' },
            }}
          >
            Request Custom Cluster
          </Button>
        </Stack>

        <Grid
          container
          spacing={2}
          sx={{
            mt: 1.5,
            pt: 1.5,
            borderTop: `1px solid ${STITCH.outlineVariant}`,
          }}
        >
          {[
            { value: `${totalJobs.toLocaleString()}+`, label: 'Active openings tracked' },
            { value: String(clusters.length), label: 'Live curated clusters' },
          ].map((m) => (
            <Grid item xs={6} md={3} key={m.label}>
              <Typography sx={{ fontFamily: DISPLAY_FONT, fontWeight: 700, fontSize: '1.25rem', color: STITCH.primary }}>
                {m.value}
              </Typography>
              <Typography sx={{ fontSize: '0.75rem', color: STITCH.muted }}>{m.label}</Typography>
            </Grid>
          ))}
        </Grid>
      </GlassHero>

      {showPickBanner && remaining > 0 && (
        <Box
          sx={{
            mb: 2.5,
            p: 2,
            borderRadius: RADIUS.card,
            bgcolor: tint(STITCH.secondaryBright, 0.12),
            border: `1px solid ${tint(STITCH.secondaryBright, 0.35)}`,
          }}
        >
          <Typography sx={{ fontFamily: DISPLAY_FONT, fontWeight: 700, color: STITCH.primary, fontSize: '1.05rem' }}>
            Pick {remaining} cluster{remaining === 1 ? '' : 's'}
          </Typography>
          <Typography sx={{ mt: 0.5, fontSize: '0.875rem', color: STITCH.muted }}>
            {pickState?.planLabel || entitlements?.subscriptionTypeDisplay || 'Your plan'} includes{' '}
            {planSlots} free slot{planSlots === 1 ? '' : 's'}
            {used > 0 ? ` · ${used} already active` : ''}. Extra clusters require payment —
            unlock is not available in ScoutX yet.
          </Typography>
        </Box>
      )}

      {showLockBanner && (
        <SlotLock entitlements={entitlements} compact sx={{ mb: 2.5 }} />
      )}

      <Stack spacing={1.75} sx={{ mb: 2.5 }}>
        <TextField
          size="small"
          fullWidth
          placeholder="Search clusters by company, role, or location…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{
            maxWidth: '100%',
            '& .MuiOutlinedInput-root': {
              borderRadius: RADIUS.control,
              bgcolor: STITCH.surfaceLowest,
              '& fieldset': { borderColor: STITCH.border },
              '&:hover fieldset': { borderColor: tint(STITCH.secondaryBright, 0.5) },
              '&.Mui-focused fieldset': { borderColor: STITCH.secondaryBright },
              '&.Mui-focused': { boxShadow: `0 0 0 3px ${tint(STITCH.secondaryBright, 0.2)}` },
            },
          }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchOutlined sx={{ fontSize: 18, color: STITCH.muted }} />
              </InputAdornment>
            ),
          }}
        />

        <Stack direction="row" flexWrap="wrap" gap={0.75}>
          {INDUSTRIES.map(({ key, label }) => {
            const active = industryFilter === key;
            const count =
              key === ''
                ? clusters.length
                : key === 'Custom'
                  ? clusters.filter((c) => c.kind === 'custom').length
                  : key === 'H-1B'
                    ? clusters.filter(
                        (c) =>
                          c.filtersSummary.some((f) => /h-?1b|sponsor/i.test(f)) ||
                          /h-?1b|sponsor/i.test(c.description),
                      ).length
                    : key === 'Remote'
                      ? clusters.filter((c) => c.filtersSummary.some((f) => /remote/i.test(f))).length
                      : clusters.filter((c) =>
                          c.filtersSummary.some((f) => f.toLowerCase().includes(key.toLowerCase())),
                        ).length;
            return (
              <Chip
                key={key || 'all'}
                label={key === '' ? `${label} (${count})` : label}
                onClick={() => setIndustryFilter(key)}
                sx={{
                  borderRadius: RADIUS.pill,
                  fontWeight: active ? 700 : 500,
                  flexShrink: 0,
                  border: 'none',
                  bgcolor: active ? STITCH.primaryContainer : STITCH.surfaceLowest,
                  color: active ? STITCH.onPrimary : STITCH.muted,
                  boxShadow: active ? 'none' : `inset 0 0 0 1px ${STITCH.border}`,
                  '&:hover': {
                    bgcolor: active ? STITCH.primaryContainer : tint(STITCH.secondaryBright, 0.08),
                  },
                }}
              />
            );
          })}
        </Stack>

        {ready && (
          <Typography sx={{ color: STITCH.muted, fontSize: '0.875rem' }}>
            {filtered.length} {pluralize(filtered.length, 'cluster')}
            {hasFilters ? ' match your filters' : ' available'}
          </Typography>
        )}
      </Stack>

      {!ready ? (
        <ClusterGridSkeleton count={6} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={SearchOffOutlined}
          variant="filtered"
          title="No clusters match that search"
          description="Try a broader keyword or clear the industry filter. If the niche you want doesn't exist yet, request it."
          actionLabel="Clear filters"
          onAction={() => {
            setSearch('');
            setIndustryFilter('');
          }}
          secondaryLabel="Request a cluster"
          secondaryTo="/user/requests/new"
        />
      ) : (
        <Grid container spacing={1.75}>
          {filtered.map((c) => (
            <Grid item xs={12} sm={6} lg={4} xl={3} key={c.id}>
              <ClusterCard
                cluster={c}
                subscribed={subscribedIds.has(c.id)}
                locked={locked}
              />
            </Grid>
          ))}
        </Grid>
      )}

      <Box
        sx={{
          mt: 4,
          p: { xs: 3, md: 4 },
          borderRadius: RADIUS.panel,
          bgcolor: STITCH.surfaceLow,
          display: 'flex',
          flexDirection: { xs: 'column', md: 'row' },
          alignItems: { md: 'center' },
          justifyContent: 'space-between',
          gap: 3,
        }}
      >
        <Box sx={{ maxWidth: 560 }}>
          <Chip
            label="Tailored Automation"
            size="small"
            sx={{
              mb: 1.5,
              borderRadius: RADIUS.pill,
              fontWeight: 700,
              bgcolor: STITCH.secondaryContainer,
              color: STITCH.onSecondaryContainer,
            }}
          />
          <Typography sx={{ fontFamily: DISPLAY_FONT, fontWeight: 600, fontSize: '1.35rem', color: STITCH.onSurface }}>
            Can&apos;t find your exact niche? Build a custom cluster in 2 minutes.
          </Typography>
          <Typography sx={{ mt: 0.75, color: STITCH.onSurfaceVariant }}>
            Describe the roles, companies and locations you want — we&apos;ll build and maintain the filters for you.
          </Typography>
        </Box>
        <Button
          component={Link}
          to="/user/requests/new"
          variant="contained"
          disableElevation
          endIcon={<ArrowForward sx={{ fontSize: 16 }} />}
          sx={{ ...primaryButtonSx, flexShrink: 0, py: 1.35, px: 3 }}
        >
          Launch Cluster Builder
        </Button>
      </Box>
    </Box>
  );
}
