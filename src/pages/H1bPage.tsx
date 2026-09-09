import React, { useMemo, useState } from 'react';
import {
  Box,
  Button,
  LinearProgress,
  Paper,
  Stack,
  Tab,
  Tabs,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
  Chip,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  approveH1bMapping,
  getH1bStats,
  listH1bPendingMappings,
  rejectH1bMapping,
  searchH1bEmployers,
} from '../api/h1b';
import { cardSx, FIRSTSTEP } from '../components/dashboard/ops/dashboardTokens';

function Kpi({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <Paper elevation={0} sx={{ ...cardSx(), p: 2, minWidth: 140, flex: 1 }}>
      <Typography variant="overline" sx={{ color: FIRSTSTEP.textMuted, letterSpacing: 1 }}>
        {label}
      </Typography>
      <Typography variant="h4" sx={{ fontWeight: 700, mt: 0.5 }}>
        {value}
      </Typography>
      {hint ? (
        <Typography variant="caption" color="text.secondary">
          {hint}
        </Typography>
      ) : null}
    </Paper>
  );
}

function statusChip(status: string | undefined) {
  if (!status) return <Chip size="small" label="unmapped" variant="outlined" />;
  const color =
    status === 'auto_approved' || status === 'approved'
      ? 'success'
      : status === 'pending_review'
        ? 'warning'
        : status === 'rejected'
          ? 'error'
          : 'default';
  return <Chip size="small" label={status.replace('_', ' ')} color={color as any} variant="outlined" />;
}

