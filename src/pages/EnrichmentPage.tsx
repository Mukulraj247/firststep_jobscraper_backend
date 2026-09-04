import React from 'react';
import {
  Box,
  LinearProgress,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { getEnrichmentMetrics } from '../api/enrichment';
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

export function EnrichmentPage() {
  const query = useQuery({
    queryKey: ['enrichment-metrics'],
    queryFn: ({ signal }) => getEnrichmentMetrics(signal),
    refetchInterval: 20_000,
    staleTime: 10_000,
  });

  const data = query.data;
  const credits = data?.credits;
  const creditLabel = credits
    ? `${credits.spentToday.toLocaleString()} / ${credits.budget.toLocaleString()}`
    : '—';

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1200, mx: 'auto' }}>
      <Stack spacing={0.5} sx={{ mb: 2.5 }}>
        <Typography variant="overline" sx={{ color: FIRSTSTEP.textMuted, letterSpacing: 1.2 }}>
          Scout-X
        </Typography>
        <Typography variant="h4" sx={{ fontWeight: 800 }}>
          Enrichment
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Live queue drain — career free paths (ATS / HTML) vs Hiring Cafe Scrape.do. Refreshes every
          20s.
        </Typography>
      </Stack>

      {query.isFetching ? <LinearProgress sx={{ mb: 2, borderRadius: 1 }} /> : null}
      {query.isError ? (
        <Typography color="error" sx={{ mb: 2 }}>
          Failed to load enrichment metrics.
        </Typography>
      ) : null}

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 2 }} useFlexGap flexWrap="wrap">
        <Kpi label="Queued" value={data?.queue.queued ?? '—'} hint={`Due now: ${data?.queue.dueNow ?? '—'}`} />
        <Kpi label="Enriching" value={data?.queue.enriching ?? '—'} hint={`Stuck leases: ${data?.queue.leaseStuck ?? 0}`} />
        <Kpi
          label="Deferred"
          value={data?.queue.deferred ?? '—'}
          hint="Career free-path miss — parked for paid path later"
        />
        <Kpi label="Ready 6h" value={data?.windows.ready6h ?? '—'} hint={`Ready 1h: ${data?.windows.ready1h ?? '—'}`} />
        <Kpi
          label="Scrape.do credits"
          value={creditLabel}
          hint={credits?.pausedForScrapeDo ? 'HC scrape.do paused — career free paths keep running' : 'HC worker only'}
        />
      </Stack>

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
        <Paper elevation={0} sx={{ ...cardSx(), p: 2, flex: 1 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
            Career vs Hiring Cafe
          </Typography>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Class</TableCell>
                <TableCell align="right">Queued</TableCell>
                <TableCell align="right">Enriching</TableCell>
                <TableCell align="right">Deferred</TableCell>
                <TableCell align="right">Ready 6h</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(['career', 'hiring_cafe', 'other'] as const).map((key) => {
                const row = data?.bySourceClass?.[key];
                return (
                  <TableRow key={key}>
                    <TableCell>{key === 'hiring_cafe' ? 'Hiring Cafe' : key}</TableCell>
                    <TableCell align="right">{row?.queued ?? '—'}</TableCell>
                    <TableCell align="right">{row?.enriching ?? '—'}</TableCell>
                    <TableCell align="right">{row?.deferred ?? '—'}</TableCell>
                    <TableCell align="right">{row?.ready6h ?? '—'}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Paper>

        <Paper elevation={0} sx={{ ...cardSx(), p: 2, flex: 1 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
            Methods (created last 6h)
          </Typography>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Method</TableCell>
                <TableCell align="right">Count</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {Object.entries(data?.byMethod6h || {}).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={2}>
                    <Typography variant="body2" color="text.secondary">
                      No data yet
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                Object.entries(data?.byMethod6h || {}).map(([method, n]) => (
                  <TableRow key={method}>
                    <TableCell>{method}</TableCell>
                    <TableCell align="right">{n}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Paper>
      </Stack>

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
        <Paper elevation={0} sx={{ ...cardSx(), p: 2, flex: 1 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
            Top queued hosts
          </Typography>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Host</TableCell>
                <TableCell align="right">Queued</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(data?.topQueuedHosts || []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={2}>
                    <Typography variant="body2" color="text.secondary">
                      Queue empty
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                (data?.topQueuedHosts || []).map((row) => (
                  <TableRow key={row.host}>
                    <TableCell sx={{ wordBreak: 'break-all' }}>{row.host}</TableCell>
                    <TableCell align="right">{row.n}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Paper>

        <Paper elevation={0} sx={{ ...cardSx(), p: 2, flex: 1 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
            Top errors
          </Typography>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Error</TableCell>
                <TableCell align="right">Count</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(data?.topErrors || []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={2}>
                    <Typography variant="body2" color="text.secondary">
                      No errors
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                (data?.topErrors || []).map((row) => (
                  <TableRow key={row.error}>
                    <TableCell sx={{ wordBreak: 'break-all' }}>{row.error}</TableCell>
                    <TableCell align="right">{row.n}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Paper>
      </Stack>

      <Paper elevation={0} sx={{ ...cardSx(), p: 2 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
          Last enrichment pass
        </Typography>
        <Typography variant="body2" color="text.secondary">
          claimed={data?.lastPass?.claimed ?? 0} · ready={data?.lastPass?.ready ?? 0} · ats=
          {data?.lastPass?.ats_hit ?? 0} · failed={data?.lastPass?.failed ?? 0} · credits=
          {data?.lastPass?.credits_spent ?? 0}
          {data?.lastPass?.budget_paused ? ' · scrape.do budget flagged' : ''}
          {!(data?.lastPass?.claimed) ? ' (pass counters live in enrichment worker process)' : ''}
        </Typography>
        {data?.asOf ? (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            As of {new Date(data.asOf).toLocaleString()}
          </Typography>
        ) : null}
      </Paper>
    </Box>
  );
}
