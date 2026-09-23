import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  MenuItem,
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import AddIcon from '@mui/icons-material/Add';
import PeopleOutlineIcon from '@mui/icons-material/PeopleOutline';
import CategoryOutlinedIcon from '@mui/icons-material/CategoryOutlined';
import InboxOutlinedIcon from '@mui/icons-material/InboxOutlined';
import BookmarkBorderIcon from '@mui/icons-material/BookmarkBorder';
import BoltOutlinedIcon from '@mui/icons-material/BoltOutlined';
import DraftsOutlinedIcon from '@mui/icons-material/DraftsOutlined';
import LinkOutlinedIcon from '@mui/icons-material/LinkOutlined';
import TuneOutlinedIcon from '@mui/icons-material/TuneOutlined';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import ArchiveOutlinedIcon from '@mui/icons-material/ArchiveOutlined';
import { useNavigate } from 'react-router-dom';
import {
  adminArchiveCluster,
  adminCreateCluster,
  adminCreateDraftFromRequest,
  adminDuplicateCluster,
  adminListClusterRequests,
  adminListClusters,
  adminPatchClusterRequest,
  adminPublishCluster,
  adminBindClusterSources,
  getClusterStudioOverview,
  type AdminCluster,
  type AdminClusterRequest,
  type ClusterStudioOverview,
} from '../api/adminClusters';
import { RequestTriageDialog } from './RequestTriageDialog';
import { FROZEN_INDUSTRIES } from '../shared/frozenIndustries';
import { FROZEN_JOB_CATEGORIES } from '../shared/frozenJobCategories';
import { OpsHeroBackdrop } from '../components/dashboard/ops/OpsHeroBackdrop';
import { StatCard } from '../components/dashboard/ops/StatCard';
import {
  FIRSTSTEP,
  METRIC_COLORS,
  cardSx,
  fadeUpSx,
  heroGlassPanelSx,
  tint,
} from '../components/dashboard/ops/dashboardTokens';

type RequestFilter = 'all' | 'open' | 'published' | 'rejected';
type ClusterFilter = 'all' | 'published' | 'draft' | 'archived';

const STATUS_CHIP: Record<string, { bg: string; color: string }> = {
  submitted: { bg: tint(FIRSTSTEP.warning, 0.16), color: '#b45309' },
  in_review: { bg: tint(FIRSTSTEP.tealDark, 0.16), color: FIRSTSTEP.tealDark },
  published: { bg: tint(FIRSTSTEP.success, 0.16), color: FIRSTSTEP.successDeep },
  rejected: { bg: tint(FIRSTSTEP.danger, 0.12), color: FIRSTSTEP.danger },
  draft: { bg: tint(FIRSTSTEP.navy, 0.08), color: FIRSTSTEP.navy },
  archived: { bg: tint(FIRSTSTEP.textMuted, 0.14), color: FIRSTSTEP.textMuted },
};

function StatusChip({ label }: { label: string }) {
  const tone = STATUS_CHIP[label] || { bg: tint(FIRSTSTEP.navy, 0.08), color: FIRSTSTEP.navy };
  return (
    <Chip
      size="small"
      label={label.replace(/_/g, ' ')}
      sx={{
        height: 24,
        fontWeight: 700,
        fontSize: '0.7rem',
        textTransform: 'capitalize',
        bgcolor: tone.bg,
        color: tone.color,
        border: 'none',
      }}
    />
  );
}

function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <Paper
      elevation={0}
      sx={[
        cardSx(),
        {
          p: { xs: 3, md: 5 },
          textAlign: 'center',
          borderStyle: 'dashed',
          borderColor: tint(FIRSTSTEP.teal, 0.35),
          bgcolor: tint(FIRSTSTEP.teal, 0.04),
        },
      ]}
    >
      <Typography sx={{ fontWeight: 700, color: FIRSTSTEP.navyDeep, mb: 0.75 }}>{title}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 420, mx: 'auto', mb: action ? 2 : 0 }}>
        {description}
      </Typography>
      {action}
    </Paper>
  );
}

