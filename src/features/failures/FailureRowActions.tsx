import React from 'react';
import {
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import ReplayIcon from '@mui/icons-material/Replay';
import { FIRSTSTEP, RADIUS } from '../../components/dashboard/ops/dashboardTokens';
import {
  RETRY_CONFIRM_BODY,
  RETRY_CONFIRM_LABEL,
  RETRY_CONFIRM_TITLE,
  canSubmitAction,
  controlMinHeight,
  detailsActionAriaLabel,
  pendingActionKey,
  retryActionAriaLabel,
  runDisplayName,
  runIdentity,
  type PendingActions,
  type RowActionErrors,
} from './failuresPageBehavior';

export type FailureRun = {
  runId?: string;
  _id?: string;
  name?: string;
  companyName?: string;
  scoutId?: string | null;
  status: string;
  failureReason?: string | null;
  failureReasonSource?: string | null;
  errorMessage?: string | null;
  anomaly?: string | null;
  anomalyMeta?: { escalated?: boolean };
  retryCount?: number;
  startedAt?: string | null;
  finishedAt?: string | null;
  durationMs?: number | null;
  duration?: number | null;
  retryOfRunId?: string;
  originalRunId?: string;
  retrySequence?: number;
};

export type FailureRowHandlers = {
  onDetails: (run: FailureRun) => void;
  onRetry: (run: FailureRun) => void;
  onReasonChange: (run: FailureRun, nextReason: string) => void;
};

export function FailureRowActions({
  run,
  pending,
  errors,
  handlers,
}: {
  run: FailureRun;
  pending: PendingActions;
  errors: RowActionErrors;
  handlers: FailureRowHandlers;
}) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'), { noSsr: true });
  const minHeight = controlMinHeight(isMobile);
  const name = runDisplayName(run);
  const runId = runIdentity(run);
  const retryPending = !canSubmitAction(pending, runId, 'retry');
  const retryError = errors[pendingActionKey(runId, 'retry')];

  return (
    <Stack alignItems="flex-end" spacing={0.5}>
      <Stack direction="row" spacing={0.75} justifyContent="flex-end" alignItems="center">
        <Button
          size="small"
          startIcon={<OpenInNewIcon />}
          onClick={() => handlers.onDetails(run)}
          aria-label={detailsActionAriaLabel(name)}
          sx={{ borderRadius: RADIUS.pill, fontWeight: 700, minHeight, textTransform: 'none' }}
        >
          Details
        </Button>
        <Button
          size="small"
          variant="outlined"
          startIcon={retryPending ? <CircularProgress size={14} color="inherit" /> : <ReplayIcon />}
          disabled={retryPending || !runId}
          onClick={() => handlers.onRetry(run)}
          aria-label={retryActionAriaLabel(name)}
          sx={{
            borderRadius: RADIUS.pill,
            fontWeight: 700,
            minHeight,
            textTransform: 'none',
            color: FIRSTSTEP.navy,
            borderColor: 'divider',
          }}
        >
          Retry
        </Button>
      </Stack>
      {retryError ? (
        <Stack direction="row" spacing={0.75} alignItems="center">
          <Typography variant="caption" color="error">
            {retryError}
          </Typography>
          <Button
            size="small"
            onClick={() => handlers.onRetry(run)}
            aria-label={`Retry again ${name}`}
            sx={{ minWidth: 0, fontWeight: 700, minHeight }}
          >
            Retry
          </Button>
        </Stack>
      ) : null}
    </Stack>
  );
}

export function RetryConfirmDialog({
  run,
  pending,
  onClose,
  onConfirm,
}: {
  run: FailureRun | null;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const name = run ? runDisplayName(run) : 'this run';
  return (
    <Dialog open={Boolean(run)} onClose={pending ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>{RETRY_CONFIRM_TITLE}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ mb: 1.25 }}>
          {RETRY_CONFIRM_BODY}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Automation: <strong>{name}</strong>
        </Typography>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={pending} sx={{ borderRadius: RADIUS.pill }}>
          Cancel
        </Button>
        <Button
          variant="contained"
          color="error"
          onClick={onConfirm}
          disabled={pending}
          startIcon={pending ? <CircularProgress size={14} color="inherit" /> : <ReplayIcon />}
          sx={{ borderRadius: RADIUS.pill, fontWeight: 700 }}
        >
          {RETRY_CONFIRM_LABEL}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
