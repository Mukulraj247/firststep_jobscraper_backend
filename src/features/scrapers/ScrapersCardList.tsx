import React from 'react';
import { Box, Chip, Paper, Stack, Typography } from '@mui/material';
import { cardSx } from '../../components/dashboard/ops/dashboardTokens';
import { workspaceNoLiftHoverSx } from '../automations/automationsPageBehavior';
import type { RobotListSummary } from '../../types/robotList';
import {
  TYPE_LABELS,
  formatScraperLastRunRelative,
  formatScraperUpdatedAt,
  mobileCardDefinitionItems,
  scraperScheduleChipColor,
  scraperScheduleLabel,
  scraperScheduleState,
  scraperStatusColor,
  scraperStatusLabel,
  scheduleChipSx,
} from './scrapersPageBehavior';
import { ScrapersRowActions, type ScrapersRowHandlers } from './ScrapersRowActions';

export function ScrapersCardList({
  rows,
  handlers,
}: {
  rows: RobotListSummary[];
  handlers: ScrapersRowHandlers;
}) {
  return (
    <Stack spacing={1.5} sx={{ p: 1.5 }}>
      {rows.map((row) => {
        const meta = mobileCardDefinitionItems(row);
        const scheduleState = scraperScheduleState(row.schedule);
        return (
          <Paper
            key={row.id}
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
                    {row.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap>
                    {formatScraperUpdatedAt(row.updatedAt)}
                  </Typography>
                </Box>
                <Chip
                  size="small"
                  color={scraperStatusColor(row.lastRun)}
                  label={scraperStatusLabel(row.lastRun)}
                  sx={{ fontWeight: 700, height: 22, fontSize: '0.6875rem' }}
                />
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
                {meta.map((item) => (
                  <Box key={item.term} sx={{ minWidth: 0, m: 0 }}>
                    <Typography component="dt" variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
                      {item.term}
                    </Typography>
                    <Typography component="dd" variant="body2" sx={{ m: 0 }} noWrap>
                      {item.value}
                    </Typography>
                  </Box>
                ))}
                <Box sx={{ minWidth: 0, m: 0 }}>
                  <Typography component="dt" variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
                    Schedule
                  </Typography>
                  <Box component="dd" sx={{ m: 0 }}>
                    <Chip
                      size="small"
                      variant={scheduleState === 'active' ? 'filled' : 'outlined'}
                      color={scraperScheduleChipColor(scheduleState)}
                      label={scraperScheduleLabel(row.schedule)}
                      onClick={() => handlers.onSchedule(row.id, row.name, row.params || [])}
                      sx={[scheduleChipSx(scheduleState), { cursor: 'pointer' }]}
                    />
                  </Box>
                </Box>
                <Box sx={{ minWidth: 0, m: 0 }}>
                  <Typography component="dt" variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
                    Type
                  </Typography>
                  <Typography component="dd" variant="body2" sx={{ m: 0 }}>
                    {TYPE_LABELS[row.type] || row.type}
                  </Typography>
                </Box>
              </Box>

              <Box component="footer">
                <ScrapersRowActions row={row} handlers={handlers} />
              </Box>
            </Stack>
          </Paper>
        );
      })}
    </Stack>
  );
}
