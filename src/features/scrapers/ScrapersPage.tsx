import React, { useCallback, useEffect, useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getScheduleHeatmap, reconfigureDailyAutomationSchedules } from '../../api/automation';
import { useGlobalInfoStore } from '../../context/globalInfo';
import { useSocketStore } from '../../context/socket';
import { FIRSTSTEP } from '../../components/dashboard/ops/dashboardTokens';
import { automationQueryKeys } from '../automations/automationQueries';
import { ScrapersHero } from './ScrapersHero';
import { ScheduleHeatmap } from './ScheduleHeatmap';
import {
  SOCKET_INVALIDATE_DEBOUNCE_MS,
  buildReconfigureMovesCsv,
  buildReconfigureMovesCsvFilename,
  buildScheduleFiresCsv,
  buildScheduleFiresCsvFilename,
  downloadTextFile,
  heatmapScheduledTotal,
  reconfigureApiMovesToCsvRows,
} from './scrapersPageBehavior';
import { formatIstYmd } from '../../shared/opsTimezone';

export function ScrapersPage() {
  const queryClient = useQueryClient();
  const { notify } = useGlobalInfoStore();
  const { queueSocket } = useSocketStore();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [heatmapDate, setHeatmapDate] = useState(() => formatIstYmd(Date.now()));
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);
  const [isReconfiguring, setIsReconfiguring] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const heatmapQuery = useQuery({
    queryKey: ['schedule-heatmap', heatmapDate],
    queryFn: () => getScheduleHeatmap(heatmapDate),
  });

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!queueSocket) return;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      window.clearTimeout(timeout);
      timeout = window.setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: ['schedule-heatmap'] });
      }, SOCKET_INVALIDATE_DEBOUNCE_MS);
    };
    queueSocket.on('run-started', refresh);
    queueSocket.on('run-completed', refresh);
    return () => {
      window.clearTimeout(timeout);
      queueSocket.off('run-started', refresh);
      queueSocket.off('run-completed', refresh);
    };
  }, [queueSocket, queryClient]);

  const handleManualRefresh = useCallback(async () => {
    setIsManualRefreshing(true);
    try {
      await heatmapQuery.refetch();
    } finally {
      setIsManualRefreshing(false);
    }
  }, [heatmapQuery]);

  const handleDownloadSchedules = useCallback(() => {
    const fires = heatmapQuery.data?.fires ?? [];
    downloadTextFile(
      buildScheduleFiresCsv(fires),
      buildScheduleFiresCsvFilename(heatmapDate),
      'text/csv;charset=utf-8;',
    );
  }, [heatmapDate, heatmapQuery.data?.fires]);

  const handleReconfigure = useCallback(async () => {
    setConfirmOpen(false);
    setIsReconfiguring(true);
    try {
      const result = await reconfigureDailyAutomationSchedules();
      downloadTextFile(
        buildReconfigureMovesCsv(reconfigureApiMovesToCsvRows(result.moves || [])),
        buildReconfigureMovesCsvFilename(heatmapDate),
        'text/csv;charset=utf-8;',
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['schedule-heatmap'] }),
        queryClient.invalidateQueries({ queryKey: automationQueryKeys.all }),
      ]);
      notify(
        'success',
        result.movedCount
          ? `Moved ${result.movedCount} every-day scraper${result.movedCount === 1 ? '' : 's'}`
          : 'No every-day scrapers needed to move',
      );
    } catch (error: any) {
      notify('error', error?.response?.data?.error || 'Failed to reconfigure daily schedules');
    } finally {
      setIsReconfiguring(false);
    }
  }, [heatmapDate, notify, queryClient]);

  const scheduledCount = heatmapScheduledTotal(heatmapQuery.data?.hours ?? []);

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: '100%',
        overflow: 'visible',
        gap: { xs: 2, md: 2.5 },
        p: { xs: 2, md: 3 },
        bgcolor: (muiTheme) => (muiTheme.palette.mode === 'dark' ? '#000' : FIRSTSTEP.surface),
      }}
    >
      <ScrapersHero
        scheduledCount={scheduledCount}
        isRefreshing={isManualRefreshing}
        isLoading={heatmapQuery.isLoading}
        isReconfiguring={isReconfiguring}
        canDownloadSchedules={!heatmapQuery.isLoading && !heatmapQuery.isError}
        onRefresh={() => {
          void handleManualRefresh();
        }}
        onDownloadSchedules={handleDownloadSchedules}
        onReconfigure={() => setConfirmOpen(true)}
      />

      <ScheduleHeatmap
        date={heatmapDate}
        nowMs={nowMs}
        data={heatmapQuery.data}
        isLoading={heatmapQuery.isLoading}
        isError={heatmapQuery.isError}
        onDateChange={setHeatmapDate}
        onRetry={() => {
          void heatmapQuery.refetch();
        }}
      />

      <Dialog open={confirmOpen} onClose={() => !isReconfiguring && setConfirmOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Reconfigure every-day scrapers?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            This only moves Every-day scrapers. Hourly schedules stay put. After it runs, a CSV of
            what moved downloads automatically.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)} disabled={isReconfiguring}>
            Cancel
          </Button>
          <Button variant="contained" onClick={() => void handleReconfigure()} disabled={isReconfiguring}>
            Reconfigure
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
