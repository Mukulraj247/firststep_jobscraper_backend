import React from 'react';
import { Box } from '@mui/material';
import BoltOutlinedIcon from '@mui/icons-material/BoltOutlined';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import PlayCircleOutlineIcon from '@mui/icons-material/PlayCircleOutline';
import TableChartOutlinedIcon from '@mui/icons-material/TableChartOutlined';
import type { DashboardAutomationsSummary } from '../../api/automation';
import { StatCard } from '../../components/dashboard/ops/StatCard';
import { FIRSTSTEP, METRIC_COLORS } from '../../components/dashboard/ops/dashboardTokens';

export function AutomationStats({
  summary,
}: {
  summary: DashboardAutomationsSummary | null;
}) {
  const paused = summary?.pausedScheduleCount ?? 0;

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 120px), 1fr))',
        gap: 1.5,
      }}
    >
      <StatCard
        label="Total automations"
        value={summary?.totalAutomations ?? 0}
        hint="All scrapers in this account"
        color={METRIC_COLORS.runs}
        icon={<PlayCircleOutlineIcon />}
        delay={0}
      />
      <StatCard
        label="Rows from latest runs"
        value={summary?.rowsExtractedTotal ?? 0}
        hint="Sum of latest-run extracted rows"
        color={METRIC_COLORS.rows}
        icon={<TableChartOutlinedIcon />}
        delay={40}
      />
      <StatCard
        label="Successful latest runs"
        value={summary?.successfulCount ?? 0}
        hint="Automations whose latest run succeeded"
        color={METRIC_COLORS.passed}
        icon={<CheckCircleOutlineIcon />}
        delay={80}
      />
      <StatCard
        label="Failed latest runs"
        value={summary?.failedCount ?? 0}
        hint="Automations whose latest run failed"
        color={METRIC_COLORS.failed}
        icon={<ErrorOutlineIcon />}
        delay={120}
      />
      <StatCard
        label="Scheduled active"
        value={summary?.activeScheduledCount ?? 0}
        hint={paused > 0 ? `${paused} paused` : 'Recurring schedules currently on'}
        color={FIRSTSTEP.teal}
        icon={<BoltOutlinedIcon />}
        delay={160}
      />
    </Box>
  );
}