function FilterPills<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ id: T; label: string; count?: number }>;
}) {
  return (
    <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
      {options.map((opt) => {
        const active = value === opt.id;
        return (
          <Chip
            key={opt.id}
            clickable
            onClick={() => onChange(opt.id)}
            label={opt.count != null ? `${opt.label} (${opt.count})` : opt.label}
            sx={{
              fontWeight: active ? 700 : 500,
              bgcolor: active ? tint(FIRSTSTEP.teal, 0.18) : FIRSTSTEP.white,
              color: active ? FIRSTSTEP.tealDark : FIRSTSTEP.navy,
              border: `1px solid ${active ? tint(FIRSTSTEP.teal, 0.45) : FIRSTSTEP.border}`,
              '&:hover': { bgcolor: tint(FIRSTSTEP.teal, 0.12) },
            }}
          />
        );
      })}
    </Stack>
  );
}

export function ClusterStudioPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [overview, setOverview] = useState<ClusterStudioOverview | null>(null);
  const [requests, setRequests] = useState<AdminClusterRequest[]>([]);
  const [clusters, setClusters] = useState<AdminCluster[]>([]);
  const [requestFilter, setRequestFilter] = useState<RequestFilter>('open');
  const [clusterFilter, setClusterFilter] = useState<ClusterFilter>('all');
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [industries, setIndustries] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [fulfillingId, setFulfillingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [triageRequest, setTriageRequest] = useState<AdminClusterRequest | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ov, reqs, cls] = await Promise.all([
        getClusterStudioOverview(),
        adminListClusterRequests(),
        adminListClusters(),
      ]);
      setOverview(ov);
      setRequests(reqs.requests || []);
      setClusters(cls.clusters || []);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to load cluster studio');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const toggle = (list: string[], value: string, setter: (v: string[]) => void) => {
    setter(list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);
  };

  const createCurated = async () => {
    const created = await adminCreateCluster({
      name,
      slug: slug || undefined,
      description,
      kind: 'curated',
      status: 'draft',
      filter: {
        frozenIndustries: industries,
        frozenCategories: categories,
        frozenStates: [],
        frozenExperienceLevels: [],
        frozenExperienceYears: [],
        excludeStudentEscape: true,
      },
    });
    setCreateOpen(false);
    setName('');
    setSlug('');
    setDescription('');
    setIndustries([]);
    setCategories([]);
    navigate(`/clusters/${created.id}`);
  };

  const openAsDraft = async (req: AdminClusterRequest) => {
    setFulfillingId(req.id);
    try {
      const result = await adminCreateDraftFromRequest(req.id);
      navigate(`/clusters/${result.cluster.id}`);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to open draft');
    } finally {
      setFulfillingId(null);
    }
  };

  const fulfillRequest = async (req: AdminClusterRequest) => {
    setFulfillingId(req.id);
    try {
      const draft = await adminCreateDraftFromRequest(req.id);
      if (req.type === 'custom_urls' && req.urls?.length) {
        await adminBindClusterSources(draft.cluster.id, {
          urls: req.urls,
          createRobots: true,
          companyNames: req.companies || [],
        });
      }
      await adminPublishCluster(draft.cluster.id, { requestId: req.id });
      await adminPatchClusterRequest(req.id, { status: 'published', resultClusterId: draft.cluster.id });
      await refresh();
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Fulfill failed');
    } finally {
      setFulfillingId(null);
    }
  };

  const totals = overview?.totals;

  const filteredRequests = useMemo(() => {
    const q = search.trim().toLowerCase();
    return requests.filter((req) => {
      if (requestFilter === 'open' && !['submitted', 'in_review'].includes(req.status)) return false;
      if (requestFilter === 'published' && req.status !== 'published') return false;
      if (requestFilter === 'rejected' && req.status !== 'rejected') return false;
      if (!q) return true;
      const hay = [req.title, req.auth0Sub, req.type, ...(req.industries || []), ...(req.roles || [])]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [requests, requestFilter, search]);

  const filteredClusters = useMemo(() => {
    const q = search.trim().toLowerCase();
    return clusters.filter((c) => {
      if (clusterFilter !== 'all' && c.status !== clusterFilter) return false;
      if (!q) return true;
      const hay = [c.name, c.slug, c.kind, ...(c.filtersSummary || [])].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [clusters, clusterFilter, search]);

  const openRequestCount = requests.filter((r) => ['submitted', 'in_review'].includes(r.status)).length;

  return (
    <Box
      sx={{
        p: { xs: 2, md: 3 },
        minHeight: '100%',
        bgcolor: (theme) => (theme.palette.mode === 'dark' ? '#000' : FIRSTSTEP.surface),
      }}
    >
      <Paper
        elevation={0}
        sx={[fadeUpSx(0), heroGlassPanelSx({ mb: 3, shadow: 'lifted' }), { p: { xs: 2.5, md: 3.5 } }]}
      >
        <OpsHeroBackdrop />
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          justifyContent="space-between"
          alignItems={{ md: 'flex-start' }}
          spacing={2}
          sx={{ position: 'relative', zIndex: 1 }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography
              sx={{
                fontSize: '0.7rem',
                fontWeight: 700,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: FIRSTSTEP.tealDark,
                mb: 0.75,
              }}
            >
              Portal ops
            </Typography>
            <Typography
              variant="h4"
              sx={{
                fontWeight: 800,
                letterSpacing: '-0.02em',
                color: FIRSTSTEP.navyDeep,
                lineHeight: 1.15,
              }}
            >
              Clusters
            </Typography>
            <Typography
              variant="body2"
              sx={{ mt: 1, maxWidth: 560, color: FIRSTSTEP.textMuted, lineHeight: 1.55 }}
            >
              Triage custom requests, publish curated clusters, and monitor portal usage. Subscription billing
              stays on First Step.
            </Typography>
            <Stack direction="row" spacing={1} sx={{ mt: 2 }} flexWrap="wrap" useFlexGap>
              <Chip
                size="small"
                icon={<InboxOutlinedIcon sx={{ fontSize: '16px !important' }} />}
                label={`${openRequestCount} open requests`}
                sx={{ fontWeight: 600, bgcolor: tint(FIRSTSTEP.warning, 0.14), color: '#b45309' }}
              />
              <Chip
                size="small"
                icon={<CategoryOutlinedIcon sx={{ fontSize: '16px !important' }} />}
                label={`${totals?.publishedClusters ?? 0} live clusters`}
                sx={{ fontWeight: 600, bgcolor: tint(FIRSTSTEP.teal, 0.14), color: FIRSTSTEP.tealDark }}
              />
            </Stack>
          </Box>
          <Stack direction="row" spacing={1} flexShrink={0}>
            <Button
              startIcon={<RefreshIcon />}
              onClick={() => void refresh()}
              disabled={loading}
              sx={{
                textTransform: 'none',
                fontWeight: 600,
                borderRadius: '12px',
                borderColor: tint(FIRSTSTEP.teal, 0.5),
                color: FIRSTSTEP.navy,
              }}
              variant="outlined"
            >
              Refresh
            </Button>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => navigate('/clusters/new')}
              sx={{
                textTransform: 'none',
                fontWeight: 700,
                borderRadius: '12px',
                bgcolor: FIRSTSTEP.tealDark,
                boxShadow: `0 8px 20px ${tint(FIRSTSTEP.tealDark, 0.28)}`,
                '&:hover': { bgcolor: FIRSTSTEP.navy },
              }}
            >
              New curated cluster
            </Button>
          </Stack>
        </Stack>
      </Paper>

      {error && (
        <Alert severity="error" sx={{ mb: 2, borderRadius: '12px' }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {loading && !overview ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 10 }}>
          <CircularProgress sx={{ color: FIRSTSTEP.tealDark }} />
        </Box>
      ) : (
        <>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: {
                xs: 'repeat(2, minmax(0, 1fr))',
                md: 'repeat(3, minmax(0, 1fr))',
                xl: 'repeat(6, minmax(0, 1fr))',
              },
              gap: 2,
              mb: 3,
            }}
          >
            <StatCard
              label="Portal users"
              value={totals?.portalUsers ?? '—'}
              color={METRIC_COLORS.runs}
              icon={<PeopleOutlineIcon />}
              delay={0}
            />
            <StatCard
              label="Published"
              value={totals?.publishedClusters ?? '—'}
              hint="Live in browse"
              color={METRIC_COLORS.jobs}
              icon={<CategoryOutlinedIcon />}
              delay={40}
            />
            <StatCard
              label="Open requests"
              value={totals?.openRequests ?? '—'}
              hint="Submitted + in review"
              color={METRIC_COLORS.credits}
              icon={<InboxOutlinedIcon />}
              delay={80}
            />
            <StatCard
              label="Activations"
              value={totals?.activeSubscriptions ?? '—'}
              hint="Entitlement slots in use"
              color={METRIC_COLORS.active}
              icon={<BoltOutlinedIcon />}
              delay={120}
            />
            <StatCard
              label="Saved jobs"
              value={totals?.savedJobs ?? '—'}
              color={METRIC_COLORS.passed}
              icon={<BookmarkBorderIcon />}
              delay={160}
            />
            <StatCard
              label="Drafts"
              value={totals?.draftClusters ?? '—'}
              color={METRIC_COLORS.rows}
              icon={<DraftsOutlinedIcon />}
              delay={200}
            />
          </Box>

          <Paper elevation={0} sx={[cardSx(), fadeUpSx(80), { p: { xs: 1.5, md: 2 }, mb: 2 }]}>
            <Stack
              direction={{ xs: 'column', md: 'row' }}
              spacing={1.5}
              alignItems={{ md: 'center' }}
              justifyContent="space-between"
            >
              <Tabs
                value={tab}
                onChange={(_, v) => {
                  setTab(v);
                  setSearch('');
                }}
                sx={{
                  minHeight: 40,
                  '& .MuiTab-root': {
                    textTransform: 'none',
                    fontWeight: 650,
                    minHeight: 40,
                    fontSize: '0.92rem',
                  },
                  '& .Mui-selected': { color: `${FIRSTSTEP.tealDark} !important` },
                  '& .MuiTabs-indicator': { bgcolor: FIRSTSTEP.tealDark, height: 3, borderRadius: 2 },
                }}
              >
                <Tab label={`Requests (${requests.length})`} />
                <Tab label={`All clusters (${clusters.length})`} />
              </Tabs>
              <TextField
                size="small"
                placeholder={tab === 0 ? 'Search requests…' : 'Search clusters…'}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                sx={{
                  minWidth: { md: 260 },
                  '& .MuiOutlinedInput-root': { borderRadius: '12px', bgcolor: FIRSTSTEP.white },
                }}
              />
            </Stack>
          </Paper>

          {tab === 0 ? (
            <Stack spacing={2}>
              <FilterPills
                value={requestFilter}
                onChange={setRequestFilter}
                options={[
                  { id: 'open', label: 'Open', count: openRequestCount },
                  { id: 'all', label: 'All', count: requests.length },
                  {
                    id: 'published',
                    label: 'Published',
                    count: requests.filter((r) => r.status === 'published').length,
                  },
                  {
                    id: 'rejected',
                    label: 'Rejected',
                    count: requests.filter((r) => r.status === 'rejected').length,
                  },
                ]}
              />

              {filteredRequests.length === 0 ? (
                <EmptyState
                  title="No requests in this view"
                  description="When a portal user submits a predefined or custom-URL cluster request, it will show up here for triage."
                />
              ) : (
                filteredRequests.map((req, idx) => (
                  <Paper
                    key={req.id}
                    elevation={0}
                    onClick={() => setTriageRequest(req)}
                    sx={[
                      cardSx(),
                      fadeUpSx(Math.min(idx * 30, 180)),
                      {
                        p: { xs: 2, md: 2.5 },
                        cursor: 'pointer',
                        '&:hover': { boxShadow: `0 8px 28px ${tint(FIRSTSTEP.navy, 0.12)}` },
                      },
                    ]}
                  >
                    <Stack
                      direction={{ xs: 'column', md: 'row' }}
                      justifyContent="space-between"
                      alignItems={{ md: 'flex-start' }}
                      spacing={2}
                    >
                      <Box sx={{ minWidth: 0, flex: 1 }}>
                        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }} flexWrap="wrap" useFlexGap>
                          <Typography sx={{ fontWeight: 750, fontSize: '1.05rem', color: FIRSTSTEP.navyDeep }}>
                            {req.title}
                          </Typography>
                          <StatusChip label={req.status} />
                          <Chip
                            size="small"
                            icon={
                              req.type === 'custom_urls' ? (
                                <LinkOutlinedIcon sx={{ fontSize: '15px !important' }} />
                              ) : (
                                <TuneOutlinedIcon sx={{ fontSize: '15px !important' }} />
                              )
                            }
                            label={req.type === 'custom_urls' ? 'Custom URLs' : 'Predefined'}
                            variant="outlined"
                            sx={{ height: 24, fontWeight: 600, borderColor: FIRSTSTEP.border }}
                          />
                        </Stack>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.25 }}>
                          {req.auth0Sub} · {new Date(req.submittedAt).toLocaleString()}
                        </Typography>
                        <Box
                          sx={{
                            display: 'grid',
                            gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
                            gap: 1,
                          }}
                        >
                          <MetaRow label="Industries" value={(req.industries || []).join(', ') || '—'} />
                          <MetaRow label="Roles" value={(req.roles || []).join(', ') || '—'} />
                          <MetaRow label="Locations" value={(req.locations || []).join(', ') || '—'} />
                          {req.companies?.length ? (
                            <MetaRow label="Companies" value={req.companies.join(', ')} />
                          ) : null}
                        </Box>
                        {req.urls?.length ? (
                          <Box sx={{ mt: 1.25 }}>
                            <Typography
                              sx={{
                                fontSize: '0.68rem',
                                fontWeight: 700,
                                letterSpacing: '0.06em',
                                textTransform: 'uppercase',
                                color: FIRSTSTEP.textMuted,
                                mb: 0.5,
                              }}
                            >
                              Career URLs ({req.urls.length})
                            </Typography>
                            <Stack spacing={0.35}>
                              {req.urls.map((url) => (
                                <Typography
                                  key={url}
                                  variant="body2"
                                  sx={{ wordBreak: 'break-all', color: FIRSTSTEP.tealDark }}
                                >
                                  {url}
                                </Typography>
                              ))}
                            </Stack>
                          </Box>
                        ) : null}
                        {req.notes ? (
                          <Typography
                            variant="body2"
                            sx={{
                              mt: 1.25,
                              p: 1.25,
                              borderRadius: '10px',
                              bgcolor: tint(FIRSTSTEP.navy, 0.04),
                              fontStyle: 'italic',
                              color: FIRSTSTEP.navy,
                            }}
                          >
                            {req.notes}
                          </Typography>
                        ) : null}
                      </Box>

                      <Stack
                        spacing={1}
                        flexShrink={0}
                        sx={{ minWidth: { md: 160 } }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Button
                          size="small"
                          variant="contained"
                          onClick={() => setTriageRequest(req)}
                          sx={{
                            textTransform: 'none',
                            fontWeight: 700,
                            borderRadius: '10px',
                            bgcolor: FIRSTSTEP.navy,
                            '&:hover': { bgcolor: FIRSTSTEP.navyDeep },
                          }}
                        >
                          Triage
                        </Button>
                        {req.status !== 'published' && req.status !== 'rejected' && (
                          <Button
                            size="small"
                            variant="outlined"
                            disabled={fulfillingId === req.id}
                            onClick={() => void openAsDraft(req)}
                            sx={{
                              textTransform: 'none',
                              fontWeight: 700,
                              borderRadius: '10px',
                            }}
                          >
                            {fulfillingId === req.id ? 'Working…' : 'Open as draft'}
                          </Button>
                        )}
                        {req.resultClusterId ? (
                          <Button
                            size="small"
                            variant="outlined"
                            startIcon={<OpenInNewIcon />}
                            onClick={() => navigate(`/clusters/${req.resultClusterId}`)}
                            sx={{ textTransform: 'none', fontWeight: 600, borderRadius: '10px' }}
                          >
                            Open cluster
                          </Button>
                        ) : null}
                        {req.status !== 'published' && req.status !== 'rejected' && (
                          <Button
                            size="small"
                            disabled={fulfillingId === req.id}
                            onClick={() => {
                              if (window.confirm('Fulfill and publish immediately without editing?')) {
                                void fulfillRequest(req);
                              }
                            }}
                            sx={{ textTransform: 'none', fontWeight: 600 }}
                          >
                            Fulfill & publish
                          </Button>
                        )}
                        {req.status === 'submitted' && (
                          <Button
                            size="small"
                            variant="outlined"
                            onClick={() =>
                              void adminPatchClusterRequest(req.id, { status: 'in_review' }).then(refresh)
                            }
                            sx={{ textTransform: 'none', fontWeight: 600, borderRadius: '10px' }}
                          >
                            Mark in review
                          </Button>
                        )}
                        {req.status !== 'rejected' && req.status !== 'published' && (
                          <Button
                            size="small"
                            color="error"
                            onClick={() =>
                              void adminPatchClusterRequest(req.id, { status: 'rejected' }).then(refresh)
                            }
                            sx={{ textTransform: 'none', fontWeight: 600, borderRadius: '10px' }}
                          >
                            Reject
                          </Button>
                        )}
                      </Stack>
                    </Stack>
                  </Paper>
                ))
              )}
            </Stack>
          ) : (
            <Stack spacing={2}>
              <FilterPills
                value={clusterFilter}
                onChange={setClusterFilter}
                options={[
                  { id: 'all', label: 'All', count: clusters.length },
                  {
                    id: 'published',
                    label: 'Published',
                    count: clusters.filter((c) => c.status === 'published').length,
                  },
                  {
                    id: 'draft',
                    label: 'Draft',
                    count: clusters.filter((c) => c.status === 'draft').length,
                  },
                  {
                    id: 'archived',
                    label: 'Archived',
                    count: clusters.filter((c) => c.status === 'archived').length,
                  },
                ]}
              />

              {filteredClusters.length === 0 ? (
                <EmptyState
                  title="No clusters in this view"
                  description="Create a curated draft or fulfill a portal request to populate the catalog."
                  action={
                    <Button
                      variant="contained"
                      startIcon={<AddIcon />}
                      onClick={() => navigate('/clusters/new')}
                      sx={{
                        textTransform: 'none',
                        fontWeight: 700,
                        borderRadius: '12px',
                        bgcolor: FIRSTSTEP.tealDark,
                      }}
                    >
                      New curated cluster
                    </Button>
                  }
                />
              ) : (
                filteredClusters.map((c, idx) => (
                  <Paper
                    key={c.id}
                    elevation={0}
                    sx={[
                      cardSx(),
                      fadeUpSx(Math.min(idx * 30, 180)),
                      {
                        p: { xs: 2, md: 2.5 },
                        cursor: 'pointer',
                        '&:hover': { borderColor: tint(FIRSTSTEP.teal, 0.45) },
                      },
                    ]}
                    onClick={() => navigate(`/clusters/${c.id}`)}
                  >
                    <Stack
                      direction={{ xs: 'column', sm: 'row' }}
                      justifyContent="space-between"
                      alignItems={{ sm: 'center' }}
                      spacing={2}
                    >
                      <Box sx={{ minWidth: 0 }}>
                        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 0.75 }}>
                          <Typography sx={{ fontWeight: 750, fontSize: '1.05rem', color: FIRSTSTEP.navyDeep }}>
                            {c.name}
                          </Typography>
                          <StatusChip label={c.status} />
                          <Chip
                            size="small"
                            label={c.kind}
                            variant="outlined"
                            sx={{ height: 24, fontWeight: 600, textTransform: 'capitalize' }}
                          />
                        </Stack>
                        <Typography variant="body2" color="text.secondary">
                          /{c.slug} · preview ~{c.jobCountPreview.toLocaleString()} jobs
                        </Typography>
                        {(c.filtersSummary || []).length > 0 && (
                          <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
                            {(c.filtersSummary || []).map((f) => (
                              <Chip
                                key={f}
                                size="small"
                                label={f}
                                sx={{
                                  height: 22,
                                  fontSize: '0.7rem',
                                  bgcolor: tint(FIRSTSTEP.teal, 0.1),
                                  color: FIRSTSTEP.navy,
                                }}
                              />
                            ))}
                          </Stack>
                        )}
                      </Box>
                      <Stack
                        direction="row"
                        spacing={1}
                        flexShrink={0}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={<OpenInNewIcon />}
                          onClick={() => navigate(`/clusters/${c.id}`)}
                          sx={{ textTransform: 'none', fontWeight: 600, borderRadius: '10px' }}
                        >
                          Open
                        </Button>
                        {c.status !== 'published' && (
                          <Button
                            size="small"
                            variant="contained"
                            disabled={busyId === c.id}
                            onClick={() => {
                              setBusyId(c.id);
                              void adminPublishCluster(c.id)
                                .then(refresh)
                                .catch((err: any) =>
                                  setError(err?.response?.data?.error || err?.message || 'Publish failed')
                                )
                                .finally(() => setBusyId(null));
                            }}
                            sx={{
                              textTransform: 'none',
                              fontWeight: 700,
                              borderRadius: '10px',
                              bgcolor: FIRSTSTEP.tealDark,
                              '&:hover': { bgcolor: FIRSTSTEP.navy },
                            }}
                          >
                            Publish
                          </Button>
                        )}
                        <Button
                          size="small"
                          startIcon={<ContentCopyIcon />}
                          disabled={busyId === c.id}
                          onClick={() => {
                            setBusyId(c.id);
                            void adminDuplicateCluster(c.id)
                              .then((copy) => navigate(`/clusters/${copy.id}`))
                              .catch((err: any) =>
                                setError(err?.response?.data?.error || err?.message || 'Duplicate failed')
                              )
                              .finally(() => setBusyId(null));
                          }}
                          sx={{ textTransform: 'none' }}
                        >
                          Duplicate
                        </Button>
                        {c.status !== 'archived' && (
                          <Button
                            size="small"
                            startIcon={<ArchiveOutlinedIcon />}
                            disabled={busyId === c.id}
                            onClick={() => {
                              setBusyId(c.id);
                              void adminArchiveCluster(c.id)
                                .then(refresh)
                                .catch((err: any) =>
                                  setError(err?.response?.data?.error || err?.message || 'Archive failed')
                                )
                                .finally(() => setBusyId(null));
                            }}
                            sx={{ textTransform: 'none' }}
                          >
                            Archive
                          </Button>
                        )}
                      </Stack>
                    </Stack>
                  </Paper>
                ))
              )}
            </Stack>
          )}
        </>
      )}

      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        fullWidth
        maxWidth="sm"
        PaperProps={{ sx: { borderRadius: '16px' } }}
      >
        <DialogTitle sx={{ fontWeight: 750, color: FIRSTSTEP.navyDeep }}>New curated cluster</DialogTitle>
        <Divider />
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1.5 }}>
            <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} fullWidth />
            <TextField label="Slug (optional)" value={slug} onChange={(e) => setSlug(e.target.value)} fullWidth />
            <TextField
              label="Description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              fullWidth
              multiline
              minRows={2}
            />
            <TextField
              select
              label="Add industry"
              value=""
              onChange={(e) => toggle(industries, e.target.value, setIndustries)}
              fullWidth
            >
              {FROZEN_INDUSTRIES.map((i) => (
                <MenuItem key={i} value={i}>
                  {i}
                </MenuItem>
              ))}
            </TextField>
            <Stack direction="row" flexWrap="wrap" gap={0.5}>
              {industries.map((i) => (
                <Chip key={i} label={i} onDelete={() => toggle(industries, i, setIndustries)} />
              ))}
            </Stack>
            <TextField
              select
              label="Add specialty"
              value=""
              onChange={(e) => toggle(categories, e.target.value, setCategories)}
              fullWidth
            >
              {FROZEN_JOB_CATEGORIES.map((i) => (
                <MenuItem key={i} value={i}>
                  {i}
                </MenuItem>
              ))}
            </TextField>
            <Stack direction="row" flexWrap="wrap" gap={0.5}>
              {categories.map((i) => (
                <Chip key={i} label={i} onDelete={() => toggle(categories, i, setCategories)} />
              ))}
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setCreateOpen(false)} sx={{ textTransform: 'none' }}>
            Cancel
          </Button>
          <Button
            variant="contained"
            disabled={!name.trim()}
            onClick={() => void createCurated()}
            sx={{
              textTransform: 'none',
              fontWeight: 700,
              borderRadius: '10px',
              bgcolor: FIRSTSTEP.tealDark,
            }}
          >
            Create draft
          </Button>
        </DialogActions>
      </Dialog>

      <RequestTriageDialog
        open={Boolean(triageRequest)}
        request={triageRequest}
        onClose={() => setTriageRequest(null)}
        onChanged={refresh}
        onOpenCluster={(clusterId) => {
          setTriageRequest(null);
          navigate(`/clusters/${clusterId}`);
        }}
      />
    </Box>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Typography
        sx={{
          fontSize: '0.68rem',
          fontWeight: 700,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: FIRSTSTEP.textMuted,
          mb: 0.25,
        }}
      >
        {label}
      </Typography>
      <Typography variant="body2" sx={{ color: FIRSTSTEP.navy, wordBreak: 'break-word' }}>
        {value}
      </Typography>
    </Box>
  );
}
