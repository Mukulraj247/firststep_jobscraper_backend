import React, { useMemo, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogContent,
  DialogTitle,
  List,
  ListItem,
  ListItemText,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import type { ScheduleHeatmapFire, ScheduleHeatmapResponse } from '../../api/automation';
import { cardSx, FIRSTSTEP, RADIUS, tint } from '../../components/dashboard/ops/dashboardTokens';
import { formatIstYmd, istDayStripAroundToday } from '../../shared/opsTimezone';
import {
  HEATMAP_HIGH_COLOR,
  HEATMAP_HOUR_PERIODS,
  HEATMAP_LOW_COLOR,
  formatHeatmapDateChip,
  heatmapFiresForHour,
  heatmapHourAriaLabel,
  heatmapHourCellMinHeightPx,
  heatmapHourColor,
  heatmapHourLabel,
  scheduleFireLabel,
} from './scrapersPageBehavior';

export function ScheduleHeatmap({
  date,
  nowMs,
  data,
  isLoading,
  isError,
  onDateChange,
  onRetry,
}: {
  date: string;
  nowMs: number;
  data: ScheduleHeatmapResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  onDateChange: (ymd: string) => void;
  onRetry: () => void;
}) {
  const todayYmd = formatIstYmd(nowMs);
  const strip = useMemo(() => istDayStripAroundToday(nowMs), [nowMs]);
  const hours = data?.hours ?? Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0 }));
  const counts = hours.map((hour) => hour.count);
  const [openHour, setOpenHour] = useState<number | null>(null);
  const hourFires: ScheduleHeatmapFire[] =
    openHour == null ? [] : heatmapFiresForHour(data?.fires ?? [], openHour);
  const cellMinHeight = heatmapHourCellMinHeightPx();

  return (
    <Paper
      elevation={0}
      sx={[
        cardSx(),
        {
          p: { xs: 2.5, md: 3.5 },
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minHeight: { xs: 480, md: 560 },
          overflowX: 'auto',
        },
      ]}
    >
      <Stack
        direction={{ xs: 'column', lg: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'flex-start', lg: 'center' }}
        spacing={2}
        sx={{ mb: 3 }}
      >
        <Box>
          <Typography sx={{ fontWeight: 800, fontSize: { xs: '1.15rem', md: '1.35rem' }, color: FIRSTSTEP.navyDeep }}>
            {formatHeatmapDateChip(date, todayYmd) === 'Today' ? 'Today in IST' : formatHeatmapDateChip(date, todayYmd)}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, maxWidth: 560 }}>
            Four rows of six hours. Darker green is fewer fires; darker red is more.
          </Typography>
        </Box>
        <Stack
          direction="row"
          spacing={1}
          flexWrap="wrap"
          useFlexGap
          justifyContent={{ xs: 'flex-start', lg: 'flex-end' }}
        >
          {strip.map((ymd) => {
            const selected = ymd === date;
            return (
              <Chip
                key={ymd}
                clickable
                label={formatHeatmapDateChip(ymd, todayYmd)}
                onClick={() => onDateChange(ymd)}
                color={selected ? 'primary' : 'default'}
                variant={selected ? 'filled' : 'outlined'}
                sx={{
                  height: 36,
                  px: 0.5,
                  fontWeight: 700,
                  fontSize: '0.9rem',
                  borderRadius: RADIUS.pill,
                  ...(selected
                    ? { bgcolor: FIRSTSTEP.tealDark, color: '#fff' }
                    : { borderColor: FIRSTSTEP.border, color: FIRSTSTEP.navy }),
                }}
              />
            );
          })}
        </Stack>
      </Stack>

      {isError ? (
        <Stack direction="row" alignItems="center" spacing={1.5}>
          <Typography variant="body2" color="error">
            Could not load the schedule heatmap.
          </Typography>
          <Button size="small" onClick={onRetry} sx={{ fontWeight: 700 }}>
            Retry
          </Button>
        </Stack>
      ) : (
        <>
          <Box
            sx={{
              flex: 1,
              minHeight: { xs: 380, md: 440 },
              minWidth: 0,
              overflowX: 'auto',
              display: 'grid',
              gridTemplateColumns: {
                xs: 'repeat(3, minmax(0, 1fr))',
                sm: 'repeat(6, minmax(0, 1fr))',
                md: 'minmax(5.75rem, 7.25rem) repeat(6, minmax(0, 1fr))',
              },
              gridAutoRows: '1fr',
              gap: { xs: 1, md: 1.5 },
            }}
          >
            {HEATMAP_HOUR_PERIODS.map((period) => (
              <React.Fragment key={period.id}>
                <Box
                  sx={{
                    display: { xs: 'none', md: 'flex' },
                    alignItems: 'center',
                    justifyContent: 'flex-end',
                    pr: 1.5,
                    minHeight: { md: cellMinHeight },
                  }}
                >
                  <Typography
                    component="span"
                    sx={{
                      fontWeight: 800,
                      fontSize: '0.78rem',
                      letterSpacing: '0.1em',
                      textTransform: 'uppercase',
                      color: FIRSTSTEP.textMuted,
                      lineHeight: 1.2,
                    }}
                  >
                    {period.label}
                  </Typography>
                </Box>
                {Array.from({ length: 6 }, (_, offset) => {
                  const hour = period.startHour + offset;
                  const cell = hours.find((entry) => entry.hour === hour) ?? { hour, count: 0 };
                  const color = heatmapHourColor(cell.count, counts);
                  const clickable = cell.count > 0 && !isLoading;
                  return (
                    <Box
                      key={cell.hour}
                      component="button"
                      type="button"
                      disabled={!clickable}
                      aria-label={heatmapHourAriaLabel(cell.hour, cell.count)}
                      onClick={() => {
                        if (clickable) setOpenHour(cell.hour);
                      }}
                      sx={{
                        appearance: 'none',
                        border: 0,
                        m: 0,
                        width: '100%',
                        height: '100%',
                        px: 1,
                        py: { xs: 1.5, md: 2 },
                        minHeight: { xs: 80, md: cellMinHeight },
                        borderRadius: 2,
                        cursor: clickable ? 'pointer' : 'default',
                        bgcolor: isLoading ? FIRSTSTEP.border : color,
                        color: cell.count > 0 ? '#fff' : FIRSTSTEP.textMuted,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 0.75,
                        transition: 'filter 180ms ease, transform 180ms ease',
                        boxShadow: cell.count > 0 ? `inset 0 1px 0 ${tint('#ffffff', 0.18)}` : 'none',
                        '&:hover': clickable ? { filter: 'brightness(1.08)', transform: 'translateY(-2px)' } : undefined,
                        '&:focus-visible': {
                          outline: `3px solid ${FIRSTSTEP.teal}`,
                          outlineOffset: 2,
                        },
                        '&:disabled': { opacity: 1 },
                      }}
                    >
                      <Typography
                        component="span"
                        sx={{ fontSize: { xs: '0.78rem', md: '0.92rem' }, fontWeight: 700, lineHeight: 1.1, opacity: 0.95 }}
                      >
                        {heatmapHourLabel(cell.hour)}
                      </Typography>
                      <Typography
                        component="span"
                        sx={{ fontSize: { xs: '1.35rem', md: '1.85rem' }, fontWeight: 800, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}
                      >
                        {isLoading ? '—' : cell.count}
                      </Typography>
                    </Box>
                  );
                })}
              </React.Fragment>
            ))}
          </Box>
          <Stack
            direction="row"
            spacing={2}
            alignItems="center"
            aria-label="Color scale from few scheduled fires to many"
            sx={{ mt: { xs: 2.5, md: 3 } }}
          >
            <Typography
              variant="body2"
              sx={{ fontWeight: 800, color: FIRSTSTEP.navy, minWidth: 36, flexShrink: 0 }}
            >
              Few
            </Typography>
            <Box
              aria-hidden
              sx={{
                flex: 1,
                height: { xs: 16, md: 22 },
                borderRadius: 99,
                background: `linear-gradient(90deg, ${HEATMAP_LOW_COLOR}, ${HEATMAP_HIGH_COLOR})`,
                boxShadow: `inset 0 1px 0 ${tint('#ffffff', 0.22)}`,
              }}
            />
            <Typography
              variant="body2"
              sx={{ fontWeight: 800, color: FIRSTSTEP.navy, minWidth: 44, flexShrink: 0 }}
            >
              Many
            </Typography>
          </Stack>
        </>
      )}

      <Dialog open={openHour != null} onClose={() => setOpenHour(null)} fullWidth maxWidth="sm">
        <DialogTitle sx={{ fontWeight: 700 }}>
          {openHour == null
            ? 'Scheduled fires'
            : `${heatmapHourLabel(openHour)} · ${hourFires.length} scheduled`}
        </DialogTitle>
        <DialogContent>
          <List dense disablePadding>
            {hourFires.map((fire) => (
              <ListItem key={`${fire.automationId}-${fire.at}`} disableGutters>
                <ListItemText
                  primary={scheduleFireLabel(fire)}
                  primaryTypographyProps={{ fontWeight: 600 }}
                />
              </ListItem>
            ))}
          </List>
        </DialogContent>
      </Dialog>
    </Paper>
  );
}
