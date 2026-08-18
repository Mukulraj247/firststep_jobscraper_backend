import React from 'react';
import { Box, Paper, Stack, Typography } from '@mui/material';
import ShowChartIcon from '@mui/icons-material/ShowChart';
import { cardSx, fadeUpSx, FIRSTSTEP, tint } from './dashboardTokens';

/** SVG coordinate space — wider plot for readable x-axis labels. */
const VIEW_W = 480;
/** Left gutter: axis title | tick labels | gap | plot line */
const Y_TITLE_X = 6;
const Y_TICK_GAP = 8;
const Y_GUTTER = 44;
const PLOT_LEFT = Y_GUTTER + 4;
const RIGHT_PAD = 8;
const TOP_PAD = 6;
const X_AXIS_GAP = 8;
const X_TICK_OFFSET = 16;
const X_TITLE_OFFSET = 14;
const Y_TICK_FONT = 9;
const X_TICK_FONT = 8;
const AXIS_TITLE_FONT = 9;
const DEFAULT_PLOT_HEIGHT = 168;

const evenlySpacedIndexes = (length: number, count: number) => {
  if (length <= 1) return [0];
  const slots = Math.min(count, length);
  const indexes = new Set<number>();
  for (let i = 0; i < slots; i += 1) {
    indexes.add(Math.round((i / Math.max(1, slots - 1)) * (length - 1)));
  }
  return Array.from(indexes).sort((a, b) => a - b);
};

