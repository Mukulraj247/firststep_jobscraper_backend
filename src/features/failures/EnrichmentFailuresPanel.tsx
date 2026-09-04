import React, { useCallback, useState } from 'react';
import {
  Box,
  Button,
  Link,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listEnrichmentFailures,
  requeueEnrichmentFailure,
  type EnrichmentFailureItem,
} from '../../api/jobs';
import { useGlobalInfoStore } from '../../context/globalInfo';
import { cardSx, FIRSTSTEP } from '../../components/dashboard/ops/dashboardTokens';

export function EnrichmentFailuresPanel() {
  const { notify } = useGlobalInfoStore();
  const queryClient = useQueryClient();
  const [requeueId, setRequeueId] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['enrichment-failures', 0, 25],
    queryFn: () => listEnrichmentFailures({ page: 0, limit: 25 }),
    staleTime: 30_000,
  });

  const onRequeue = useCallback(
    async (item: EnrichmentFailureItem) => {
      setRequeueId(item.id);
      try {
        await requeueEnrichmentFailure(item.id);
        notify('success', `Requeued: ${item.title || item.jobUrl || item.id}`);
        await queryClient.invalidateQueries({ queryKey: ['enrichment-failures'] });
      } catch (err: any) {
        notify('error', err?.response?.data?.error || 'Failed to requeue');
      } finally {
        setRequeueId(null);
      }
    },
    [notify, queryClient]
  );

  const items = query.data?.items || [];
  const total = query.data?.total || 0;

  return (
    <Paper elevation={0} sx={{ ...cardSx(), mb: 3, p: { xs: 2, md: 2.5 } }}>
      <Stack spacing={1.5}>
        <Box>
          <Typography variant="overline" sx={{ color: FIRSTSTEP.textMuted, letterSpacing: 1.2 }}>
            Hiring Cafe
          </Typography>
          <Typography variant="h6" sx={{ fontWeight: 700, mt: 0.25 }}>
            Enrichment failures
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Exhausted after 10 soft retries (hidden from Job Board). Requeue resets attempts.
          </Typography>
        </Box>

        {query.isLoading ? (
          <Typography variant="body2" color="text.secondary">
            Loading…
          </Typography>
        ) : total === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No exhausted Hiring Cafe enrichments.
          </Typography>
        ) : (
          <>
            <Typography variant="caption" color="text.secondary">
              Showing {items.length} of {total}
            </Typography>
            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Title</TableCell>
                    <TableCell>URL</TableCell>
                    <TableCell>Attempts</TableCell>
                    <TableCell>Last error</TableCell>
                    <TableCell align="right">Action</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {items.map((item) => {
                    const url = item.aggregatorPostingUrl || item.jobUrl;
                    return (
                      <TableRow key={item.id} hover>
                        <TableCell>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>
                            {item.title || 'Untitled'}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {item.company || '—'}
                          </Typography>
                        </TableCell>
                        <TableCell sx={{ maxWidth: 280 }}>
                          {url ? (
                            <Link href={url} target="_blank" rel="noopener noreferrer" variant="body2">
                              Open
                            </Link>
                          ) : (
                            '—'
                          )}
                        </TableCell>
                        <TableCell>{item.attempts}</TableCell>
                        <TableCell sx={{ maxWidth: 220 }}>
                          <Typography variant="caption" sx={{ wordBreak: 'break-word' }}>
                            {item.lastError || '—'}
                          </Typography>
                        </TableCell>
                        <TableCell align="right">
                          <Button
                            size="small"
                            variant="outlined"
                            disabled={requeueId === item.id}
                            onClick={() => onRequeue(item)}
                          >
                            {requeueId === item.id ? 'Requeueing…' : 'Requeue'}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Box>
          </>
        )}
      </Stack>
    </Paper>
  );
}
