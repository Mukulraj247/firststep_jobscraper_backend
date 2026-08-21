import React from 'react';
import { Box, Paper, Stack, Typography } from '@mui/material';
import { cardSx } from '../../components/dashboard/ops/dashboardTokens';
import {
  ERROR_SUMMARY_LINE_CLAMP,
  attemptsLabel,
  canSubmitAction,
  formatFailureTimingLines,
  runDisplayName,
  runIdentity,
  type PendingActions,
  type RowActionErrors,
  workspaceNoLiftHoverSx,
} from './failuresPageBehavior';
import {
  FailureRowActions,
  type FailureRowHandlers,
  type FailureRun,
} from './FailureRowActions';
import { AnomalyChip, FailureReasonSelect, StatusCell } from './FailureTable';

export function FailureCardList({
  runs,
  pending,
  errors,
  handlers,
}: {
  runs: FailureRun[];
  pending: PendingActions;
  errors: RowActionErrors;
  handlers: FailureRowHandlers;
}) {
  return (
    <Stack spacing={1.5} sx={{ p: 1.5 }}>
      {runs.map((run) => {
        const runId = runIdentity(run);
        return (
          <Paper
            key={runId || run.name}
            elevation={0}
            component="article"
            sx={[cardSx(), workspaceNoLiftHoverSx, { p: 1.75 }]}
          >
            <Stack spacing={1.25}>
              <Box
                component="header"
                sx={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  gap: 1,
                }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Typography sx={{ fontWeight: 700 }} noWrap>
                    {runDisplayName(run)}
                  </Typography>
                  <Typography variant="caption" sx={{ fontFamily: 'ui-monospace, monospace' }}>
                    {run.scoutId || 'No Scout ID'}
                  </Typography>
                </Box>
                <StatusCell status={run.status} />
              </Box>

              <Box
                component="dl"
                sx={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 1,
                  m: 0,
                }}
              >
                <Box sx={{ minWidth: 0, m: 0, gridColumn: '1 / -1' }}>
                  <Typography component="dt" variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
                    Reason
                  </Typography>
                  <Box component="dd" sx={{ m: 0 }}>
                    <FailureReasonSelect
                      run={run}
                      pending={!canSubmitAction(pending, runId, 'update-reason')}
                      onChange={(next) => handlers.onReasonChange(run, next)}
                    />
                  </Box>
                </Box>
                <Box sx={{ minWidth: 0, m: 0, gridColumn: '1 / -1' }}>
                  <Typography component="dt" variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
                    Error
                  </Typography>
                  <Typography
                    component="dd"
                    variant="body2"
                    color="text.secondary"
                    sx={{
                      m: 0,
                      display: '-webkit-box',
                      WebkitLineClamp: ERROR_SUMMARY_LINE_CLAMP,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}
                  >
                    {run.errorMessage || '—'}
                  </Typography>
                </Box>
                <Box sx={{ minWidth: 0, m: 0 }}>
                  <Typography component="dt" variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
                    Timing
                  </Typography>
                  {(() => {
                    const timing = formatFailureTimingLines(run);
                    return (
                      <>
                        <Typography component="dd" variant="body2" sx={{ m: 0 }}>
                          {timing.when}
                        </Typography>
                        <Typography component="dd" variant="caption" color="text.secondary" sx={{ m: 0, display: 'block' }}>
                          {timing.detail}
                        </Typography>
                      </>
                    );
                  })()}
                </Box>
                <Box sx={{ minWidth: 0, m: 0 }}>
                  <Typography component="dt" variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
                    Attempts
                  </Typography>
                  <Typography component="dd" variant="body2" sx={{ m: 0 }}>
                    {attemptsLabel(run.retryCount)}
                  </Typography>
                </Box>
                <Box sx={{ minWidth: 0, m: 0 }}>
                  <Typography component="dt" variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
                    Anomaly
                  </Typography>
                  <Box component="dd" sx={{ m: 0 }}>
                    <AnomalyChip run={run} />
                  </Box>
                </Box>
              </Box>

              <Box component="footer">
                <FailureRowActions
                  run={run}
                  pending={pending}
                  errors={errors}
                  handlers={handlers}
                />
              </Box>
            </Stack>
          </Paper>
        );
      })}
    </Stack>
  );
}
