import React, { useState } from 'react';
import {
  Box,
  Chip,
  Collapse,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import DangerousOutlinedIcon from '@mui/icons-material/DangerousOutlined';
import { FIRSTSTEP, RADIUS } from '../../components/dashboard/ops/dashboardTokens';
import {
  DESKTOP_TABLE_HEADER_BG,
  DESKTOP_TABLE_ROW_HEIGHT_PX,
  DESKTOP_TABLE_ROW_HOVER_BG,
  DESKTOP_TABLE_SIZE,
  DESKTOP_TABLE_STATUS_MARKER_PX,
  ERROR_SUMMARY_LINE_CLAMP,
  FAILURES_TABLE_CAPTION,
  FAILURE_REASON_OPTIONS,
  anomalyLabel,
  attemptsLabel,
  canSubmitAction,
  controlMinHeight,
  failureReasonLabel,
  formatFailureTimingLines,
  formatRunWhen,
  failuresTableScrollSx,
  reasonSelectAriaLabel,
  reasonSelectId,
  reasonSelectLabelId,
  rowStatusLabel,
  runDisplayName,
  runIdentity,
  statusMarkerColor,
  type PendingActions,
  type RowActionErrors,
} from './failuresPageBehavior';
import {
  FailureRowActions,
  type FailureRowHandlers,
  type FailureRun,
} from './FailureRowActions';

function StatusCell({ status }: { status: string }) {
  const dead = status === 'dead';
  return (
    <Stack direction="row" spacing={0.75} alignItems="center">
      {dead ? (
        <DangerousOutlinedIcon fontSize="small" sx={{ color: FIRSTSTEP.danger }} aria-hidden />
      ) : (
        <ErrorOutlineIcon fontSize="small" sx={{ color: FIRSTSTEP.danger }} aria-hidden />
      )}
      <Typography variant="body2" sx={{ fontWeight: 700 }}>
        {rowStatusLabel(status)}
      </Typography>
    </Stack>
  );
}

export function FailureReasonSelect({
  run,
  pending,
  onChange,
}: {
  run: FailureRun;
  pending: boolean;
  onChange: (nextReason: string) => void;
}) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'), { noSsr: true });
  const runId = runIdentity(run);
  const name = runDisplayName(run);
  const labelId = reasonSelectLabelId(runId);
  return (
    <FormControl size="small" fullWidth sx={{ minWidth: 0 }}>
      <InputLabel id={labelId} sx={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
        {reasonSelectAriaLabel(name, runId)}
      </InputLabel>
      <Select
        id={reasonSelectId(runId)}
        labelId={labelId}
        displayEmpty
        value={run.failureReason || ''}
        disabled={pending || !runId}
        onChange={(event) => onChange(String(event.target.value))}
        aria-label={reasonSelectAriaLabel(name, runId)}
        sx={{ minHeight: controlMinHeight(isMobile), borderRadius: RADIUS.control }}
        renderValue={(selected) => {
          if (!selected) return '—';
          return failureReasonLabel(String(selected));
        }}
      >
        {FAILURE_REASON_OPTIONS.map((option) => (
          <MenuItem key={option.code} value={option.code}>
            {option.label}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}

export function AnomalyChip({ run }: { run: FailureRun }) {
  const label = anomalyLabel(run.anomaly, run.anomalyMeta);
  if (!label) {
    return (
      <Typography variant="body2" color="text.secondary">
        None
      </Typography>
    );
  }
  const severe = run.anomaly === 'zero_rows' || run.anomalyMeta?.escalated;
  return (
    <Chip
      size="small"
      variant="outlined"
      color={severe ? 'error' : 'warning'}
      label={label}
      sx={{ fontWeight: 700, borderRadius: RADIUS.pill }}
    />
  );
}

export function FailureDetailsPanel({ run }: { run: FailureRun }) {
  return (
    <Stack spacing={0.75} sx={{ py: 0.5 }}>
      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
        Details
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Finished: {formatRunWhen(run.finishedAt, run.startedAt)}
      </Typography>
      {run.failureReasonSource ? (
        <Typography variant="body2" color="text.secondary">
          Reason source: {run.failureReasonSource}
        </Typography>
      ) : null}
      {run.retryOfRunId ? (
        <Typography variant="body2" color="text.secondary">
          Retry of {run.retryOfRunId}
          {run.retrySequence != null ? ` · sequence ${run.retrySequence}` : ''}
        </Typography>
      ) : null}
      <Typography variant="body2" color="text.secondary">
        Screenshots, logs, and extracted rows are on the Details page.
      </Typography>
    </Stack>
  );
}

export function FailureTable({
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
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const headerCellSx = {
    bgcolor: (muiTheme: { palette: { mode: string } }) =>
      muiTheme.palette.mode === 'dark' ? 'background.paper' : DESKTOP_TABLE_HEADER_BG,
    top: 0,
    zIndex: 1,
    fontSize: '0.8125rem',
    position: 'sticky' as const,
  };

  return (
    <TableContainer sx={failuresTableScrollSx()}>
      <Table
        stickyHeader
        size={DESKTOP_TABLE_SIZE}
        sx={{
          '& caption': { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' },
          '& .MuiTableCell-root': { fontSize: '0.8125rem' },
        }}
      >
        <caption>{FAILURES_TABLE_CAPTION}</caption>
        <TableHead>
          <TableRow>
            <TableCell sx={headerCellSx}><strong>Automation</strong></TableCell>
            <TableCell sx={headerCellSx}><strong>Status</strong></TableCell>
            <TableCell sx={headerCellSx}><strong>Reason</strong></TableCell>
            <TableCell sx={headerCellSx}><strong>Error</strong></TableCell>
            <TableCell sx={headerCellSx}><strong>Anomaly</strong></TableCell>
            <TableCell sx={headerCellSx}><strong>Timing</strong></TableCell>
            <TableCell sx={headerCellSx}><strong>Attempts</strong></TableCell>
            <TableCell align="right" sx={headerCellSx}><strong>Actions</strong></TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {runs.map((run) => {
            const runId = runIdentity(run);
            const open = expandedId === runId;
            return (
              <React.Fragment key={runId || run.name}>
                <TableRow
                  hover
                  onClick={() => setExpandedId(open ? null : runId)}
                  sx={{
                    height: DESKTOP_TABLE_ROW_HEIGHT_PX,
                    cursor: 'pointer',
                    borderLeft: `${DESKTOP_TABLE_STATUS_MARKER_PX}px solid ${statusMarkerColor(run.status)}`,
                    '&.MuiTableRow-hover:hover': {
                      bgcolor: DESKTOP_TABLE_ROW_HOVER_BG,
                      boxShadow: 'none',
                    },
                  }}
                >
                  <TableCell>
                    <Typography sx={{ fontWeight: 700, lineHeight: 1.25 }}>
                      {runDisplayName(run)}
                    </Typography>
                    <Typography variant="caption" sx={{ fontFamily: 'ui-monospace, monospace', display: 'block' }}>
                      {run.scoutId || 'No Scout ID'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <StatusCell status={run.status} />
                  </TableCell>
                  <TableCell
                    sx={{ minWidth: 120 }}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <FailureReasonSelect
                      run={run}
                      pending={!canSubmitAction(pending, runId, 'update-reason')}
                      onChange={(next) => handlers.onReasonChange(run, next)}
                    />
                  </TableCell>
                  <TableCell sx={{ maxWidth: 260 }}>
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{
                        display: '-webkit-box',
                        WebkitLineClamp: ERROR_SUMMARY_LINE_CLAMP,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }}
                      title={run.errorMessage || ''}
                    >
                      {run.errorMessage || '—'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <AnomalyChip run={run} />
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'normal' }}>
                    {(() => {
                      const timing = formatFailureTimingLines(run);
                      return (
                        <>
                          <Typography variant="body2">{timing.when}</Typography>
                          <Typography variant="caption" color="text.secondary">
                            {timing.detail}
                          </Typography>
                        </>
                      );
                    })()}
                  </TableCell>
                  <TableCell sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    {attemptsLabel(run.retryCount)}
                  </TableCell>
                  <TableCell align="right" onClick={(event) => event.stopPropagation()}>
                    <FailureRowActions
                      run={run}
                      pending={pending}
                      errors={errors}
                      handlers={handlers}
                    />
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell colSpan={8} sx={{ py: 0, borderBottom: open ? undefined : 0 }}>
                    <Collapse in={open} timeout="auto" unmountOnExit>
                      <Box sx={{ py: 1.5, pr: 1 }}>
                        <FailureDetailsPanel run={run} />
                      </Box>
                    </Collapse>
                  </TableCell>
                </TableRow>
              </React.Fragment>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

export { StatusCell };
