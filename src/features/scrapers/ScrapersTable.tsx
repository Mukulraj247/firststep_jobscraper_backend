import React from 'react';
import {
  Chip,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { RobotListSummary } from '../../types/robotList';
import {
  DESKTOP_TABLE_MIN_WIDTH,
  DESKTOP_TABLE_ROW_DIVIDER,
  DESKTOP_TABLE_ROW_HEIGHT_PX,
  DESKTOP_TABLE_ROW_HOVER_BG,
  DESKTOP_TABLE_SIZE,
  DESKTOP_TABLE_STATUS_MARKER_PX,
  SCRAPERS_TABLE_CAPTION,
  TYPE_LABELS,
  formatScraperLastRunAbsolute,
  formatScraperLastRunRelative,
  formatScraperUpdatedAt,
  scheduleChipSx,
  scraperLastRunTimestamp,
  scraperScheduleChipColor,
  scraperScheduleLabel,
  scraperScheduleState,
  scraperStatusColor,
  scraperStatusLabel,
  scraperStatusMarker,
  scrapersTableScrollSx,
  scheduleChipAriaLabel,
  stickyHeaderCellSx,
  stickyNameCellSx,
  typeChipSx,
} from './scrapersPageBehavior';
import { ScrapersRowActions, type ScrapersRowHandlers } from './ScrapersRowActions';

function StatusChip({ row }: { row: RobotListSummary }) {
  return (
    <Chip
      size="small"
      color={scraperStatusColor(row.lastRun)}
      label={scraperStatusLabel(row.lastRun)}
      sx={{ fontWeight: 700, height: 22, fontSize: '0.6875rem' }}
    />
  );
}

function ScheduleChip({ row, onOpen }: { row: RobotListSummary; onOpen: () => void }) {
  const state = scraperScheduleState(row.schedule);
  return (
    <Chip
      size="small"
      variant={state === 'active' ? 'filled' : 'outlined'}
      color={scraperScheduleChipColor(state)}
      aria-label={scheduleChipAriaLabel(state, row.name)}
      label={scraperScheduleLabel(row.schedule)}
      onClick={onOpen}
      sx={[scheduleChipSx(state), { cursor: 'pointer' }]}
    />
  );
}

export function ScrapersTable({
  rows,
  handlers,
}: {
  rows: RobotListSummary[];
  handlers: ScrapersRowHandlers;
}) {
  const { t } = useTranslation();

  return (
    <TableContainer sx={scrapersTableScrollSx()}>
      <Table
        stickyHeader
        size={DESKTOP_TABLE_SIZE}
        sx={{
          minWidth: DESKTOP_TABLE_MIN_WIDTH,
          tableLayout: 'fixed',
          borderCollapse: 'separate',
          borderSpacing: 0,
          '& caption': {
            position: 'absolute',
            width: 1,
            height: 1,
            overflow: 'hidden',
            clip: 'rect(0 0 0 0)',
          },
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
        <caption>{SCRAPERS_TABLE_CAPTION}</caption>
        <colgroup>
          <col style={{ width: '24%' }} />
          <col style={{ width: '12%' }} />
          <col style={{ width: '14%' }} />
          <col style={{ width: '18%' }} />
          <col style={{ width: '16%' }} />
          <col style={{ width: '16%' }} />
        </colgroup>
        <TableHead>
          <TableRow>
            <TableCell sx={[stickyHeaderCellSx(), stickyNameCellSx(true)]}>
              {t('recordingtable.name')}
            </TableCell>
            <TableCell sx={stickyHeaderCellSx()}>{t('recordingtable.type')}</TableCell>
            <TableCell sx={stickyHeaderCellSx()}>{t('recordingtable.status')}</TableCell>
            <TableCell sx={stickyHeaderCellSx()}>{t('recordingtable.schedule')}</TableCell>
            <TableCell sx={stickyHeaderCellSx()}>{t('recordingtable.last_run')}</TableCell>
            <TableCell align="right" sx={stickyHeaderCellSx()}>
              {t('recordingtable.actions')}
            </TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row, index) => {
            const lastRunTs = scraperLastRunTimestamp(row);
            return (
              <TableRow
                key={row.id}
                hover
                sx={{
                  minHeight: DESKTOP_TABLE_ROW_HEIGHT_PX,
                  bgcolor: index % 2 === 1 ? 'rgba(2, 51, 69, 0.015)' : 'background.paper',
                  borderLeft: `${DESKTOP_TABLE_STATUS_MARKER_PX}px solid ${scraperStatusMarker(row.lastRun)}`,
                  transition: 'background-color 120ms ease',
                  '&.MuiTableRow-hover:hover': {
                    bgcolor: DESKTOP_TABLE_ROW_HOVER_BG,
                    boxShadow: 'none',
                  },
                  '& .MuiTableCell-root:first-of-type': stickyNameCellSx(false),
                  '&:hover .MuiTableCell-root:first-of-type': {
                    bgcolor: DESKTOP_TABLE_ROW_HOVER_BG,
                  },
                }}
              >
                <TableCell>
                  <Typography variant="body2" sx={{ fontWeight: 700 }} noWrap>
                    {row.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap>
                    {formatScraperUpdatedAt(row.updatedAt)}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    variant="outlined"
                    label={TYPE_LABELS[row.type] || row.type}
                    sx={typeChipSx()}
                  />
                </TableCell>
                <TableCell>
                  <StatusChip row={row} />
                </TableCell>
                <TableCell>
                  <ScheduleChip
                    row={row}
                    onOpen={() => handlers.onSchedule(row.id, row.name, row.params || [])}
                  />
                </TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>
                  <Tooltip title={formatScraperLastRunAbsolute(lastRunTs)} arrow>
                    <Typography
                      variant="body2"
                      sx={{ fontSize: '0.8125rem', color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}
                    >
                      {formatScraperLastRunRelative(lastRunTs)}
                    </Typography>
                  </Tooltip>
                </TableCell>
                <TableCell align="right" sx={{ pr: 1.25 }}>
                  <Stack direction="row" justifyContent="flex-end" alignItems="center" spacing={0.25}>
                    <ScrapersRowActions row={row} handlers={handlers} compact />
                  </Stack>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