/** Short labels that fit mini chart width — avoids stacked/overlapping x ticks. */
const compactXLabel = (
  timestamp: number,
  spanMs: number,
  tickIndex: number,
  totalTicks: number,
  rangeStart: number,
  rangeEnd: number,
  useShortLabels: boolean,
) => {
  const date = new Date(timestamp);
  const sameDay = new Date(rangeStart).toDateString() === new Date(rangeEnd).toDateString();

  if (useShortLabels || spanMs < 10 * 60 * 1000) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  if (sameDay) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  const isEdge = tickIndex === 0 || tickIndex === totalTicks - 1;
  if (isEdge) {
    return date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const buildXAxisTicks = (
  points: ChartPoint[],
  timeSpanMs: number,
  plotWidth: number,
) => {
  const shortLabelWidth = 34;
  const longLabelWidth = 68;
  const maxTicksShort = Math.max(2, Math.floor(plotWidth / shortLabelWidth));
  const maxTicksLong = Math.max(2, Math.floor(plotWidth / longLabelWidth));

  const showAllBuckets = points.length <= 8 && points.length <= maxTicksShort;
  const useShortLabels = showAllBuckets || maxTicksShort >= 4;

  const tickCount = showAllBuckets
    ? points.length
    : Math.min(maxTicksLong, 4, points.length);

  const indexes = showAllBuckets
    ? points.map((_, index) => index)
    : evenlySpacedIndexes(points.length, tickCount);

  return indexes.map((index, tickIndex) => ({
    index,
    label: compactXLabel(
      points[index].t,
      timeSpanMs,
      tickIndex,
      indexes.length,
      points[0].t,
      points[points.length - 1].t,
      useShortLabels,
    ),
  }));
};

type ChartPoint = { t: number; v: number };

export type MiniChartProps = {
  title: string;
  valueLabel: string;
  points: ChartPoint[];
  color?: string;
  height?: number;
  delay?: number;
  yAxisLabel?: string;
  xAxisLabel?: string;
  yMax?: number;
  formatYTick?: (value: number) => string;
  formatXTick?: (timestamp: number, spanMs: number) => string;
};

const defaultFormatYTick = (value: number) => {
  if (!Number.isFinite(value)) return '—';
  if (Number.isInteger(value)) return String(value);
  if (value >= 100) return value.toFixed(0);
  if (value >= 10) return value.toFixed(1);
  return value.toFixed(2);
};

const defaultFormatXTick = (timestamp: number, spanMs: number) => {
  const date = new Date(timestamp);
  if (spanMs >= 20 * 60 * 60 * 1000) {
    return date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const computeYMax = (values: number[], fixedMax?: number) => {
  if (fixedMax != null && fixedMax > 0) return fixedMax;
  const dataMax = Math.max(...values, 0);
  if (dataMax <= 0) return 1;
  if (dataMax <= 1) return 1;
  if (dataMax <= 5) return Math.max(1, Math.ceil(dataMax));
  const padded = dataMax * 1.1;
  const magnitude = 10 ** Math.floor(Math.log10(padded));
  return Math.ceil(padded / magnitude) * magnitude;
};

const buildYTicks = (max: number, fixedMax?: number) => {
  if (fixedMax === 100) return [0, 50, 100];
  if (max <= 1) return [0, 0.5, 1];
  if (max <= 4) return [0, Math.ceil(max / 2), max];
  const mid = max / 2;
  const roundedMid = max <= 10 ? Math.round(mid) : Math.round(mid / 5) * 5;
  return [0, roundedMid, max];
};

export const MiniChart = ({
  title,
  valueLabel,
  points,
  color = FIRSTSTEP.tealDark,
  height = DEFAULT_PLOT_HEIGHT,
  delay = 0,
  yAxisLabel = 'Value',
  xAxisLabel = 'Time',
  yMax: yMaxProp,
  formatYTick = defaultFormatYTick,
  formatXTick = defaultFormatXTick,
}: MiniChartProps) => {
  const gradientId = React.useId().replace(/:/g, '');
  const plotHeight = height;
  const plotTop = TOP_PAD;
  const plotBottom = plotTop + plotHeight;
  const xAxisY = plotBottom + X_AXIS_GAP;
  const xTicksY = xAxisY + X_TICK_OFFSET;
  const xTitleY = xTicksY + X_TITLE_OFFSET;
  const svgHeight = xTitleY + 10;
  const plotWidth = VIEW_W - PLOT_LEFT - RIGHT_PAD;

  const header = (trailing: React.ReactNode) => (
    <Stack direction="row" justifyContent="space-between" alignItems="baseline" mb={1.25}>
      <Box sx={{ minWidth: 0 }}>
        <Typography
          variant="caption"
          sx={{ color: 'text.secondary', fontWeight: 700, letterSpacing: '0.06em', display: 'block' }}
        >
          {title}
        </Typography>
        <Typography variant="caption" sx={{ color: FIRSTSTEP.textMuted, display: 'block', mt: 0.25 }}>
          {yAxisLabel} · {xAxisLabel}
        </Typography>
      </Box>
      {trailing}
    </Stack>
  );

  if (!points?.length) {
    return (
      <Paper elevation={0} sx={[cardSx(), fadeUpSx(delay), { p: 2, minWidth: 0 }]}>
        {header(
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            No samples
          </Typography>
        )}
        <Stack
          alignItems="center"
          justifyContent="center"
          spacing={0.75}
          sx={{
            height: svgHeight,
            borderRadius: '12px',
            border: '1px dashed',
            borderColor: (theme) =>
              theme.palette.mode === 'dark' ? 'rgba(79, 179, 169, 0.24)' : tint(FIRSTSTEP.teal, 0.34),
            bgcolor: tint(FIRSTSTEP.teal, 0.05),
          }}
        >
          <ShowChartIcon sx={{ fontSize: 22, color: tint(FIRSTSTEP.tealDark, 0.55) }} />
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            Waiting for data…
          </Typography>
        </Stack>
      </Paper>
    );
  }

  const vals = points.map((p) => p.v);
  const yMax = computeYMax(vals, yMaxProp);
  const yTicks = buildYTicks(yMax, yMaxProp);
  const timeSpanMs = Math.max(1, points[points.length - 1].t - points[0].t);
  const xAxisTicks = buildXAxisTicks(points, timeSpanMs, plotWidth);

  const coords = points.map((p, i) => ({
    x: PLOT_LEFT + (i / Math.max(1, points.length - 1)) * plotWidth,
    y: plotBottom - (p.v / yMax) * plotHeight,
  }));

  const line = coords
    .map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`)
    .join(' ');
  const last = coords[coords.length - 1];
  const first = coords[0];
  const area = `${line} L${last.x.toFixed(1)},${plotBottom} L${first.x.toFixed(1)},${plotBottom} Z`;
  const clipId = `${gradientId}-clip`;

  const ariaSummary = `${title}: ${valueLabel}. ${yAxisLabel} from ${formatYTick(yTicks[0])} to ${formatYTick(
    yTicks[yTicks.length - 1],
  )} across ${formatXTick(points[0].t, timeSpanMs)} to ${formatXTick(points[points.length - 1].t, timeSpanMs)}.`;

  return (
    <Paper elevation={0} sx={[cardSx(), fadeUpSx(delay), { p: 2, minWidth: 0 }]}>
      {header(
        <Typography
          variant="subtitle2"
          sx={{ color, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}
        >
          {valueLabel}
        </Typography>
      )}
      <Box
        sx={{
          position: 'relative',
          borderRadius: '14px',
          border: '1px solid',
          borderColor: tint(FIRSTSTEP.teal, 0.14),
          bgcolor: tint(FIRSTSTEP.teal, 0.035),
          overflow: 'visible',
          px: 0.5,
          pt: 0.5,
          pb: 0.75,
        }}
      >
        <svg
          width="100%"
          viewBox={`0 0 ${VIEW_W} ${svgHeight}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={ariaSummary}
          style={{ height: svgHeight, display: 'block', overflow: 'visible' }}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.34} />
              <stop offset="100%" stopColor={color} stopOpacity={0.03} />
            </linearGradient>
            <clipPath id={clipId}>
              <rect x={PLOT_LEFT} y={plotTop} width={plotWidth} height={plotHeight} rx={8} />
            </clipPath>
          </defs>

          <rect
            x={PLOT_LEFT}
            y={plotTop}
            width={plotWidth}
            height={plotHeight}
            rx={8}
            fill="rgba(255, 255, 255, 0.62)"
          />

          {yTicks.map((tick) => {
            const y = plotBottom - (tick / yMax) * plotHeight;
            return (
              <g key={`y-${tick}`}>
                <line
                  x1={PLOT_LEFT}
                  x2={VIEW_W - RIGHT_PAD}
                  y1={y}
                  y2={y}
                  stroke={tint(FIRSTSTEP.navy, tick === 0 ? 0.12 : 0.06)}
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
                <line
                  x1={PLOT_LEFT - 3}
                  x2={PLOT_LEFT}
                  y1={y}
                  y2={y}
                  stroke={tint(FIRSTSTEP.navy, 0.22)}
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
                <text
                  x={PLOT_LEFT - Y_TICK_GAP}
                  y={y}
                  textAnchor="end"
                  dominantBaseline="middle"
                  fontSize={Y_TICK_FONT}
                  fontWeight="500"
                  fill={FIRSTSTEP.navy}
                  fontFamily="inherit"
                >
                  {formatYTick(tick)}
                </text>
              </g>
            );
          })}

          <line
            x1={PLOT_LEFT}
            x2={PLOT_LEFT}
            y1={plotTop}
            y2={plotBottom}
            stroke={tint(FIRSTSTEP.navy, 0.2)}
            strokeWidth={1.25}
            vectorEffect="non-scaling-stroke"
          />
          <line
            x1={PLOT_LEFT}
            x2={VIEW_W - RIGHT_PAD}
            y1={xAxisY}
            y2={xAxisY}
            stroke={tint(FIRSTSTEP.navy, 0.2)}
            strokeWidth={1.25}
            vectorEffect="non-scaling-stroke"
          />

          {xAxisTicks.map(({ index: pointIndex }) => {
            const x = coords[pointIndex]?.x ?? PLOT_LEFT;
            return (
              <line
                key={`x-grid-${pointIndex}`}
                x1={x}
                x2={x}
                y1={plotTop}
                y2={plotBottom}
                stroke={tint(FIRSTSTEP.navy, 0.05)}
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            );
          })}

          <g clipPath={`url(#${clipId})`}>
            <path d={area} fill={`url(#${gradientId})`} />
            <path
              d={line}
              fill="none"
              stroke={color}
              strokeWidth={2.2}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </g>

          <circle
            cx={last.x}
            cy={last.y}
            r={4}
            fill={color}
            stroke={FIRSTSTEP.white}
            strokeWidth={2}
          />

          <text
            x={Y_TITLE_X}
            y={(plotTop + plotBottom) / 2}
            textAnchor="middle"
            fontSize={AXIS_TITLE_FONT}
            fontWeight="600"
            fill={FIRSTSTEP.tealDark}
            fontFamily="inherit"
            transform={`rotate(-90 ${Y_TITLE_X} ${(plotTop + plotBottom) / 2})`}
          >
            {yAxisLabel}
          </text>

          {xAxisTicks.map(({ index: pointIndex, label }) => {
            const x = coords[pointIndex]?.x ?? PLOT_LEFT;
            const anchor =
              pointIndex === 0
                ? 'start'
                : pointIndex === points.length - 1
                  ? 'end'
                  : 'middle';
            return (
              <g key={`x-label-${pointIndex}`}>
                <line
                  x1={x}
                  x2={x}
                  y1={xAxisY}
                  y2={xAxisY + 4}
                  stroke={tint(FIRSTSTEP.navy, 0.28)}
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
                <text
                  x={x}
                  y={xTicksY}
                  textAnchor={anchor}
                  fontSize={X_TICK_FONT}
                  fontWeight="500"
                  fill={FIRSTSTEP.navy}
                  fontFamily="inherit"
                >
                  {label}
                </text>
              </g>
            );
          })}

          <text
            x={(PLOT_LEFT + VIEW_W - RIGHT_PAD) / 2}
            y={xTitleY}
            textAnchor="middle"
            fontSize={AXIS_TITLE_FONT}
            fontWeight="600"
            fill={FIRSTSTEP.tealDark}
            fontFamily="inherit"
          >
            {xAxisLabel}
          </text>
        </svg>
      </Box>
    </Paper>
  );
};
