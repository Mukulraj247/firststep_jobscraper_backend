import React, { useCallback, useEffect, useRef, useState } from 'react';
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
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import SearchIcon from '@mui/icons-material/Search';
import LinkIcon from '@mui/icons-material/Link';
import CloseIcon from '@mui/icons-material/Close';
import {
  adminBindClusterSources,
  adminCreateDraftFromRequest,
  adminGetRequestCoverage,
  adminLinkRequestRobot,
  adminMakeClusterFromRequest,
  adminSearchRobots,
  type AdminClusterRequest,
  type AdminRobotSearchHit,
  type RequestCoverageResponse,
  type RequestCoverageUrlRow,
} from '../api/adminClusters';
import { FIRSTSTEP, tint } from '../components/dashboard/ops/dashboardTokens';

const STATUS_LABEL: Record<RequestCoverageUrlRow['status'], string> = {
  missing_automation: 'Missing automation',
  never_run: 'Never run',
  no_matching_jobs: 'No matching jobs',
  ready: 'Ready',
};

const STATUS_COLOR: Record<RequestCoverageUrlRow['status'], string> = {
  missing_automation: FIRSTSTEP.danger,
  never_run: '#b45309',
  no_matching_jobs: FIRSTSTEP.warning,
  ready: FIRSTSTEP.successDeep,
};

const MATCH_CHIP: Record<
  NonNullable<RequestCoverageUrlRow['matchKind']>,
  { label: string; color: string }
> = {
  exact: { label: 'Exact match', color: FIRSTSTEP.successDeep },
  root: { label: 'Board root', color: FIRSTSTEP.tealDark },
  host: { label: 'Same host', color: FIRSTSTEP.tealDark },
  manual: { label: 'Manual link', color: FIRSTSTEP.navy },
};

type Props = {
  request: AdminClusterRequest | null;
  open: boolean;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
  onOpenCluster: (clusterId: string) => void;
};

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Typography
        sx={{
          fontSize: '0.65rem',
          fontWeight: 700,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: FIRSTSTEP.textMuted,
          mb: 0.35,
        }}
      >
        {label}
      </Typography>
      <Typography variant="body2" sx={{ color: FIRSTSTEP.navyDeep, fontWeight: 500, lineHeight: 1.45 }}>
        {value || '—'}
      </Typography>
    </Box>
  );
}