export function H1bPage() {
  const [tab, setTab] = useState(0);
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const statsQuery = useQuery({
    queryKey: ['h1b-stats'],
    queryFn: ({ signal }) => getH1bStats(signal),
    refetchInterval: 60_000,
  });

  const employersQuery = useQuery({
    queryKey: ['h1b-employers', search],
    queryFn: ({ signal }) => searchH1bEmployers({ q: search, page: 1, limit: 25, signal }),
    enabled: tab === 0,
  });

  const pendingQuery = useQuery({
    queryKey: ['h1b-pending'],
    queryFn: ({ signal }) => listH1bPendingMappings({ page: 1, limit: 40, signal }),
    enabled: tab === 1,
  });

  type PendingCache = Awaited<ReturnType<typeof listH1bPendingMappings>>;
  type StatsCache = Awaited<ReturnType<typeof getH1bStats>>;

  const removePendingFromCache = (id: string, opts?: { bumpApproved?: boolean }) => {
    queryClient.setQueryData<PendingCache>(['h1b-pending'], (old) => {
      if (!old) return old;
      const mappings = (old.mappings || []).filter((m) => m.id !== id);
      const total = Math.max(0, (old.pagination?.total ?? mappings.length) - 1);
      return {
        ...old,
        mappings,
        pagination: {
          ...old.pagination,
          total,
          totalPages: total === 0 ? 1 : Math.ceil(total / (old.pagination?.limit || 40)),
        },
      };
    });
    queryClient.setQueryData<StatsCache>(['h1b-stats'], (old) => {
      if (!old || typeof old.pendingReview !== 'number') return old;
      return {
        ...old,
        pendingReview: Math.max(0, old.pendingReview - 1),
        approved:
          opts?.bumpApproved && typeof old.approved === 'number' ? old.approved + 1 : old.approved,
      };
    });
  };

  const approveMut = useMutation({
    mutationFn: (id: string) => approveH1bMapping(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['h1b-pending'] });
      const previousPending = queryClient.getQueryData<PendingCache>(['h1b-pending']);
      const previousStats = queryClient.getQueryData<StatsCache>(['h1b-stats']);
      removePendingFromCache(id, { bumpApproved: true });
      return { previousPending, previousStats };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.previousPending) queryClient.setQueryData(['h1b-pending'], ctx.previousPending);
      if (ctx?.previousStats) queryClient.setQueryData(['h1b-stats'], ctx.previousStats);
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['h1b-pending'] }),
        queryClient.invalidateQueries({ queryKey: ['h1b-stats'] }),
        queryClient.invalidateQueries({ queryKey: ['h1b-employers'] }),
      ]);
    },
  });

  const rejectMut = useMutation({
    mutationFn: (id: string) => rejectH1bMapping(id, 'manual_reject'),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['h1b-pending'] });
      const previousPending = queryClient.getQueryData<PendingCache>(['h1b-pending']);
      const previousStats = queryClient.getQueryData<StatsCache>(['h1b-stats']);
      removePendingFromCache(id);
      return { previousPending, previousStats };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.previousPending) queryClient.setQueryData(['h1b-pending'], ctx.previousPending);
      if (ctx?.previousStats) queryClient.setQueryData(['h1b-stats'], ctx.previousStats);
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['h1b-pending'] }),
        queryClient.invalidateQueries({ queryKey: ['h1b-stats'] }),
      ]);
    },
  });

  const pendingTotal = pendingQuery.data?.pagination?.total ?? statsQuery.data?.pendingReview ?? 0;

  const explorerHint = useMemo(
    () =>
      'Search DOL LCA employers (USA). High-confidence brand matches auto-apply — only exceptions need Approve/Reject.',
    []
  );

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1200, mx: 'auto' }}>
      <Stack spacing={0.5} sx={{ mb: 2.5 }}>
        <Typography variant="overline" sx={{ color: FIRSTSTEP.textMuted, letterSpacing: 1.2 }}>
          Scout-X
        </Typography>
        <Typography variant="h4" sx={{ fontWeight: 800 }}>
          H-1B
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Ops company explorer + exception mapping queue. End-user FirstStep Visa experience ships later as its own
          product shell — this page keeps company search.
        </Typography>
      </Stack>

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 2 }} useFlexGap flexWrap="wrap">
        <Kpi label="Gov employers" value={statsQuery.data?.govEmployers ?? '—'} />
        <Kpi label="Brands" value={statsQuery.data?.brands ?? '—'} />
        <Kpi
          label="Auto-approved"
          value={statsQuery.data?.autoApproved ?? '—'}
          hint="No human step"
        />
        <Kpi
          label="Pending review"
          value={statsQuery.data?.pendingReview ?? '—'}
          hint="Exception queue only"
        />
        <Kpi label="Profiles" value={statsQuery.data?.profiles ?? '—'} />
      </Stack>

      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
        <Tab label="Company explorer" />
        <Tab label={`Mapping exceptions${pendingTotal ? ` (${pendingTotal})` : ''}`} />
      </Tabs>

      {tab === 0 ? (
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            {explorerHint}
          </Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <TextField
              size="small"
              fullWidth
              placeholder="Search employer (e.g. Amazon, Google LLC)"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setSearch(q.trim());
              }}
            />
            <Button variant="contained" onClick={() => setSearch(q.trim())}>
              Search
            </Button>
          </Stack>
          {employersQuery.isFetching ? <LinearProgress sx={{ borderRadius: 1 }} /> : null}
          {employersQuery.isError ? (
            <Typography color="error">Failed to load employers. Run h1b:aggregate first if empty.</Typography>
          ) : null}
          <Paper elevation={0} sx={{ ...cardSx(), overflow: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Employer</TableCell>
                  <TableCell align="right">Certified</TableCell>
                  <TableCell>Years</TableCell>
                  <TableCell>Mapped brand</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {(employersQuery.data?.employers || []).map((row) => (
                  <TableRow key={row.id} hover>
                    <TableCell>
                      <Typography variant="body2" fontWeight={600}>
                        {row.employerNameDisplay || row.employerNameKey}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {(row.topJobTitles || [])
                          .slice(0, 3)
                          .map((t) => t.title)
                          .join(' · ')}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">{row.certifiedCount?.toLocaleString?.() ?? row.certifiedCount}</TableCell>
                    <TableCell>
                      {row.firstFilingYear && row.lastFilingYear
                        ? `${row.firstFilingYear}–${row.lastFilingYear}`
                        : '—'}
                    </TableCell>
                    <TableCell>
                      {row.mapping?.brandName || '—'}
                      {row.mapping?.confidence != null ? (
                        <Typography variant="caption" display="block" color="text.secondary">
                          {(row.mapping.confidence * 100).toFixed(0)}% · {row.mapping.matchMethod}
                        </Typography>
                      ) : null}
                    </TableCell>
                    <TableCell>{statusChip(row.mapping?.status)}</TableCell>
                    <TableCell align="right">
                      {row.mapping?.brandName ? (
                        <Button
                          size="small"
                          onClick={() =>
                            navigate(`/jobs?q=${encodeURIComponent(row.mapping!.brandName)}`)
                          }
                        >
                          See jobs
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
                {!employersQuery.isFetching && !(employersQuery.data?.employers || []).length ? (
                  <TableRow>
                    <TableCell colSpan={6}>
                      <Typography variant="body2" color="text.secondary">
                        No employers yet. Run <code>npm run h1b:aggregate</code> then{' '}
                        <code>npm run h1b:seed-map</code>.
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </Paper>
        </Stack>
      ) : (
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            Only mid-confidence / ambiguous matches. High-confidence mappings auto-apply and never appear here.
          </Typography>
          {pendingQuery.isFetching ? <LinearProgress sx={{ borderRadius: 1 }} /> : null}
          <Paper elevation={0} sx={{ ...cardSx(), overflow: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Gov employer</TableCell>
                  <TableCell>Suggested brand</TableCell>
                  <TableCell align="right">Confidence</TableCell>
                  <TableCell align="right">Certified</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(pendingQuery.data?.mappings || []).map((m) => {
                  const rowBusy =
                    (approveMut.isPending && approveMut.variables === m.id) ||
                    (rejectMut.isPending && rejectMut.variables === m.id);
                  return (
                  <TableRow key={m.id} hover>
                    <TableCell>
                      <Typography variant="body2" fontWeight={600}>
                        {m.govDisplay}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {m.matchMethod}
                      </Typography>
                    </TableCell>
                    <TableCell>{m.brandName}</TableCell>
                    <TableCell align="right">{(m.confidence * 100).toFixed(0)}%</TableCell>
                    <TableCell align="right">{m.certifiedCount}</TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={1} justifyContent="flex-end">
                        <Button
                          size="small"
                          variant="contained"
                          disabled={rowBusy}
                          onClick={() => approveMut.mutate(m.id)}
                        >
                          Approve
                        </Button>
                        <Button
                          size="small"
                          color="error"
                          disabled={rowBusy}
                          onClick={() => rejectMut.mutate(m.id)}
                        >
                          Reject
                        </Button>
                      </Stack>
                    </TableCell>
                  </TableRow>
                  );
                })}
                {!pendingQuery.isFetching && !(pendingQuery.data?.mappings || []).length ? (
                  <TableRow>
                    <TableCell colSpan={5}>
                      <Typography variant="body2" color="text.secondary">
                        Exception queue empty — all current mappings auto-approved or below review threshold.
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </Paper>
        </Stack>
      )}
    </Box>
  );
}
