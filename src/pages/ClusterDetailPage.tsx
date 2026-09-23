import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  MenuItem,
  Paper,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import SaveIcon from '@mui/icons-material/Save';
import RefreshIcon from '@mui/icons-material/Refresh';
import PublishIcon from '@mui/icons-material/Publish';
import UnpublishedOutlinedIcon from '@mui/icons-material/UnpublishedOutlined';
import ArchiveOutlinedIcon from '@mui/icons-material/ArchiveOutlined';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import {
  adminArchiveCluster,
  adminBindClusterSources,
  adminCreateCluster,
  adminDeleteCluster,
  adminDuplicateCluster,
  adminGetActivity,
  adminGetCluster,
  adminPatchCluster,
  adminPreviewCount,
  adminPublishCluster,
  adminRestoreCluster,
  adminSampleJobs,
  adminUnpublishCluster,
  type AdminCluster,
  type AdminClusterActivity,
  type AdminClusterFilter,
  type AdminClusterRequest,
  type AdminSampleJob,
} from '../api/adminClusters';
import { AppShell } from '../components/dashboard/AppShell';
import {
  FIRSTSTEP,
  cardSx,
  fadeUpSx,
  tint,
} from '../components/dashboard/ops/dashboardTokens';
import { FROZEN_INDUSTRIES } from '../shared/frozenIndustries';
import { FROZEN_JOB_CATEGORIES } from '../shared/frozenJobCategories';
import { FROZEN_EXPERIENCE_LEVELS, FROZEN_EXPERIENCE_YEARS } from '../shared/frozenExperience';
import { FROZEN_US_STATES } from '../shared/frozenLocations';

const emptyFilter = (): AdminClusterFilter => ({
  frozenIndustries: [],
  frozenCategories: [],
  frozenExperienceLevels: [],
  frozenExperienceYears: [],
  frozenStates: [],
  locationIsRemote: null,
  excludeStudentEscape: true,
  companyNames: [],
  h1bSponsorFriendly: false,
});

const STATE_LABEL_BY_CODE = Object.fromEntries(
  FROZEN_US_STATES.map((s) => [s.code, s.name])
) as Record<string, string>;

function stateLabel(code: string): string {
  return STATE_LABEL_BY_CODE[code] || code;
}

function StatusChip({ label }: { label: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    published: { bg: tint(FIRSTSTEP.success, 0.16), color: FIRSTSTEP.successDeep },
    draft: { bg: tint(FIRSTSTEP.navy, 0.08), color: FIRSTSTEP.navy },
    archived: { bg: tint(FIRSTSTEP.textMuted, 0.14), color: FIRSTSTEP.textMuted },
  };
  const tone = map[label] || map.draft;
  return (
    <Chip
      size="small"
      label={label}
      sx={{ height: 24, fontWeight: 700, textTransform: 'capitalize', bgcolor: tone.bg, color: tone.color }}
    />
  );
}

function MultiChipPicker({
  label,
  options,
  value,
  onChange,
  getOptionLabel,
}: {
  label: string;
  options: readonly string[];
  value: string[];
  onChange: (next: string[]) => void;
  /** Display label (e.g. full state name). Value stored remains the option string. */
  getOptionLabel?: (option: string) => string;
}) {
  const [inputValue, setInputValue] = useState('');
  const labelOf = getOptionLabel || ((o: string) => o);
  const available = useMemo(
    () => options.filter((o) => !value.includes(o)),
    [options, value]
  );

  return (
    <Box>
      <Autocomplete
        options={available}
        value={null}
        inputValue={inputValue}
        onInputChange={(_e, next, reason) => {
          if (reason === 'reset') {
            setInputValue('');
            return;
          }
          setInputValue(next);
        }}
        onChange={(_e, selected) => {
          if (!selected) return;
          if (!value.includes(selected)) onChange([...value, selected]);
          setInputValue('');
        }}
        filterOptions={(opts, state) => {
          const needle = state.inputValue.trim().toLowerCase();
          if (!needle) return opts;
          return opts.filter((o) => {
            const hay = `${labelOf(o)} ${o}`.toLowerCase();
            return hay.includes(needle);
          });
        }}
        getOptionLabel={(o) => labelOf(o)}
        clearOnBlur
        blurOnSelect
        selectOnFocus
        handleHomeEndKeys
        noOptionsText={
          inputValue.trim() ? `No matching ${label}` : `All ${label}s selected`
        }
        renderInput={(params) => (
          <TextField
            {...params}
            label={`Add ${label}`}
            placeholder={`Search ${label}…`}
            size="small"
          />
        )}
        sx={{ mb: 1 }}
      />
      <Stack direction="row" flexWrap="wrap" gap={0.5} useFlexGap>
        {value.map((v) => (
          <Chip
            key={v}
            size="small"
            label={labelOf(v)}
            onDelete={() => onChange(value.filter((x) => x !== v))}
          />
        ))}
      </Stack>
    </Box>
  );
}