function ManualLinkSearch({
  requestUrl,
  disabled,
  onLinked,
}: {
  requestUrl: string;
  disabled?: boolean;
  onLinked: (hit: AdminRobotSearchHit) => Promise<void>;
}) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<AdminRobotSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const runSearch = useCallback(async (term: string) => {
    abortRef.current?.abort();
    const trimmed = term.trim();
    if (trimmed.length < 2) {
      setHits([]);
      setSearching(false);
      setSearchError(null);
      return;
    }
    const ac = new AbortController();
    abortRef.current = ac;
    setSearching(true);
    setSearchError(null);
    try {
      const res = await adminSearchRobots(trimmed, 15, ac.signal);
      if (!ac.signal.aborted) setHits(res.robots || []);
    } catch (err: any) {
      if (err?.name === 'CanceledError' || err?.code === 'ERR_CANCELED') return;
      setHits([]);
      setSearchError(err?.response?.data?.error || err?.message || 'Search failed');
    } finally {
      if (!ac.signal.aborted) setSearching(false);
    }
  }, []);

  const onQueryChange = (value: string) => {
    setQ(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void runSearch(value), 280);
  };

  const seedFromUrl = () => {
    try {
      const host = new URL(requestUrl).hostname.replace(/^www\./i, '');
      const brand = host.split('.')[0] || host;
      onQueryChange(brand);
    } catch {
      onQueryChange(requestUrl.slice(0, 40));
    }
  };

  return (
    <Box
      sx={{
        mt: 1.5,
        p: 1.5,
        borderRadius: '12px',
        bgcolor: tint(FIRSTSTEP.navy, 0.035),
        border: `1px solid ${tint(FIRSTSTEP.navy, 0.08)}`,
      }}
    >
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
        <Typography sx={{ fontWeight: 700, fontSize: '0.8125rem', color: FIRSTSTEP.navyDeep }}>
          Manual match
        </Typography>
        <Button
          size="small"
          onClick={seedFromUrl}
          disabled={disabled}
          sx={{ textTransform: 'none', fontWeight: 600, fontSize: '0.75rem' }}
        >
          Suggest from URL
        </Button>
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
        Auto-match uses the same host. Search by company name or paste the real careers URL (e.g.
        careers.truist.com) when Workday / ATS hosts differ.
      </Typography>
      <TextField
        fullWidth
        size="small"
        placeholder="Search automations by name or URL…"
        value={q}
        disabled={disabled}
        onChange={(e) => onQueryChange(e.target.value)}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              {searching ? <CircularProgress size={16} /> : <SearchIcon sx={{ fontSize: 18 }} />}
            </InputAdornment>
          ),
          endAdornment: q ? (
            <InputAdornment position="end">
              <IconButton
                size="small"
                aria-label="Clear search"
                onClick={() => {
                  setQ('');
                  setHits([]);
                  setSearchError(null);
                }}
              >
                <CloseIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </InputAdornment>
          ) : undefined,
        }}
        sx={{
          '& .MuiOutlinedInput-root': { borderRadius: '10px', bgcolor: '#fff' },
        }}
      />
      {searchError && (
        <Typography variant="caption" color="error" sx={{ mt: 0.75, display: 'block' }}>
          {searchError}
        </Typography>
      )}
      {q.trim().length >= 2 && !searching && !hits.length && !searchError && (
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
          No automations found. Try a shorter brand token (e.g. “truist”).
        </Typography>
      )}
      {hits.length > 0 && (
        <Stack spacing={0.75} sx={{ mt: 1.25, maxHeight: 220, overflowY: 'auto' }}>
          {hits.map((hit) => (
            <Stack
              key={hit.metaId}
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1}
              alignItems={{ sm: 'center' }}
              justifyContent="space-between"
              sx={{
                p: 1,
                borderRadius: '10px',
                bgcolor: '#fff',
                border: `1px solid ${tint(FIRSTSTEP.navy, 0.08)}`,
              }}
            >
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography
                  sx={{ fontWeight: 700, fontSize: '0.8125rem', color: FIRSTSTEP.navyDeep }}
                  noWrap
                >
                  {hit.name || 'Untitled automation'}
                </Typography>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: 'block', wordBreak: 'break-all' }}
                >
                  {hit.url || hit.metaId}
                </Typography>
              </Box>
              <Button
                size="small"
                variant="contained"
                startIcon={
                  linkingId === hit.metaId ? (
                    <CircularProgress size={14} color="inherit" />
                  ) : (
                    <LinkIcon />
                  )
                }
                disabled={disabled || linkingId !== null}
                onClick={async () => {
                  setLinkingId(hit.metaId);
                  try {
                    await onLinked(hit);
                  } finally {
                    setLinkingId(null);
                  }
                }}
                sx={{
                  textTransform: 'none',
                  fontWeight: 700,
                  flexShrink: 0,
                  bgcolor: FIRSTSTEP.tealDark,
                  '&:hover': { bgcolor: FIRSTSTEP.navy },
                }}
              >
                Link
              </Button>
            </Stack>
          ))}
        </Stack>
      )}
    </Box>
  );
}

