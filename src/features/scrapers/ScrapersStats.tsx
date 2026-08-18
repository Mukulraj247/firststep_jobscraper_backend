import React from 'react';
import { Box } from '@mui/material';
import BoltOutlinedIcon from '@mui/icons-material/BoltOutlined';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import PauseCircleOutlineIcon from '@mui/icons-material/PauseCircleOutline';
import PlayCircleOutlineIcon from '@mui/icons-material/PlayCircleOutline';
import type { RecordingsSummary } from '../../types/robotList';
import { StatCard } from '../../components/dashboard/ops/StatCard';
import { FIRSTSTEP, METRIC_COLORS } from '../../components/dashboard/ops/dashboardTokens';

export function ScrapersStats({ summary }: { summary: RecordingsSummary | null | undefined }) {
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: 2,
      }}
    >
      <StatCard
        label="Total scrapers"
        value={summary?.total ?? 0}
        hint="All scrapers in this account"
        color={METRIC_COLORS.runs}
        icon={<PlayCircleOutlineIcon />}
        delay={0}
      />
      <StatCard
        label="Succeeded latest runs"
        value={summary?.succeeded ?? 0}
        hint="Scrapers whose latest run succeeded"
        color={METRIC_COLORS.passed}
        icon={<CheckCircleOutlineIcon />}
        delay={40}
      />
      <StatCard
        label="Failed latest runs"
        value={summary?.failed ?? 0}
        hint="Scrapers whose latest run failed"
        color={METRIC_COLORS.failed}
        icon={<ErrorOutlineIcon />}
        delay={80}
      />
      <StatCard
        label="Scheduled active"
        value={summary?.scheduled ?? 0}
        hint={
          summary && summary.idle > 0
            ? `${summary.idle} idle or never run`
            : 'Recurring schedules currently on'
        }
        color={FIRSTSTEP.teal}
        icon={<BoltOutlinedIcon />}
        delay={120}
      />
      <StatCard
        label="Idle scrapers"
        value={summary?.idle ?? 0}
        hint="No recent run activity"
        color={METRIC_COLORS.jobs}
        icon={<PauseCircleOutlineIcon />}
        delay={160}
      />
    </Box>
  );
}
