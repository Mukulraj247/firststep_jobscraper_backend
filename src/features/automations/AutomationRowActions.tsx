import React, { useState } from 'react';
import {
  Button,
  CircularProgress,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import type { AutomationSummary } from '../../api/automation';
import { formatTagChipLabel } from '../../components/automation/TagPicker';
import { FIRSTSTEP, RADIUS } from '../../components/dashboard/ops/dashboardTokens';
import {
  SAFE_EXTERNAL_LINK_REL,
  SAFE_EXTERNAL_LINK_TARGET,
  canSubmitAction,
  controlMinHeight,
  failedRowActions,
  namedActionAriaLabel,
  overflowMenuAriaLabel,
  pendingActionKey,
  retryActionAriaLabel,
  rowRetryHandlerName,
  runActionAriaLabel,
  type PendingActions,
  type RowActionErrors,
} from './automationsPageBehavior';

export type AutomationRowHandlers = {
  onRun: (automation: AutomationSummary) => void;
  onOpenSchedule: (automation: AutomationSummary) => void;
  onPauseSchedule: (automation: AutomationSummary) => void;
  onResumeSchedule: (automation: AutomationSummary) => void;
  onViewData: (automation: AutomationSummary) => void;
  onRunHistory: (automation: AutomationSummary) => void;
  onConfigure: (automation: AutomationSummary) => void;
  onDelete: (automation: AutomationSummary) => void;
  onOpenLastRun: (automation: AutomationSummary) => void;
  onCopyScoutId: (scoutId: string) => void;
  onCopyTargetUrl: (url: string) => void;
};

export function AutomationRowActions({
  automation,
  pending,
  errors,
  copiedScoutId,
  copiedTargetUrl,
  handlers,
  compact = false,
}: {
  automation: AutomationSummary;
  pending: PendingActions;
  errors: RowActionErrors;
  copiedScoutId: string | null;
  copiedTargetUrl: string | null;
  handlers: AutomationRowHandlers;
  compact?: boolean;
}) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'), { noSsr: true });
  const minHeight = controlMinHeight(isMobile);
  const [menuEl, setMenuEl] = useState<null | HTMLElement>(null);
  const menuOpen = Boolean(menuEl);
  const runPending = !canSubmitAction(pending, automation.id, 'run');
  const failedActions = failedRowActions(errors, automation.id);
  const scheduleState = automation.schedule?.enabled
    ? 'active'
    : automation.schedule?.cron && !automation.schedule?.enabled
      ? 'paused'
      : 'manual';

  const closeAnd = (fn: () => void) => {
    setMenuEl(null);
    fn();
  };

  return (
    <Stack alignItems="flex-end" spacing={0.5}>
      <Stack direction="row" spacing={0.75} justifyContent="flex-end" alignItems="center">
        <Button
          size="small"
          variant="contained"
          onClick={() => handlers.onRun(automation)}
          disabled={runPending}
          aria-label={runActionAriaLabel(automation.name)}
          startIcon={runPending ? <CircularProgress size={14} color="inherit" /> : undefined}
          sx={{
            borderRadius: RADIUS.pill,
            fontWeight: 700,
            px: compact ? 1.35 : 1.75,
            minHeight: compact ? 32 : minHeight,
            fontSize: compact ? '0.8125rem' : undefined,
            bgcolor: FIRSTSTEP.teal,
            color: FIRSTSTEP.navyDeep,
            '&:hover': { bgcolor: '#5fc4b9' },
            '&.Mui-disabled': { bgcolor: 'rgba(79, 179, 169, 0.35)', color: FIRSTSTEP.navyDeep },
          }}
        >
          Run
        </Button>
        <IconButton
          size="small"
          aria-label={overflowMenuAriaLabel(automation.name)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={(event) => setMenuEl(event.currentTarget)}
          sx={{ minHeight: compact ? 32 : minHeight, minWidth: compact ? 32 : minHeight }}
        >
          <MoreVertIcon fontSize="small" />
        </IconButton>
        <Menu
          anchorEl={menuEl}
          open={menuOpen}
          onClose={() => setMenuEl(null)}
          MenuListProps={{ 'aria-label': overflowMenuAriaLabel(automation.name) }}
        >
          <MenuItem
            aria-label={namedActionAriaLabel('Schedule', automation.name)}
            onClick={() => closeAnd(() => handlers.onOpenSchedule(automation))}
          >
            Schedule
          </MenuItem>
          {scheduleState === 'active' ? (
            <MenuItem
              aria-label={namedActionAriaLabel('Pause schedule', automation.name)}
              disabled={!canSubmitAction(pending, automation.id, 'pause-schedule')}
              onClick={() => closeAnd(() => handlers.onPauseSchedule(automation))}
            >
              Pause schedule
            </MenuItem>
          ) : null}
          {scheduleState === 'paused' ? (
            <MenuItem
              aria-label={namedActionAriaLabel('Resume schedule', automation.name)}
              disabled={!canSubmitAction(pending, automation.id, 'resume-schedule')}
              onClick={() => closeAnd(() => handlers.onResumeSchedule(automation))}
            >
              Resume schedule
            </MenuItem>
          ) : null}
          <MenuItem
            aria-label={namedActionAriaLabel('View data', automation.name)}
            onClick={() => closeAnd(() => handlers.onViewData(automation))}
          >
            View data
          </MenuItem>
          <MenuItem
            aria-label={namedActionAriaLabel('Run history', automation.name)}
            onClick={() => closeAnd(() => handlers.onRunHistory(automation))}
          >
            Run history
          </MenuItem>
          <MenuItem
            aria-label={namedActionAriaLabel('Configure', automation.name)}
            onClick={() => closeAnd(() => handlers.onConfigure(automation))}
          >
            Configure
          </MenuItem>
          {automation.latestRunId ? (
            <MenuItem
              aria-label={namedActionAriaLabel('Open last run', automation.name)}
              onClick={() => closeAnd(() => handlers.onOpenLastRun(automation))}
            >
              Last run
            </MenuItem>
          ) : null}
          {automation.scoutId ? (
            <MenuItem
              aria-label={namedActionAriaLabel('Copy Scout ID', automation.name)}
              onClick={() => closeAnd(() => handlers.onCopyScoutId(automation.scoutId!))}
            >
              {copiedScoutId === automation.scoutId ? 'Scout ID copied' : 'Copy Scout ID'}
            </MenuItem>
          ) : null}
          <MenuItem
            aria-label={namedActionAriaLabel('Delete', automation.name)}
            disabled={!canSubmitAction(pending, automation.id, 'delete')}
            onClick={() => closeAnd(() => handlers.onDelete(automation))}
            sx={{ color: 'error.main' }}
          >
            Delete
          </MenuItem>
        </Menu>
      </Stack>
      {failedActions.map((action) => (
        <Stack key={action} direction="row" spacing={0.75} alignItems="center">
          <Typography variant="caption" color="error">
            {errors[pendingActionKey(automation.id, action)]}
          </Typography>
          <Button
            size="small"
            onClick={() => handlers[rowRetryHandlerName(action)](automation)}
            aria-label={retryActionAriaLabel(action, automation.name)}
            sx={{ minWidth: 0, fontWeight: 700, minHeight }}
          >
            Retry
          </Button>
        </Stack>
      ))}
    </Stack>
  );
}

export function AutomationDetailsPanel({
  automation,
  onCopyScoutId,
  onCopyTargetUrl,
  copiedScoutId,
  copiedTargetUrl,
}: {
  automation: AutomationSummary;
  onCopyScoutId: (scoutId: string) => void;
  onCopyTargetUrl: (url: string) => void;
  copiedScoutId: string | null;
  copiedTargetUrl: string | null;
}) {
  const tags = automation.tags || [];
  return (
    <Stack spacing={1} sx={{ py: 0.5 }}>
      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
        Details
      </Typography>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center">
        {automation.targetUrl ? (
          <Button
            size="small"
            component="a"
            href={automation.targetUrl}
            target={SAFE_EXTERNAL_LINK_TARGET}
            rel={SAFE_EXTERNAL_LINK_REL}
            aria-label={namedActionAriaLabel('Open target URL', automation.name)}
            sx={{ borderRadius: RADIUS.pill, textTransform: 'none' }}
          >
            Open target URL
          </Button>
        ) : (
          <Typography variant="body2" color="text.disabled">No target URL</Typography>
        )}
        {automation.scoutId ? (
          <Button
            size="small"
            onClick={() => onCopyScoutId(automation.scoutId!)}
            aria-label={namedActionAriaLabel('Copy Scout ID', automation.name)}
            sx={{ borderRadius: RADIUS.pill, textTransform: 'none', fontFamily: 'ui-monospace, monospace' }}
          >
            {copiedScoutId === automation.scoutId ? 'Copied ID' : automation.scoutId}
          </Button>
        ) : null}
      </Stack>
      <Typography variant="body2" color="text.secondary">
        Tags: {tags.length ? tags.map(formatTagChipLabel).join(', ') : '—'}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>
        Cron: {automation.schedule?.cron || '—'}
      </Typography>
    </Stack>
  );
}