function UrlCoverageCard({
  row,
  busy,
  onCreate,
  onLink,
}: {
  row: RequestCoverageUrlRow;
  busy: boolean;
  onCreate: () => void;
  onLink: (hit: AdminRobotSearchHit) => Promise<void>;
}) {
  const match = row.matchKind ? MATCH_CHIP[row.matchKind] : null;
  const shortBound = row.robot?.url || row.robot?.name || row.robot?.metaId || '';

  return (
    <Box
      sx={{
        p: 2,
        borderRadius: '14px',
        border: `1px solid ${tint(FIRSTSTEP.navy, 0.1)}`,
        bgcolor: '#fff',
      }}
    >
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={1.5}
        justifyContent="space-between"
        alignItems={{ md: 'flex-start' }}
      >
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography
            sx={{
              fontWeight: 650,
              color: FIRSTSTEP.navyDeep,
              wordBreak: 'break-all',
              fontSize: '0.875rem',
              mb: 0.75,
            }}
          >
            {row.url}
          </Typography>
          <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
            <Chip
              size="small"
              icon={
                row.status === 'ready' ? (
                  <CheckCircleOutlineIcon sx={{ fontSize: '14px !important' }} />
                ) : (
                  <WarningAmberIcon sx={{ fontSize: '14px !important' }} />
                )
              }
              label={STATUS_LABEL[row.status]}
              sx={{
                fontWeight: 700,
                bgcolor: tint(STATUS_COLOR[row.status], 0.12),
                color: STATUS_COLOR[row.status],
              }}
            />
            {match && (
              <Chip
                size="small"
                label={match.label}
                sx={{
                  fontWeight: 650,
                  bgcolor: tint(match.color, 0.12),
                  color: match.color,
                }}
              />
            )}
            {row.requestedHadSiteFilters && (
              <Chip
                size="small"
                label="Pasted URL has site filters"
                sx={{
                  fontWeight: 600,
                  bgcolor: tint(FIRSTSTEP.warning, 0.14),
                  color: '#b45309',
                }}
              />
            )}
          </Stack>
          {row.robot && (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: 'block', mt: 0.75, wordBreak: 'break-all' }}
            >
              Bound: {shortBound}
              {row.lastRunAt ? ` · last run ${new Date(row.lastRunAt).toLocaleString()}` : ''}
            </Typography>
          )}
          {row.reuseNote && (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: 'block', mt: 0.5, maxWidth: 640 }}
            >
              {row.reuseNote}
            </Typography>
          )}
        </Box>

        <Stack
          direction="row"
          spacing={2}
          alignItems="center"
          sx={{ flexShrink: 0, minWidth: { md: 160 } }}
        >
          <Box sx={{ textAlign: 'right' }}>
            <Typography sx={{ fontSize: '0.65rem', fontWeight: 700, color: FIRSTSTEP.textMuted }}>
              JOBS
            </Typography>
            <Typography sx={{ fontWeight: 750, color: FIRSTSTEP.navyDeep }}>{row.jobsTotal}</Typography>
          </Box>
          <Box sx={{ textAlign: 'right' }}>
            <Typography sx={{ fontSize: '0.65rem', fontWeight: 700, color: FIRSTSTEP.textMuted }}>
              MATCHING
            </Typography>
            <Typography sx={{ fontWeight: 750, color: FIRSTSTEP.navyDeep }}>
              {row.jobsMatching}
            </Typography>
          </Box>
          <Stack spacing={0.5}>
            {row.status === 'missing_automation' && (
              <Button
                size="small"
                disabled={busy}
                onClick={onCreate}
                sx={{ textTransform: 'none', fontWeight: 600 }}
              >
                {busy ? 'Creating…' : 'Create automation'}
              </Button>
            )}
            {row.robot && (
              <Button
                size="small"
                startIcon={<OpenInNewIcon />}
                href={`/automations?q=${encodeURIComponent(row.robot.metaId)}`}
                target="_blank"
                rel="noreferrer"
                sx={{ textTransform: 'none', fontWeight: 600 }}
              >
                Open
              </Button>
            )}
          </Stack>
        </Stack>
      </Stack>

      {(row.status === 'missing_automation' || !row.robot) && (
        <ManualLinkSearch requestUrl={row.url} disabled={busy} onLinked={onLink} />
      )}
    </Box>
  );
}

