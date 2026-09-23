import React, { useEffect, useMemo, useState } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Box, Chip, Stack, Typography } from '@mui/material';
import type { JobSeries } from '../types';
import { DISPLAY_FONT, STITCH } from '../tokens';

const CLUSTER_COLORS = ['#0ea5e9', '#8b5cf6', '#f59e0b', '#10b981', '#f43f5e'] as const;
const TOTAL_STROKE = STITCH.primary;

function formatTick(dateKey: string, granularity: 'hour' | 'day' | 'week'): string {
  if (granularity === 'hour') {
    const m = dateKey.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2})$/);
    if (!m) return dateKey;
    const dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4]));
    return dt.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      timeZone: 'UTC',
    });
  }
  const [y, mo, d] = dateKey.split('-').map(Number);
  if (!y || !mo || !d) return dateKey;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (granularity === 'week') {
    return `W ${dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })}`;
  }
  return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

type Props = {
  series: JobSeries | null | undefined;
  loading?: boolean;
};

export function JobsOverTimeChart({ series, loading }: Props) {
  const clusterOptions = series?.byCluster ?? [];
  const clusterIdsKey = clusterOptions.map((c) => c.subscriptionId).join('|');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Keep selection in sync when analytics range / cluster set changes.
  useEffect(() => {
    setSelectedIds(clusterOptions.map((c) => c.subscriptionId));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when cluster id set changes
  }, [clusterIdsKey]);

  const allSelected =
    clusterOptions.length > 0 && selectedIds.length === clusterOptions.length;

  const toggleCluster = (id: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) {
        // Don't allow clearing every cluster — keep at least one.
        if (prev.length <= 1) return prev;
        return prev.filter((x) => x !== id);
      }
      return [...prev, id];
    });
  };

  const selectAll = () => {
    setSelectedIds(clusterOptions.map((c) => c.subscriptionId));
  };

  const { data, visibleClusters, maxY } = useMemo(() => {
    if (!series?.dates?.length) {
      return { data: [] as Record<string, string | number>[], visibleClusters: [], maxY: 0 };
    }

    const visible = series.byCluster.filter((c) => selectedIds.includes(c.subscriptionId));
    const rows = series.dates.map((date, i) => {
      let total = 0;
      const row: Record<string, string | number> = { date };
      for (const c of visible) {
        const v = c.values[i] ?? 0;
        row[c.subscriptionId] = v;
        total += v;
      }
      row.Total = visible.length === series.byCluster.length ? series.total[i] ?? total : total;
      return row;
    });
    const peak = Math.max(
      0,
      ...rows.map((r) => Number(r.Total) || 0),
      ...visible.flatMap((c) => c.values),
    );
    return { data: rows, visibleClusters: visible, maxY: peak };
  }, [series, selectedIds]);

  if (loading) {
    return (
      <Box sx={{ height: 280, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Typography sx={{ color: STITCH.muted }}>Loading chart…</Typography>
      </Box>
    );
  }

  if (!series?.dates?.length) {
    return (
      <Box sx={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Typography sx={{ color: STITCH.muted, fontSize: '0.95rem' }}>
          No job activity in this range yet. Activate clusters to start the chart.
        </Typography>
      </Box>
    );
  }

  const granularity = series.granularity || 'day';
  const nameById = new Map(visibleClusters.map((c) => [c.subscriptionId, c.name]));
  const colorById = new Map(
    clusterOptions.map((c, i) => [c.subscriptionId, CLUSTER_COLORS[i % CLUSTER_COLORS.length]]),
  );

  return (
    <Box>
      {clusterOptions.length > 0 && (
        <Stack
          direction="row"
          flexWrap="wrap"
          useFlexGap
          spacing={1}
          sx={{ mb: 2 }}
          alignItems="center"
        >
          <Typography
            sx={{
              fontSize: '0.75rem',
              fontWeight: 700,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              color: STITCH.muted,
              mr: 0.5,
            }}
          >
            Clusters
          </Typography>
          <Chip
            size="small"
            label="All"
            onClick={selectAll}
            variant={allSelected ? 'filled' : 'outlined'}
            sx={{
              fontWeight: 600,
              bgcolor: allSelected ? STITCH.primary : '#fff',
              color: allSelected ? '#fff' : STITCH.onSurface,
              borderColor: allSelected ? STITCH.primary : '#e2e8f0',
              '&:hover': {
                bgcolor: allSelected ? STITCH.primaryDark : '#f8fafc',
              },
            }}
          />
          {clusterOptions.map((c, i) => {
            const on = selectedIds.includes(c.subscriptionId);
            const color = CLUSTER_COLORS[i % CLUSTER_COLORS.length];
            return (
              <Chip
                key={c.subscriptionId}
                size="small"
                label={c.name}
                onClick={() => toggleCluster(c.subscriptionId)}
                variant={on ? 'filled' : 'outlined'}
                sx={{
                  fontWeight: 600,
                  maxWidth: 180,
                  bgcolor: on ? color : '#fff',
                  color: on ? '#fff' : STITCH.onSurface,
                  borderColor: on ? color : '#e2e8f0',
                  '&:hover': {
                    bgcolor: on ? color : '#f8fafc',
                    opacity: on ? 0.92 : 1,
                  },
                  '& .MuiChip-label': {
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  },
                }}
              />
            );
          })}
        </Stack>
      )}

      {maxY === 0 ? (
        <Box sx={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Typography sx={{ color: STITCH.muted, fontSize: '0.95rem' }}>
            No jobs for the selected cluster(s) in this window. Try another cluster or a wider
            range.
          </Typography>
        </Box>
      ) : (
        <Box
          sx={{
            width: '100%',
            height: { xs: 280, md: 340 },
            pt: 0.5,
            '& .recharts-legend-wrapper': { paddingTop: '8px !important' },
            '& .recharts-default-legend': {
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'center',
              gap: '4px 16px',
            },
            '& .recharts-legend-item-text': {
              fontSize: '12px !important',
              color: `${STITCH.onSurface} !important`,
            },
          }}
        >
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 12, right: 16, left: 4, bottom: 8 }}>
              <defs>
                <linearGradient id="jobsTotalFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={STITCH.primary} stopOpacity={0.22} />
                  <stop offset="100%" stopColor={STITCH.primary} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="4 6" stroke="#e8eef3" vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={(v) => formatTick(String(v), granularity)}
                tick={{ fontSize: 11, fill: STITCH.muted }}
                minTickGap={granularity === 'hour' ? 40 : 28}
                axisLine={{ stroke: '#e2e8f0' }}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                allowDecimals={false}
                tick={{ fontSize: 11, fill: STITCH.muted }}
                width={40}
                axisLine={false}
                tickLine={false}
                domain={[0, (dataMax: number) => Math.max(4, Math.ceil(dataMax * 1.1))]}
              />
              <Tooltip
                cursor={{ stroke: STITCH.secondary, strokeWidth: 1, strokeDasharray: '4 4' }}
                labelFormatter={(v) => formatTick(String(v), granularity)}
                formatter={(value: number, key: string) => {
                  const label = key === 'Total' ? 'Total' : nameById.get(key) || key;
                  return [value, label];
                }}
                contentStyle={{
                  borderRadius: 12,
                  border: '1px solid #e2e8f0',
                  boxShadow: '0 8px 24px rgba(15, 23, 42, 0.08)',
                  fontFamily: DISPLAY_FONT,
                  fontSize: 13,
                  padding: '10px 12px',
                }}
                itemSorter={(item) => (item.dataKey === 'Total' ? -1 : 0)}
                wrapperStyle={{ zIndex: 20, outline: 'none' }}
                allowEscapeViewBox={{ x: true, y: true }}
              />
              <Legend
                verticalAlign="bottom"
                formatter={(value) => (value === 'Total' ? 'Total' : nameById.get(value) || value)}
              />
              <Area
                type="monotone"
                dataKey="Total"
                name="Total"
                stroke={TOTAL_STROKE}
                strokeWidth={2.25}
                fill="url(#jobsTotalFill)"
                fillOpacity={1}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 0 }}
              />
              {visibleClusters.map((c) => (
                <Line
                  key={c.subscriptionId}
                  type="monotone"
                  dataKey={c.subscriptionId}
                  name={c.subscriptionId}
                  stroke={colorById.get(c.subscriptionId) || CLUSTER_COLORS[0]}
                  strokeWidth={2.25}
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 0 }}
                />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        </Box>
      )}
    </Box>
  );
}