export function ClusterEditorShell() {
  const navigate = useNavigate();
  return (
    <AppShell
      value="clusters"
      handleChangeContent={(next) => {
        navigate(next === 'dashboard' ? '/dashboard' : `/${next}`);
      }}
    >
      <ClusterDetailPage />
    </AppShell>
  );
}

export function ClusterDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isNew = id === 'new';

  const [tab, setTab] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clusterId, setClusterId] = useState<string | null>(isNew ? null : id || null);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState<'curated' | 'custom'>('curated');
  const [status, setStatus] = useState('draft');
  const [coverImage, setCoverImage] = useState('');
  const [logosText, setLogosText] = useState('');
  const [filter, setFilter] = useState<AdminClusterFilter>(emptyFilter());
  const [sourcesText, setSourcesText] = useState('');
  const [sourceCompaniesText, setSourceCompaniesText] = useState('');
  const [robotMetaIds, setRobotMetaIds] = useState<string[]>([]);
  const [jobCountPreview, setJobCountPreview] = useState(0);
  const [request, setRequest] = useState<AdminClusterRequest | null>(null);
  const [robots, setRobots] = useState<Array<{ metaId: string; name: string; url: string }>>([]);
  const [activeSubscriptions, setActiveSubscriptions] = useState(0);
  const [samples, setSamples] = useState<AdminSampleJob[]>([]);
  const [activity, setActivity] = useState<AdminClusterActivity[]>([]);
  const [adminNotes, setAdminNotes] = useState('');
  const [dirty, setDirty] = useState(false);
  const [confirm, setConfirm] = useState<'archive' | 'delete' | 'unpublish' | null>(null);
  const [baseline, setBaseline] = useState('');

  const markDirty = () => setDirty(true);

  const applyCluster = useCallback((c: AdminCluster) => {
    setClusterId(c.id);
    setName(c.name);
    setSlug(c.slug);
    setDescription(c.description || '');
    setKind(c.kind);
    setStatus(c.status);
    setCoverImage(c.coverImage || '');
    setLogosText((c.companyLogos || []).join('\n'));
    setFilter({ ...emptyFilter(), ...(c.filter || {}) });
    setSourcesText((c.sourceBinding?.sources || []).join('\n'));
    setSourceCompaniesText((c.sourceBinding?.companyNames || []).join('\n'));
    setRobotMetaIds(c.sourceBinding?.robotMetaIds || []);
    setJobCountPreview(c.jobCountPreview || 0);
    setDirty(false);
    setBaseline(JSON.stringify({ id: c.id, updatedAt: c.updatedAt }));
  }, []);

  const load = useCallback(async () => {
    if (isNew || !id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const detail = await adminGetCluster(id);
      applyCluster(detail.cluster);
      setRequest(detail.request);
      setRobots(detail.robots || []);
      setActiveSubscriptions(detail.activeSubscriptions || 0);
      setAdminNotes(detail.request?.adminNotes || '');
      const [samp, act] = await Promise.all([
        adminSampleJobs(id, 8).catch(() => ({ jobs: [] as AdminSampleJob[] })),
        adminGetActivity(id).catch(() => ({ activity: [] as AdminClusterActivity[] })),
      ]);
      setSamples(samp.jobs || []);
      setActivity(act.activity || []);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to load cluster');
    } finally {
      setLoading(false);
    }
  }, [applyCluster, id, isNew]);

  useEffect(() => {
    void load();
  }, [load]);

  const buildPayload = () => {
    const companyLogos = logosText
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const sources = sourcesText
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const companyNames = sourceCompaniesText
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    return {
      name: name.trim(),
      slug: slug.trim() || undefined,
      description,
      kind,
      coverImage: coverImage.trim() || null,
      companyLogos,
      filter: {
        ...filter,
        companyNames: filter.companyNames?.length ? filter.companyNames : companyNames,
      },
      sourceBinding: {
        mode: kind === 'custom' ? 'source' : 'filter',
        sources,
        companyNames,
        robotMetaIds,
      },
      refreshCount: true,
    };
  };

  const save = async () => {
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = buildPayload();
      if (isNew || !clusterId) {
        const created = await adminCreateCluster({ ...payload, status: 'draft' });
        navigate(`/clusters/${created.id}`, { replace: true });
        return;
      }
      const updated = await adminPatchCluster(clusterId, payload);
      applyCluster(updated);
      const act = await adminGetActivity(clusterId);
      setActivity(act.activity || []);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const runLifecycle = async (action: 'publish' | 'unpublish' | 'archive' | 'restore' | 'duplicate' | 'delete') => {
    if (!clusterId) return;
    setSaving(true);
    setError(null);
    try {
      if (action === 'publish') {
        if (dirty) await save();
        const c = await adminPublishCluster(clusterId);
        applyCluster(c);
      } else if (action === 'unpublish') {
        applyCluster(await adminUnpublishCluster(clusterId));
      } else if (action === 'archive') {
        applyCluster(await adminArchiveCluster(clusterId));
      } else if (action === 'restore') {
        applyCluster(await adminRestoreCluster(clusterId));
      } else if (action === 'duplicate') {
        const copy = await adminDuplicateCluster(clusterId);
        navigate(`/clusters/${copy.id}`);
        return;
      } else if (action === 'delete') {
        await adminDeleteCluster(clusterId);
        navigate('/clusters');
        return;
      }
      const act = await adminGetActivity(clusterId);
      setActivity(act.activity || []);
      setConfirm(null);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Action failed');
    } finally {
      setSaving(false);
    }
  };

  const refreshPreview = async () => {
    if (!clusterId) return;
    setSaving(true);
    try {
      if (dirty) {
        const updated = await adminPatchCluster(clusterId, buildPayload());
        applyCluster(updated);
      }
      const preview = await adminPreviewCount(clusterId, { includeSamples: true, limit: 8 });
      setJobCountPreview(preview.jobCountPreview);
      setSamples(preview.jobs || []);
      applyCluster(preview.cluster);
      const act = await adminGetActivity(clusterId);
      setActivity(act.activity || []);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Preview failed');
    } finally {
      setSaving(false);
    }
  };

  const bindSources = async (createRobots: boolean) => {
    if (!clusterId) {
      setError('Save the cluster first, then bind sources');
      return;
    }
    setSaving(true);
    try {
      if (dirty) await adminPatchCluster(clusterId, buildPayload());
      const urls = sourcesText
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const companyNames = sourceCompaniesText
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const result = await adminBindClusterSources(clusterId, {
        urls,
        sources: urls,
        companyNames,
        createRobots,
        robotMetaIds,
      });
      applyCluster(result.cluster);
      setKind('custom');
      const detail = await adminGetCluster(clusterId);
      setRobots(detail.robots || []);
      const act = await adminGetActivity(clusterId);
      setActivity(act.activity || []);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Bind sources failed');
    } finally {
      setSaving(false);
    }
  };

  const liveBanner = status === 'published';

  const headerActions = useMemo(
    () => (
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <Button
          variant="contained"
          startIcon={<SaveIcon />}
          disabled={saving || (!dirty && !isNew)}
          onClick={() => void save()}
          sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '10px', bgcolor: FIRSTSTEP.tealDark }}
        >
          {isNew ? 'Create draft' : 'Save'}
        </Button>
        {clusterId ? (
          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            disabled={saving}
            onClick={() => void refreshPreview()}
            sx={{ textTransform: 'none', fontWeight: 600, borderRadius: '10px' }}
          >
            Refresh preview
          </Button>
        ) : null}
        {clusterId && status !== 'published' ? (
          <Button
            variant="contained"
            startIcon={<PublishIcon />}
            disabled={saving}
            onClick={() => void runLifecycle('publish')}
            sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '10px' }}
          >
            Publish
          </Button>
        ) : null}
        {clusterId && status === 'published' ? (
          <Button
            variant="outlined"
            startIcon={<UnpublishedOutlinedIcon />}
            disabled={saving}
            onClick={() => setConfirm('unpublish')}
            sx={{ textTransform: 'none', fontWeight: 600, borderRadius: '10px' }}
          >
            Unpublish
          </Button>
        ) : null}
        {clusterId && status !== 'archived' ? (
          <Button
            startIcon={<ArchiveOutlinedIcon />}
            disabled={saving}
            onClick={() => setConfirm('archive')}
            sx={{ textTransform: 'none', fontWeight: 600 }}
          >
            Archive
          </Button>
        ) : null}
        {clusterId && status === 'archived' ? (
          <Button disabled={saving} onClick={() => void runLifecycle('restore')} sx={{ textTransform: 'none' }}>
            Restore
          </Button>
        ) : null}
        {clusterId ? (
          <Button
            startIcon={<ContentCopyIcon />}
            disabled={saving}
            onClick={() => void runLifecycle('duplicate')}
            sx={{ textTransform: 'none' }}
          >
            Duplicate
          </Button>
        ) : null}
        {clusterId && (status === 'draft' || status === 'archived') ? (
          <Button
            color="error"
            startIcon={<DeleteOutlineIcon />}
            disabled={saving}
            onClick={() => setConfirm('delete')}
            sx={{ textTransform: 'none' }}
          >
            Delete
          </Button>
        ) : null}
      </Stack>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [saving, dirty, isNew, clusterId, status, baseline]
  );

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 10 }}>
        <CircularProgress sx={{ color: FIRSTSTEP.tealDark }} />
      </Box>
    );
  }

  return (
    <Box
      sx={{
        p: { xs: 2, md: 3 },
        minHeight: '100%',
        bgcolor: (theme) => (theme.palette.mode === 'dark' ? '#000' : FIRSTSTEP.surface),
      }}
    >
      <Stack spacing={2} sx={{ mb: 2 }}>
        <Button
          component={RouterLink}
          to="/clusters"
          startIcon={<ArrowBackIcon />}
          sx={{ alignSelf: 'flex-start', textTransform: 'none', fontWeight: 600, color: FIRSTSTEP.navy }}
        >
          All clusters
        </Button>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          justifyContent="space-between"
          alignItems={{ md: 'flex-start' }}
          spacing={2}
        >
          <Box>
            <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.1em', color: FIRSTSTEP.tealDark }}>
              PORTAL OPS
            </Typography>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
              <Typography variant="h4" sx={{ fontWeight: 800, color: FIRSTSTEP.navyDeep, letterSpacing: '-0.02em' }}>
                {isNew ? 'New cluster' : name || 'Cluster'}
              </Typography>
              {!isNew ? <StatusChip label={status} /> : null}
              {!isNew ? (
                <Chip size="small" label={kind} variant="outlined" sx={{ textTransform: 'capitalize', fontWeight: 600 }} />
              ) : null}
            </Stack>
            {!isNew && slug ? (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                /{slug} · ~{jobCountPreview.toLocaleString()} jobs · {activeSubscriptions} active activations
              </Typography>
            ) : null}
          </Box>
          {headerActions}
        </Stack>
      </Stack>

      {liveBanner ? (
        <Alert severity="warning" sx={{ mb: 2, borderRadius: '12px' }}>
          Live cluster — saved filter/source changes apply immediately to subscriber feeds.
        </Alert>
      ) : null}
      {error ? (
        <Alert severity="error" sx={{ mb: 2, borderRadius: '12px' }} onClose={() => setError(null)}>
          {error}
        </Alert>
      ) : null}

      <Paper elevation={0} sx={[cardSx(), fadeUpSx(40), { mb: 2 }]}>
        <Tabs
          value={tab}
          onChange={(_, v) => setTab(v)}
          variant="scrollable"
          sx={{
            px: 1,
            minHeight: 44,
            '& .MuiTab-root': { textTransform: 'none', fontWeight: 650, minHeight: 44 },
            '& .Mui-selected': { color: `${FIRSTSTEP.tealDark} !important` },
            '& .MuiTabs-indicator': { bgcolor: FIRSTSTEP.tealDark, height: 3, borderRadius: 2 },
          }}
        >
          <Tab label="Overview" />
          <Tab label="Filters" />
          <Tab label="Sources" />
          <Tab label="Preview" />
          <Tab label="Request" disabled={!request} />
          <Tab label="History" disabled={isNew} />
        </Tabs>
        <Divider />
        <Box sx={{ p: { xs: 2, md: 2.5 } }}>
          {tab === 0 ? (
            <Stack spacing={2}>
              <TextField
                label="Name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  markDirty();
                }}
                fullWidth
              />
              <TextField
                label="Slug"
                value={slug}
                onChange={(e) => {
                  setSlug(e.target.value);
                  markDirty();
                }}
                fullWidth
                helperText="URL path under /user/clusters/:slug"
              />
              <TextField
                label="Description"
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
                  markDirty();
                }}
                fullWidth
                multiline
                minRows={3}
              />
              <TextField
                select
                label="Kind"
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value as 'curated' | 'custom');
                  markDirty();
                }}
                fullWidth
              >
                <MenuItem value="curated">Curated (frozen filters)</MenuItem>
                <MenuItem value="custom">Custom (source-bound)</MenuItem>
              </TextField>
              <TextField
                label="Cover image URL"
                value={coverImage}
                onChange={(e) => {
                  setCoverImage(e.target.value);
                  markDirty();
                }}
                fullWidth
              />
              <TextField
                label="Company logos (one URL per line)"
                value={logosText}
                onChange={(e) => {
                  setLogosText(e.target.value);
                  markDirty();
                }}
                fullWidth
                multiline
                minRows={2}
              />
            </Stack>
          ) : null}

          {tab === 1 ? (
            <Stack spacing={2.5}>
              <MultiChipPicker
                label="industry"
                options={FROZEN_INDUSTRIES}
                value={filter.frozenIndustries}
                onChange={(frozenIndustries) => {
                  setFilter((f) => ({ ...f, frozenIndustries }));
                  markDirty();
                }}
              />
              <MultiChipPicker
                label="specialty"
                options={FROZEN_JOB_CATEGORIES}
                value={filter.frozenCategories}
                onChange={(frozenCategories) => {
                  setFilter((f) => ({ ...f, frozenCategories }));
                  markDirty();
                }}
              />
              <MultiChipPicker
                label="state"
                options={FROZEN_US_STATES.map((s) => s.code)}
                getOptionLabel={stateLabel}
                value={filter.frozenStates}
                onChange={(frozenStates) => {
                  setFilter((f) => ({ ...f, frozenStates }));
                  markDirty();
                }}
              />
              <MultiChipPicker
                label="experience level"
                options={FROZEN_EXPERIENCE_LEVELS}
                value={filter.frozenExperienceLevels}
                onChange={(frozenExperienceLevels) => {
                  setFilter((f) => ({ ...f, frozenExperienceLevels }));
                  markDirty();
                }}
              />
              <MultiChipPicker
                label="experience years"
                options={FROZEN_EXPERIENCE_YEARS}
                value={filter.frozenExperienceYears}
                onChange={(frozenExperienceYears) => {
                  setFilter((f) => ({ ...f, frozenExperienceYears }));
                  markDirty();
                }}
              />
              <TextField
                label="Company names (comma or newline)"
                value={(filter.companyNames || []).join('\n')}
                onChange={(e) => {
                  setFilter((f) => ({
                    ...f,
                    companyNames: e.target.value
                      .split(/[\n,]+/)
                      .map((s) => s.trim())
                      .filter(Boolean),
                  }));
                  markDirty();
                }}
                fullWidth
                multiline
                minRows={2}
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={filter.locationIsRemote === true}
                    onChange={(e) => {
                      setFilter((f) => ({
                        ...f,
                        locationIsRemote: e.target.checked ? true : null,
                      }));
                      markDirty();
                    }}
                  />
                }
                label="Remote only"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={Boolean(filter.h1bSponsorFriendly)}
                    onChange={(e) => {
                      setFilter((f) => ({ ...f, h1bSponsorFriendly: e.target.checked }));
                      markDirty();
                    }}
                  />
                }
                label="H-1B sponsor friendly"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={filter.excludeStudentEscape !== false}
                    onChange={(e) => {
                      setFilter((f) => ({ ...f, excludeStudentEscape: e.target.checked }));
                      markDirty();
                    }}
                  />
                }
                label="Exclude student / escape roles"
              />
            </Stack>
          ) : null}

          {tab === 2 ? (
            <Stack spacing={2}>
              <Alert severity="info" sx={{ borderRadius: '12px' }}>
                Custom clusters match jobs via bound career URLs / scraper robots. Binding with Create robots will
                create ops scrapers for each URL.
              </Alert>
              <TextField
                label="Career / source URLs (one per line, max 10)"
                value={sourcesText}
                onChange={(e) => {
                  setSourcesText(e.target.value);
                  markDirty();
                }}
                fullWidth
                multiline
                minRows={4}
              />
              <TextField
                label="Source company names"
                value={sourceCompaniesText}
                onChange={(e) => {
                  setSourceCompaniesText(e.target.value);
                  markDirty();
                }}
                fullWidth
                multiline
                minRows={2}
              />
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <Button
                  variant="outlined"
                  disabled={saving || !clusterId}
                  onClick={() => void bindSources(false)}
                  sx={{ textTransform: 'none', fontWeight: 600 }}
                >
                  Save source URLs
                </Button>
                <Button
                  variant="contained"
                  disabled={saving || !clusterId}
                  onClick={() => void bindSources(true)}
                  sx={{ textTransform: 'none', fontWeight: 700, bgcolor: FIRSTSTEP.tealDark }}
                >
                  Bind + create robots
                </Button>
              </Stack>
              {robots.length > 0 ? (
                <Box>
                  <Typography sx={{ fontWeight: 700, mb: 1, color: FIRSTSTEP.navyDeep }}>Linked scrapers</Typography>
                  <Stack spacing={1}>
                    {robots.map((r) => (
                      <Paper key={r.metaId} elevation={0} sx={{ p: 1.5, border: `1px solid ${FIRSTSTEP.border}` }}>
                        <Typography sx={{ fontWeight: 650 }}>{r.name || r.metaId}</Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ wordBreak: 'break-all' }}>
                          {r.url}
                        </Typography>
                        <Button
                          size="small"
                          component={RouterLink}
                          to="/scrapers"
                          sx={{ mt: 0.5, textTransform: 'none' }}
                        >
                          Open scrapers
                        </Button>
                      </Paper>
                    ))}
                  </Stack>
                </Box>
              ) : null}
            </Stack>
          ) : null}

          {tab === 3 ? (
            <Stack spacing={2}>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography sx={{ fontWeight: 750, fontSize: '1.25rem', color: FIRSTSTEP.navyDeep }}>
                  {jobCountPreview.toLocaleString()} jobs match
                </Typography>
                <Button
                  startIcon={<RefreshIcon />}
                  onClick={() => void refreshPreview()}
                  disabled={saving || !clusterId}
                  sx={{ textTransform: 'none' }}
                >
                  Refresh
                </Button>
              </Stack>
              {samples.length === 0 ? (
                <Typography color="text.secondary">No sample jobs yet. Save filters and refresh preview.</Typography>
              ) : (
                samples.map((j) => (
                  <Paper key={j.id} elevation={0} sx={{ p: 1.75, border: `1px solid ${FIRSTSTEP.border}` }}>
                    <Typography sx={{ fontWeight: 700 }}>{j.title}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {[j.company, j.location, j.level].filter(Boolean).join(' · ')}
                    </Typography>
                  </Paper>
                ))
              )}
            </Stack>
          ) : null}

          {tab === 4 && request ? (
            <Stack spacing={1.5}>
              <Typography sx={{ fontWeight: 700 }}>{request.title}</Typography>
              <Typography variant="body2" color="text.secondary">
                {request.auth0Sub} · {request.status} · {request.type}
              </Typography>
              <Typography variant="body2">Industries: {(request.industries || []).join(', ') || '—'}</Typography>
              <Typography variant="body2">Roles: {(request.roles || []).join(', ') || '—'}</Typography>
              <Typography variant="body2">Locations: {(request.locations || []).join(', ') || '—'}</Typography>
              {request.urls?.length ? (
                <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>
                  URLs: {request.urls.join(' · ')}
                </Typography>
              ) : null}
              <TextField
                label="Admin notes"
                value={adminNotes}
                onChange={(e) => setAdminNotes(e.target.value)}
                fullWidth
                multiline
                minRows={2}
              />
              <Typography variant="caption" color="text.secondary">
                Publishing this cluster marks the request published and activates an entitlement slot for the requester.
              </Typography>
            </Stack>
          ) : null}

          {tab === 5 ? (
            <Stack spacing={1.25}>
              {activity.length === 0 ? (
                <Typography color="text.secondary">No activity yet.</Typography>
              ) : (
                activity.map((a) => (
                  <Paper key={a.id} elevation={0} sx={{ p: 1.5, border: `1px solid ${FIRSTSTEP.border}` }}>
                    <Stack direction="row" justifyContent="space-between" spacing={1}>
                      <Typography sx={{ fontWeight: 700, textTransform: 'capitalize' }}>
                        {a.action.replace(/_/g, ' ')}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {new Date(a.at).toLocaleString()}
                      </Typography>
                    </Stack>
                    <Typography variant="body2" color="text.secondary">
                      {a.actor}
                      {a.detail ? ` · ${a.detail}` : ''}
                    </Typography>
                  </Paper>
                ))
              )}
            </Stack>
          ) : null}
        </Box>
      </Paper>

      <Dialog open={confirm != null} onClose={() => setConfirm(null)}>
        <DialogTitle>
          {confirm === 'delete' ? 'Delete cluster?' : confirm === 'archive' ? 'Archive cluster?' : 'Unpublish cluster?'}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            {confirm === 'delete'
              ? 'Hard-deletes this draft/archived cluster. Active subscriptions must be zero.'
              : confirm === 'archive'
                ? 'Archived clusters leave the portal browse catalog.'
                : 'Cluster returns to draft. Existing activations stay until you manage them separately.'}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirm(null)} sx={{ textTransform: 'none' }}>
            Cancel
          </Button>
          <Button
            color={confirm === 'delete' ? 'error' : 'primary'}
            variant="contained"
            onClick={() => void runLifecycle(confirm!)}
            sx={{ textTransform: 'none' }}
          >
            Confirm
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default ClusterDetailPage;