export function RequestTriageDialog({
  request,
  open,
  onClose,
  onChanged,
  onOpenCluster,
}: Props) {
  const [coverage, setCoverage] = useState<RequestCoverageResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!request?.id) return;
    setLoading(true);
    setError(null);
    try {
      const data = await adminGetRequestCoverage(request.id);
      setCoverage(data);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to load coverage');
    } finally {
      setLoading(false);
    }
  }, [request?.id]);

  useEffect(() => {
    if (open && request?.id) {
      void load();
    } else if (!open) {
      setCoverage(null);
      setError(null);
      setInfo(null);
      setBusy(null);
    }
  }, [open, request?.id, load]);

  if (!request) return null;

  const ensureDraft = async () => {
    const draft = await adminCreateDraftFromRequest(request.id);
    return draft.cluster.id;
  };

  const createAutomationForUrl = async (url: string) => {
    setBusy(url);
    setError(null);
    setInfo(null);
    try {
      const clusterId = await ensureDraft();
      await adminBindClusterSources(clusterId, {
        urls: [url],
        createRobots: true,
        companyNames: request.companies || [],
      });
      setInfo(
        `Automation created/bound for ${url}. Record the flow in Automations if needed, then run it.`
      );
      await load();
      await onChanged();
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to create automation');
    } finally {
      setBusy(null);
    }
  };

  const linkRobot = async (url: string, hit: AdminRobotSearchHit) => {
    setBusy(`link:${url}`);
    setError(null);
    setInfo(null);
    try {
      await adminLinkRequestRobot(request.id, { url, robotMetaId: hit.metaId });
      setInfo(`Linked to “${hit.name || hit.metaId}”. Coverage refreshed.`);
      await load();
      await onChanged();
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to link automation');
      throw err;
    } finally {
      setBusy(null);
    }
  };

  const makeCluster = async (allowEmpty = false) => {
    setBusy('make');
    setError(null);
    setInfo(null);
    try {
      const result = await adminMakeClusterFromRequest(request.id, {
        allowEmpty,
        requireAllReady: !allowEmpty,
      });
      setInfo(`Published “${result.cluster.name}” with ~${result.jobCountPreview} matching jobs.`);
      await onChanged();
      onOpenCluster(result.cluster.id);
    } catch (err: any) {
      const code = err?.response?.data?.code;
      const msg = err?.response?.data?.error || err?.message || 'Make cluster failed';
      if (code === 'cluster.empty_preview' || code === 'cluster.coverage_incomplete') {
        const force = window.confirm(
          `${msg}\n\nPublish anyway (allow empty / incomplete coverage)?`
        );
        if (force) {
          try {
            const result = await adminMakeClusterFromRequest(request.id, {
              allowEmpty: true,
              requireAllReady: false,
            });
            setInfo(
              `Published “${result.cluster.name}” with ~${result.jobCountPreview} matching jobs.`
            );
            await onChanged();
            onOpenCluster(result.cluster.id);
            return;
          } catch (err2: any) {
            setError(err2?.response?.data?.error || err2?.message || 'Force publish failed');
            await load();
            return;
          }
        }
      }
      setError(msg);
      await load();
    } finally {
      setBusy(null);
    }
  };

  const allReady = coverage?.summary.allReady;
  const filters = coverage?.filter;
  const shortSub = request.auth0Sub?.includes('|')
    ? request.auth0Sub.split('|').slice(-1)[0]?.slice(0, 12)
    : request.auth0Sub?.slice(0, 18);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="lg">
      <DialogTitle
        sx={{
          fontWeight: 750,
          color: FIRSTSTEP.navyDeep,
          pr: 2,
          pb: 1,
        }}
      >
        Triage · {request.title}
      </DialogTitle>
      <DialogContent dividers sx={{ bgcolor: tint(FIRSTSTEP.navy, 0.02) }}>
        <Stack spacing={2}>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center">
            <Chip size="small" label={request.status.replace(/_/g, ' ')} sx={{ fontWeight: 700 }} />
            <Chip
              size="small"
              label={request.type === 'custom_urls' ? 'Custom URLs' : 'Predefined'}
              variant="outlined"
            />
            {shortSub && (
              <Typography variant="caption" color="text.secondary">
                requester · {shortSub}…
              </Typography>
            )}
          </Stack>

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: '1fr 1fr 1fr' },
              gap: 1.5,
              p: 2,
              borderRadius: '14px',
              bgcolor: '#fff',
              border: `1px solid ${tint(FIRSTSTEP.navy, 0.08)}`,
            }}
          >
            <DetailItem label="Titles" value={(request.roles || []).join(', ')} />
            <DetailItem
              label="Experience"
              value={[
                (request.experienceLevels || []).join(', '),
                request.experienceMin != null || request.experienceMax != null
                  ? `YOE ${request.experienceMin ?? '—'}–${request.experienceMax ?? '—'}`
                  : '',
              ]
                .filter(Boolean)
                .join(' · ')}
            />
            <DetailItem label="Industries" value={(request.industries || []).join(', ')} />
            <DetailItem label="Companies" value={(request.companies || []).join(', ')} />
            {filters && (
              <Box sx={{ gridColumn: { xs: '1', md: '1 / -1' } }}>
                <DetailItem
                  label="Mapped filters"
                  value={[
                    ...(filters.frozenCategories || []),
                    ...(filters.frozenExperienceLevels || []),
                    ...(filters.frozenExperienceYears || []),
                  ].join(', ')}
                />
              </Box>
            )}
          </Box>

          {error && <Alert severity="error">{error}</Alert>}
          {info && <Alert severity="success">{info}</Alert>}

          {loading && !coverage ? (
            <Box sx={{ py: 4, textAlign: 'center' }}>
              <CircularProgress size={28} />
            </Box>
          ) : request.type !== 'custom_urls' ? (
            <Alert severity="info">
              Predefined requests use taxonomy filters only — fulfill from list actions. Coverage is
              for custom company URLs.
            </Alert>
          ) : (
            <>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography sx={{ fontWeight: 750, color: FIRSTSTEP.navyDeep }}>
                  URL coverage
                  {coverage
                    ? ` · ${coverage.summary.readyCount}/${coverage.summary.totalUrls} ready · ${coverage.summary.jobsMatchingTotal} matching`
                    : ''}
                </Typography>
                <Button
                  size="small"
                  startIcon={loading ? <CircularProgress size={14} /> : <RefreshIcon />}
                  onClick={() => void load()}
                  disabled={loading}
                  sx={{ textTransform: 'none', fontWeight: 600 }}
                >
                  Refresh
                </Button>
              </Stack>

              {(coverage?.summary.hostReuseCount ?? 0) > 0 && (
                <Alert severity="info" sx={{ borderRadius: '12px' }}>
                  Some URLs reuse an existing company-wide automation. Pasted career-page query
                  filters are not scraped separately — titles / experience on this request narrow
                  the feed.
                </Alert>
              )}

              <Stack spacing={1.5}>
                {(coverage?.urls || []).map((row) => (
                  <UrlCoverageCard
                    key={row.url}
                    row={row}
                    busy={busy === row.url || busy === `link:${row.url}`}
                    onCreate={() => void createAutomationForUrl(row.url)}
                    onLink={(hit) => linkRobot(row.url, hit)}
                  />
                ))}
              </Stack>

              {!allReady && (
                <Alert severity="warning" sx={{ borderRadius: '12px' }}>
                  Make cluster unlocks when every URL is Ready. If auto-match missed (different ATS
                  host), use Manual match search — it queries the server and returns a small capped
                  result set.
                </Alert>
              )}
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2, gap: 1 }}>
        <Button onClick={onClose} sx={{ textTransform: 'none', fontWeight: 600 }}>
          Close
        </Button>
        {request.resultClusterId && (
          <Button
            startIcon={<OpenInNewIcon />}
            onClick={() => onOpenCluster(request.resultClusterId!)}
            sx={{ textTransform: 'none', fontWeight: 600 }}
          >
            Open cluster
          </Button>
        )}
        {request.type === 'custom_urls' && request.status !== 'published' && (
          <Button
            variant="contained"
            disabled={busy === 'make' || loading || !allReady}
            onClick={() => void makeCluster(false)}
            sx={{
              textTransform: 'none',
              fontWeight: 700,
              bgcolor: FIRSTSTEP.tealDark,
              '&:hover': { bgcolor: FIRSTSTEP.navy },
            }}
          >
            {busy === 'make' ? 'Publishing…' : 'Make cluster'}
          </Button>
        )}
        {request.type === 'predefined' && request.status !== 'published' && (
          <Button
            variant="contained"
            disabled={busy === 'make'}
            onClick={() => void makeCluster(true)}
            sx={{
              textTransform: 'none',
              fontWeight: 700,
              bgcolor: FIRSTSTEP.tealDark,
              '&:hover': { bgcolor: FIRSTSTEP.navy },
            }}
          >
            {busy === 'make' ? 'Publishing…' : 'Make cluster'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
