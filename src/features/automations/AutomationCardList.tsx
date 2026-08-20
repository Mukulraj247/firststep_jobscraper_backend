import React, { useState } from 'react';
import { Box, Collapse, Paper, Stack, Typography } from '@mui/material';
import type { AutomationSummary } from '../../api/automation';
import { cardSx, FIRSTSTEP } from '../../components/dashboard/ops/dashboardTokens';
import {
  detailsToggleAriaLabel,
  mobileCardDefinitionItems,
  type PendingActions,
  type RowActionErrors,
  workspaceNoLiftHoverSx,
} from './automationsPageBehavior';
import {
  AutomationDetailsPanel,
  AutomationRowActions,
  type AutomationRowHandlers,
} from './AutomationRowActions';
import { HealthCell, NextRunLabel, ScheduleChip } from './AutomationTable';

export function AutomationCardList({
  automations,
  pending,
  errors,
  copiedScoutId,
  copiedTargetUrl,
  handlers,
  showJobBoard = false,
}: {
  automations: AutomationSummary[];
  pending: PendingActions;
  errors: RowActionErrors;
  copiedScoutId: string | null;
  copiedTargetUrl: string | null;
  handlers: AutomationRowHandlers;
  showJobBoard?: boolean;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <Stack spacing={1.5} sx={{ p: 1.5 }}>
      {automations.map((automation) => {
        const open = expandedId === automation.id;
        const meta = mobileCardDefinitionItems({
          ...automation,
          showJobBoard,
          jobsAddedToBoard: automation.jobsAddedToBoard,
        });
        return (
          <Paper
            key={automation.id}
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
                <Typography sx={{ fontWeight: 700, minWidth: 0 }} noWrap>
                  {automation.name}
                </Typography>
                <HealthCell automation={automation} />
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
                    <ScheduleChip automation={automation} onOpen={handlers.onOpenSchedule} />
                  </Box>
                </Box>
                <Box sx={{ minWidth: 0, m: 0 }}>
                  <Typography component="dt" variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
                    Next run
                  </Typography>
                  <Box component="dd" sx={{ m: 0 }}>
                    <NextRunLabel automation={automation} />
                  </Box>
                </Box>
              </Box>

              <Box
                component="button"
                type="button"
                onClick={() => setExpandedId(open ? null : automation.id)}
                aria-label={detailsToggleAriaLabel(open, automation.name)}
                aria-expanded={open}
                sx={{
                  border: 0,
                  background: 'none',
                  p: 0,
                  minHeight: 44,
                  display: 'inline-flex',
                  alignItems: 'center',
                  textAlign: 'left',
                  cursor: 'pointer',
                  color: FIRSTSTEP.tealDark,
                  fontWeight: 700,
                  fontSize: 13,
                  fontFamily: 'inherit',
                  '&:focus-visible': {
                    outline: '2px solid',
                    outlineColor: FIRSTSTEP.teal,
                    outlineOffset: 2,
                  },
                }}
              >
                {open ? 'Hide details' : 'Show details'}
              </Box>
              <Collapse in={open} unmountOnExit>
                <AutomationDetailsPanel
                  automation={automation}
                  onCopyScoutId={handlers.onCopyScoutId}
                  onCopyTargetUrl={handlers.onCopyTargetUrl}
                  copiedScoutId={copiedScoutId}
                  copiedTargetUrl={copiedTargetUrl}
                />
              </Collapse>

              <Box component="footer">
                <AutomationRowActions
                  automation={automation}
                  pending={pending}
                  errors={errors}
                  copiedScoutId={copiedScoutId}
                  copiedTargetUrl={copiedTargetUrl}
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
