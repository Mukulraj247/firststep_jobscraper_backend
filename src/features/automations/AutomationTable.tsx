import React, { useState } from 'react';
import {
  Box,
  Chip,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import type { AutomationSummary } from '../../api/automation';
import { formatTagChipLabel } from '../../components/automation/TagPicker';
import { getScheduleLabel } from '../../constants/scheduleOptions';
import { computeNextRunRelative, formatRelativeToNow } from '../../utils/cronBuilder';
import { FIRSTSTEP, RADIUS, tint } from '../../components/dashboard/ops/dashboardTokens';
import {
  AUTOMATIONS_TABLE_CAPTION,
  DESKTOP_TABLE_HEADER_BG,
  DESKTOP_TABLE_MIN_WIDTH_PX,
  DESKTOP_TABLE_ROW_DIVIDER,
  DESKTOP_TABLE_ROW_HEIGHT_PX,
  DESKTOP_TABLE_ROW_HOVER_BG,
  DESKTOP_TABLE_SIZE,
  DESKTOP_TABLE_STATUS_MARKER_PX,
  SAFE_EXTERNAL_LINK_REL,
  SAFE_EXTERNAL_LINK_TARGET,
  SEE_ALL_TAGS_LABEL,
  automationsTableScrollSx,
  controlMinHeight,
  formatLastRunActivity,
  hasLatestRunFailure,
  namedActionAriaLabel,
  scheduleChipAriaLabel,
  scheduleDisplayState,
  seeAllTagsAriaLabel,
  shouldShowSeeAllTagsChip,
  statusChipLabel,
  statusMarkerColor,
  visibleTagsForCell,
} from './automationsPageBehavior';
import {
  AutomationRowActions,
  type AutomationRowHandlers,
} from './AutomationRowActions';
import { AutomationTagsModal } from './AutomationTagsModal';
import type { PendingActions, RowActionErrors } from './automationsPageBehavior';

function healthColor(status: string): 'success' | 'error' | 'warning' | 'info' | 'default' {
  if (status === 'completed' || status === 'success') return 'success';
  if (status === 'failed' || status === 'dead') return 'error';
  if (status === 'running' || status === 'queued' || status === 'pending') return 'info';
  if (status === 'aborted' || status === 'aborting') return 'warning';
  return 'default';
}

function scheduleChipColor(state: ReturnType<typeof scheduleDisplayState>): 'success' | 'warning' | 'default' {
  if (state === 'active') return 'success';
  if (state === 'paused') return 'warning';
  return 'default';
}

function stickyHeaderCellSx(extra?: Record<string, unknown>) {
  return {
    bgcolor: (muiTheme: { palette: { mode: string } }) =>
      muiTheme.palette.mode === 'dark' ? 'background.paper' : DESKTOP_TABLE_HEADER_BG,
    top: 0,
    zIndex: 2,
    fontSize: '0.8125rem',
    fontWeight: 600,
    letterSpacing: '0.01em',
    color: 'text.secondary',
    whiteSpace: 'nowrap' as const,
    py: 1.5,
    borderBottom: `1px solid ${DESKTOP_TABLE_ROW_DIVIDER}`,
    ...extra,
  };
}

function stickyNameCellSx(isHeader = false) {
  return {
    position: 'sticky' as const,
    left: 0,
    zIndex: isHeader ? 3 : 1,
    bgcolor: (muiTheme: { palette: { mode: string; background: { paper: string } } }) =>
      isHeader
        ? muiTheme.palette.mode === 'dark'
          ? muiTheme.palette.background.paper
          : DESKTOP_TABLE_HEADER_BG
        : muiTheme.palette.background.paper,
    boxShadow: '1px 0 0 rgba(2, 51, 69, 0.06)',
  };
}

export function ScheduleChip({
  automation,
  onOpen,
}: {
  automation: AutomationSummary;
  onOpen: (automation: AutomationSummary) => void;
}) {
  const state = scheduleDisplayState(automation.schedule);
  const label =
    state === 'manual'
      ? 'Manual'
      : getScheduleLabel(automation.schedule?.cron);
  return (
    <Chip
      size="small"
      variant={state === 'active' ? 'filled' : 'outlined'}
      color={scheduleChipColor(state)}
      aria-label={scheduleChipAriaLabel(state, automation.name)}
      label={label}
      onClick={() => onOpen(automation)}
      sx={{ cursor: 'pointer', fontWeight: 600, borderRadius: RADIUS.pill, maxWidth: 120, height: 24 }}
    />
  );
}

export function NextRunLabel({ automation }: { automation: AutomationSummary }) {
  const state = scheduleDisplayState(automation.schedule);
  if (state === 'manual') {
    return (
      <Typography variant="body2" color="text.disabled" sx={{ fontSize: '0.8125rem' }}>
        —
      </Typography>
    );
  }
  if (state === 'paused') {
    return (
      <Typography variant="body2" sx={{ color: 'warning.main', fontWeight: 600, fontSize: '0.8125rem' }}>
        Paused
      </Typography>
    );
  }
  const tz = automation.schedule?.timezone || 'UTC';
  const serverNext = automation.schedule?.nextRunAt
    ? new Date(automation.schedule.nextRunAt)
    : null;
  const { relative, absolute } =
    serverNext && !Number.isNaN(serverNext.getTime())
      ? formatRelativeToNow(serverNext, tz)
      : computeNextRunRelative(automation.schedule?.cron || '', tz);
  return (
    <Tooltip title={absolute} arrow>
      <Typography variant="body2" sx={{ color: FIRSTSTEP.tealDark, fontWeight: 600, whiteSpace: 'nowrap', fontSize: '0.8125rem' }}>
        {relative}
      </Typography>
    </Tooltip>
  );
}

export function StatusCell({ automation }: { automation: AutomationSummary }) {
  const failed = hasLatestRunFailure(automation.status, automation.latestFailureReason);
  const reason = automation.latestFailureReason?.trim();
  const label = statusChipLabel(automation.status);
  return (
    <Stack spacing={0.25} alignItems="flex-start">
      <Stack direction="row" spacing={0.5} alignItems="center">
        <Chip
          size="small"
          color={healthColor(automation.status)}
          label={label}
          sx={{ fontWeight: 700, height: 22, fontSize: '0.6875rem', textTransform: 'lowercase' }}
        />
        {failed ? (
          <Tooltip title={reason || 'Latest run failed'} arrow>
            <ErrorOutlineIcon fontSize="inherit" sx={{ color: FIRSTSTEP.danger, fontSize: 16 }} />
          </Tooltip>
        ) : null}
      </Stack>
      {failed && reason ? (
        <Typography
          variant="caption"
          color="warning.main"
          sx={{ lineHeight: 1.2, maxWidth: 140, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
        >
          {reason}
        </Typography>
      ) : null}
    </Stack>
  );
}

function TagsCell({
  tags,
  automationName,
  onSeeAll,
}: {
  tags: string[];
  automationName: string;
  onSeeAll: () => void;
}) {
  if (!tags.length) {
    return (
      <Typography variant="body2" color="text.disabled" sx={{ fontSize: '0.8125rem' }}>
        —
      </Typography>
    );
  }
  const visible = visibleTagsForCell(tags);
  const showSeeAll = shouldShowSeeAllTagsChip(tags);
  return (
    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
      {visible.map((tag) => (
        <Chip
          key={tag}
          size="small"
          label={formatTagChipLabel(tag)}
          onClick={showSeeAll ? onSeeAll : undefined}
          sx={{
            height: 22,
            fontSize: '0.6875rem',
            borderRadius: RADIUS.pill,
            maxWidth: showSeeAll ? 92 : 140,
            cursor: showSeeAll ? 'pointer' : 'default',
          }}
        />
      ))}
      {showSeeAll ? (
        <Chip
          size="small"
          variant="outlined"
          clickable
          onClick={onSeeAll}
          aria-label={seeAllTagsAriaLabel(automationName)}
          label={SEE_ALL_TAGS_LABEL}
          sx={{
            height: 22,
            fontSize: '0.6875rem',
            fontWeight: 700,
            borderRadius: RADIUS.pill,
            color: FIRSTSTEP.tealDark,
            borderColor: tint(FIRSTSTEP.teal, 0.45),
            bgcolor: tint(FIRSTSTEP.teal, 0.08),
            '&:hover': { bgcolor: tint(FIRSTSTEP.teal, 0.16) },
          }}
        />
      ) : null}
    </Stack>
  );
}

function TargetUrlCell({
  automation,
  copiedTargetUrl,
  onCopyTargetUrl,
}: {
  automation: AutomationSummary;
  copiedTargetUrl: string | null;
  onCopyTargetUrl: (url: string) => void;
}) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'), { noSsr: true });
  const iconSize = controlMinHeight(isMobile) - 12;
  if (!automation.targetUrl) {
    return (
      <Typography variant="body2" color="text.disabled" sx={{ fontSize: '0.8125rem' }}>
        —
      </Typography>
    );
  }
  const copied = copiedTargetUrl === automation.targetUrl;
  return (
    <Stack direction="row" spacing={0.25}>
      <Tooltip title="Open target URL" arrow>
        <IconButton
          size="small"
          component="a"
          href={automation.targetUrl}
          target={SAFE_EXTERNAL_LINK_TARGET}
          rel={SAFE_EXTERNAL_LINK_REL}
          aria-label={namedActionAriaLabel('Open target URL', automation.name)}
          sx={{ width: iconSize, height: iconSize, color: FIRSTSTEP.tealDark }}
        >
          <OpenInNewIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Tooltip>
      <Tooltip title={copied ? 'Copied' : 'Copy target URL'} arrow>
        <IconButton
          size="small"
          onClick={() => onCopyTargetUrl(automation.targetUrl)}
          aria-label={namedActionAriaLabel('Copy target URL', automation.name)}
          sx={{ width: iconSize, height: iconSize, color: copied ? FIRSTSTEP.success : 'text.secondary' }}
        >
          <ContentCopyIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Tooltip>
    </Stack>
  );
}

function TruncatedText({
  value,
  monospace = false,
  maxWidth = 120,
}: {
  value: string;
  monospace?: boolean;
  maxWidth?: number;
}) {
  return (
    <Tooltip title={value} arrow>
      <Typography
        variant="body2"
        sx={{
          maxWidth,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontWeight: monospace ? 500 : 600,
          fontFamily: monospace ? 'ui-monospace, monospace' : undefined,
          fontSize: monospace ? '0.75rem' : '0.8125rem',
          lineHeight: 1.45,
        }}
      >
        {value}
      </Typography>
    </Tooltip>
  );
}

export function AutomationTable({
  automations,
  pending,
  errors,
  copiedScoutId,
  copiedTargetUrl,
  handlers,
  showJobBoardColumn = false,
}: {
  automations: AutomationSummary[];
  pending: PendingActions;
  errors: RowActionErrors;
  copiedScoutId: string | null;
  copiedTargetUrl: string | null;
  handlers: AutomationRowHandlers;
  /** Aggregators: show jobs added to the job board from the latest run. */
  showJobBoardColumn?: boolean;
}) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'), { noSsr: true });
  const iconSize = controlMinHeight(isMobile) - 12;
  const [tagsModal, setTagsModal] = useState<{ name: string; tags: string[] } | null>(null);

  return (
    <>
    <TableContainer sx={automationsTableScrollSx()}>
      <Table
        stickyHeader
        size={DESKTOP_TABLE_SIZE}
        sx={{
          minWidth: showJobBoardColumn ? DESKTOP_TABLE_MIN_WIDTH_PX + 72 : DESKTOP_TABLE_MIN_WIDTH_PX,
          tableLayout: 'fixed',
          borderCollapse: 'separate',
          borderSpacing: 0,
          '& caption': { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' },
          '& .MuiTableCell-root': {
            fontSize: '0.8125rem',
            py: 1.35,
            px: 1.5,
            verticalAlign: 'middle',
            borderBottom: `1px solid ${DESKTOP_TABLE_ROW_DIVIDER}`,
          },
          '& .MuiTableBody-root .MuiTableRow-root:last-child .MuiTableCell-root': {
            borderBottom: 0,
          },
        }}
      >
        <caption>
          {showJobBoardColumn
            ? `${AUTOMATIONS_TABLE_CAPTION} Plus job board count.`
            : AUTOMATIONS_TABLE_CAPTION}
        </caption>
        <colgroup>
          <col style={{ width: showJobBoardColumn ? '10%' : '11%' }} />
          <col style={{ width: '9%' }} />
          <col style={{ width: '9%' }} />
          <col style={{ width: showJobBoardColumn ? '11%' : '13%' }} />
          <col style={{ width: '7%' }} />
          <col style={{ width: showJobBoardColumn ? '12%' : '14%' }} />
          <col style={{ width: '5%' }} />
          {showJobBoardColumn ? <col style={{ width: '6%' }} /> : null}
          <col style={{ width: '8%' }} />
          <col style={{ width: '9%' }} />
          <col style={{ width: '11%' }} />
        </colgroup>
        <TableHead>
          <TableRow>
            <TableCell sx={[stickyHeaderCellSx(), stickyNameCellSx(true)]}>Name</TableCell>
            <TableCell sx={stickyHeaderCellSx()}>ID</TableCell>
            <TableCell sx={stickyHeaderCellSx()}>Company</TableCell>
            <TableCell sx={stickyHeaderCellSx()}>Tags</TableCell>
            <TableCell sx={stickyHeaderCellSx()}>URL</TableCell>
            <TableCell sx={stickyHeaderCellSx()}>Last run</TableCell>
            <TableCell sx={stickyHeaderCellSx()} align="right">Rows</TableCell>
            {showJobBoardColumn ? (
              <TableCell sx={stickyHeaderCellSx()} align="right">Job board</TableCell>
            ) : null}
            <TableCell sx={stickyHeaderCellSx()}>Next run</TableCell>
            <TableCell sx={stickyHeaderCellSx()}>Schedule</TableCell>
            <TableCell align="right" sx={stickyHeaderCellSx()}>Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {automations.map((automation, index) => (
            <TableRow
              key={automation.id}
              hover
              sx={{
                minHeight: DESKTOP_TABLE_ROW_HEIGHT_PX,
                bgcolor: index % 2 === 1 ? 'rgba(2, 51, 69, 0.015)' : 'background.paper',
                borderLeft: `${DESKTOP_TABLE_STATUS_MARKER_PX}px solid ${statusMarkerColor(automation.status)}`,
                transition: 'background-color 120ms ease',
                '&.MuiTableRow-hover:hover': {
                  bgcolor: DESKTOP_TABLE_ROW_HOVER_BG,
                  boxShadow: 'none',
                },
                '& .MuiTableCell-root:first-of-type': {
                  ...stickyNameCellSx(false),
                },
                '&:hover .MuiTableCell-root:first-of-type': {
                  bgcolor: DESKTOP_TABLE_ROW_HOVER_BG,
                },
                '&:nth-of-type(even) .MuiTableCell-root:first-of-type': {
                  bgcolor: (muiTheme: { palette: { mode: string; background: { paper: string } } }) =>
                    muiTheme.palette.mode === 'dark' ? 'background.paper' : 'rgba(248, 250, 251, 0.9)',
                },
                '&:nth-of-type(even):hover .MuiTableCell-root:first-of-type': {
                  bgcolor: DESKTOP_TABLE_ROW_HOVER_BG,
                },
              }}
            >
              <TableCell>
                <TruncatedText value={automation.name} maxWidth={120} />
              </TableCell>
              <TableCell>
                {automation.scoutId ? (
                  <Tooltip title={copiedScoutId === automation.scoutId ? 'Copied' : 'Click to copy Scout ID'} arrow>
                    <Box
                      component="button"
                      type="button"
                      onClick={() => handlers.onCopyScoutId(automation.scoutId!)}
                      aria-label={namedActionAriaLabel('Copy Scout ID', automation.name)}
                      sx={{
                        border: 0,
                        bgcolor: 'transparent',
                        p: 0,
                        m: 0,
                        cursor: 'pointer',
                        textAlign: 'left',
                        minHeight: iconSize,
                      }}
                    >
                      <TruncatedText
                        value={copiedScoutId === automation.scoutId ? 'Copied' : automation.scoutId}
                        monospace
                        maxWidth={96}
                      />
                    </Box>
                  </Tooltip>
                ) : (
                  <Typography variant="body2" color="text.disabled">—</Typography>
                )}
              </TableCell>
              <TableCell>
                <TruncatedText value={automation.companyName?.trim() || '—'} maxWidth={96} />
              </TableCell>
              <TableCell>
                <TagsCell
                  tags={automation.tags || []}
                  automationName={automation.name}
                  onSeeAll={() => setTagsModal({ name: automation.name, tags: automation.tags || [] })}
                />
              </TableCell>
              <TableCell>
                <TargetUrlCell
                  automation={automation}
                  copiedTargetUrl={copiedTargetUrl}
                  onCopyTargetUrl={handlers.onCopyTargetUrl}
                />
              </TableCell>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>
                <Typography variant="body2" sx={{ fontSize: '0.8125rem', color: 'text.secondary' }}>
                  {formatLastRunActivity(automation.lastRunTime)}
                </Typography>
              </TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>
                {automation.rowsExtracted || 0}
              </TableCell>
              {showJobBoardColumn ? (
                <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>
                  {automation.jobsAddedToBoard || 0}
                </TableCell>
              ) : null}
              <TableCell>
                <NextRunLabel automation={automation} />
              </TableCell>
              <TableCell>
                <ScheduleChip automation={automation} onOpen={handlers.onOpenSchedule} />
              </TableCell>
              <TableCell align="right" sx={{ pr: 1.25 }}>
                <AutomationRowActions
                  automation={automation}
                  pending={pending}
                  errors={errors}
                  copiedScoutId={copiedScoutId}
                  copiedTargetUrl={copiedTargetUrl}
                  handlers={handlers}
                  compact
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
    <AutomationTagsModal
      open={tagsModal != null}
      onClose={() => setTagsModal(null)}
      automationName={tagsModal?.name || ''}
      tags={tagsModal?.tags || []}
    />
    </>
  );
}

/** @deprecated Use StatusCell in the full-column table. */
export function HealthCell({ automation }: { automation: AutomationSummary }) {
  return <StatusCell automation={automation} />;
}
