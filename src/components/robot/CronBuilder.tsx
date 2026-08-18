import React, { useState, useEffect, useMemo } from 'react';
import {
  Box,
  Typography,
  MenuItem,
  Select,
  FormControl,
  InputLabel,
  TextField,
  Switch,
  FormControlLabel,
  Tooltip,
  useTheme,
  alpha,
} from '@mui/material';
import { InfoOutlined } from '@mui/icons-material';
import { validMomentTimezones } from '../../constants/const';
import {
  buildCron,
  validateCron,
  parseCronToFields,
  computeNextRuns,
  formatNextRun,
} from '../../utils/cronBuilder';

export interface CronBuilderValue {
  cron: string;
  timezone: string;
}

interface CronBuilderProps {
  cron?: string;
  timezone?: string;
  /** @deprecated Pass cron and timezone as primitive props instead. */
  value?: Partial<CronBuilderValue>;
  onChange: (value: CronBuilderValue) => void;
}

export function shouldNotifyCronBuilderChange(
  nextCron: string,
  nextTimezone: string,
  currentCron?: string,
  currentTimezone?: string,
): boolean {
  return nextCron !== currentCron || nextTimezone !== currentTimezone;
}

export interface CronBuilderExternalPropsInput {
  generatedCron: string;
  internalTimezone: string;
  propCron?: string;
  propTimezone?: string;
  lastSyncedCron?: string;
  lastSyncedTimezone?: string;
}

export interface CronBuilderExternalPropsResult {
  generatedCron: string;
  internalTimezone: string;
  lastSyncedCron?: string;
  lastSyncedTimezone?: string;
  notify: CronBuilderValue | null;
}

export function applyCronBuilderExternalProps(
  input: CronBuilderExternalPropsInput,
): CronBuilderExternalPropsResult {
  const propsChanged = shouldNotifyCronBuilderChange(
    input.propCron ?? '',
    input.propTimezone ?? '',
    input.lastSyncedCron ?? '',
    input.lastSyncedTimezone ?? '',
  );

  if (propsChanged) {
    return {
      generatedCron: input.propCron ?? input.generatedCron,
      internalTimezone: input.propTimezone ?? input.internalTimezone,
      lastSyncedCron: input.propCron,
      lastSyncedTimezone: input.propTimezone,
      notify: null,
    };
  }

  if (
    shouldNotifyCronBuilderChange(
      input.generatedCron,
      input.internalTimezone,
      input.propCron,
      input.propTimezone,
    )
  ) {
    return {
      generatedCron: input.generatedCron,
      internalTimezone: input.internalTimezone,
      lastSyncedCron: input.lastSyncedCron,
      lastSyncedTimezone: input.lastSyncedTimezone,
      notify: {
        cron: input.generatedCron,
        timezone: input.internalTimezone,
      },
    };
  }

  return {
    generatedCron: input.generatedCron,
    internalTimezone: input.internalTimezone,
    lastSyncedCron: input.lastSyncedCron,
    lastSyncedTimezone: input.lastSyncedTimezone,
    notify: null,
  };
}

const MINUTE_OPTIONS = [
  { label: 'Every 15 minutes', value: '*/15' },
  { label: 'Every 30 minutes', value: '*/30' },
  { label: 'Specific minute', value: 'specific' },
];

const HOUR_OPTIONS = [
  { label: 'Every hour', value: '*' },
  { label: 'Every 2 hours', value: '*/2' },
  { label: 'Every 4 hours', value: '*/4' },
  { label: 'Every 6 hours', value: '*/6' },
  { label: 'Every 12 hours', value: '*/12' },
  { label: 'Specific hour', value: 'specific' },
];

const DAY_OF_MONTH_OPTIONS = [
  { label: 'Any day', value: '*' },
  { label: '1st', value: '1' },
  { label: '15th', value: '15' },
  { label: 'Last day', value: 'L' },
];

const MONTH_OPTIONS = [
  { label: 'Every month', value: '*' },
  { label: 'Jan', value: '1' },
  { label: 'Feb', value: '2' },
  { label: 'Mar', value: '3' },
  { label: 'Apr', value: '4' },
  { label: 'May', value: '5' },
  { label: 'Jun', value: '6' },
  { label: 'Jul', value: '7' },
  { label: 'Aug', value: '8' },
  { label: 'Sep', value: '9' },
  { label: 'Oct', value: '10' },
  { label: 'Nov', value: '11' },
  { label: 'Dec', value: '12' },
];

const DAY_OF_WEEK_OPTIONS = [
  { label: 'Any day', value: '*' },
  { label: 'Sun', value: '0' },
  { label: 'Mon', value: '1' },
  { label: 'Tue', value: '2' },
  { label: 'Wed', value: '3' },
  { label: 'Thu', value: '4' },
  { label: 'Fri', value: '5' },
  { label: 'Sat', value: '6' },
  { label: 'Weekdays (Mon–Fri)', value: '1-5' },
  { label: 'Weekends (Sat–Sun)', value: '0,6' },
];

function buildSelectField(
  label: string,
  options: { label: string; value: string }[],
  currentValue: string,
  showSpecific: boolean,
  specificOptions: { label: string; value: string }[],
  specificValue: string,
  onSelect: (val: string) => void,
  onSpecificChange: (val: string) => void,
  isDark: boolean,
) {
  const isSpecific = showSpecific && !options.find(o => o.value === currentValue);

  return (
    <FormControl size="small" sx={{ minWidth: 180 }}>
      <InputLabel>{label}</InputLabel>
      <Select
        value={isSpecific ? 'specific' : currentValue}
        label={label}
        onChange={(e) => {
          const v = e.target.value;
          if (v === 'specific') {
            onSelect(specificOptions[0]?.value || '0');
          } else {
            onSelect(v);
          }
        }}
        sx={{
          '& .MuiSelect-select': { py: 1 },
          fontSize: 13,
          backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)',
        }}
      >
        {options.map(o => (
          <MenuItem key={o.value} value={o.value} sx={{ fontSize: 13 }}>
            {o.label}
          </MenuItem>
        ))}
        {showSpecific && (
          <MenuItem key="__specific__" value="specific" sx={{ fontSize: 13, fontWeight: 700 }}>
            — Specific —
          </MenuItem>
        )}
      </Select>
    </FormControl>
  );
}

export const CronBuilder: React.FC<CronBuilderProps> = ({
  cron,
  timezone: timezoneProp,
  value,
  onChange,
}) => {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const inputCron = cron ?? value?.cron;
  const inputTimezone = timezoneProp ?? value?.timezone;
  const [timezone, setTimezone] = useState(() => inputTimezone || 'UTC');
  const [customMode, setCustomMode] = useState(false);
  const [customCron, setCustomCron] = useState('');
  const [customError, setCustomError] = useState<string | null>(null);
  const lastSyncedRef = React.useRef<{ cron?: string; timezone?: string }>({
    cron: inputCron,
    timezone: inputTimezone,
  });

  const initial = inputCron ? parseCronToFields(inputCron) : null;

  const [minute, setMinute] = useState<string>(initial?.minute || '*');
  const [minuteSpecific, setMinuteSpecific] = useState<string>('0');
  const [hour, setHour] = useState<string>(initial?.hour || '*');
  const [hourSpecific, setHourSpecific] = useState<string>('0');
  const [dayOfMonth, setDayOfMonth] = useState<string>(initial?.dayOfMonth || '*');
  const [dayOfMonthSpecific, setDayOfMonthSpecific] = useState<string>('1');
  const [month, setMonth] = useState<string>(initial?.month || '*');
  const [dayOfWeek, setDayOfWeek] = useState<string>(initial?.dayOfWeek || '*');

  const showMinuteSpecific = minute === 'specific';
  const showHourSpecific = hour === 'specific';
  const showDayOfMonthSpecific = dayOfMonth === 'specific';

  const finalMinute = showMinuteSpecific ? minuteSpecific : minute;
  const finalHour = showHourSpecific ? hourSpecific : hour;
  const finalDayOfMonth = showDayOfMonthSpecific ? dayOfMonthSpecific : dayOfMonth;

  const generatedCron = useMemo(
    () => buildCron({ minute: finalMinute, hour: finalHour, dayOfMonth: finalDayOfMonth, month, dayOfWeek }),
    [finalMinute, finalHour, finalDayOfMonth, month, dayOfWeek],
  );

  const nextRuns = useMemo(() => {
    if (customMode) {
      if (!customCron.trim()) return [];
      const result = validateCron(customCron.trim());
      if (!result.valid) return [];
      return computeNextRuns(customCron.trim(), timezone, 3);
    }
    return computeNextRuns(generatedCron, timezone, 3);
  }, [generatedCron, customCron, customMode, timezone]);

  useEffect(() => {
    const currentGenerated = customMode ? customCron.trim() : generatedCron;
    if (customMode) {
      const result = validateCron(currentGenerated);
      setCustomError(result.valid ? null : result.error || 'Invalid cron');
    }

    const next = applyCronBuilderExternalProps({
      generatedCron: currentGenerated,
      internalTimezone: timezone,
      propCron: inputCron,
      propTimezone: inputTimezone,
      lastSyncedCron: lastSyncedRef.current.cron,
      lastSyncedTimezone: lastSyncedRef.current.timezone,
    });

    lastSyncedRef.current = {
      cron: next.lastSyncedCron,
      timezone: next.lastSyncedTimezone,
    };

    if (next.notify) {
      if (customMode) {
        const result = validateCron(next.notify.cron);
        if (!result.valid) return;
      }
      onChange(next.notify);
      return;
    }

    const cronNeedsSync = next.generatedCron !== currentGenerated;
    const timezoneNeedsSync = next.internalTimezone !== timezone;
    if (!cronNeedsSync && !timezoneNeedsSync) return;

    if (timezoneNeedsSync) {
      setTimezone(next.internalTimezone);
    }
    if (cronNeedsSync) {
      setCustomMode(false);
      setCustomCron('');
      setCustomError(null);
      const parsed = parseCronToFields(next.generatedCron);
      setMinute(parsed?.minute || '*');
      setHour(parsed?.hour || '*');
      setDayOfMonth(parsed?.dayOfMonth || '*');
      setMonth(parsed?.month || '*');
      setDayOfWeek(parsed?.dayOfWeek || '*');
    }
  }, [
    generatedCron,
    customCron,
    customMode,
    timezone,
    inputCron,
    inputTimezone,
    onChange,
  ]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      <FormControlLabel
        control={
          <Switch
            size="small"
            checked={customMode}
            onChange={(e) => {
              setCustomMode(e.target.checked);
              setCustomError(null);
              if (!e.target.checked) {
                setCustomCron('');
              }
            }}
          />
        }
        label={
          <Typography variant="body2" sx={{ fontSize: 13, fontWeight: 600 }}>
            Custom cron expression
          </Typography>
        }
      />

      {customMode ? (
        <Box>
          <TextField
            fullWidth
            size="small"
            label="Cron expression"
            placeholder="*/15 * * * *"
            value={customCron}
            onChange={(e) => {
              setCustomCron(e.target.value);
              const result = validateCron(e.target.value.trim());
              setCustomError(result.valid ? null : result.error || 'Invalid cron');
            }}
            error={!!customError}
            helperText={customError || 'Format: minute hour day month weekday'}
            inputProps={{ style: { fontFamily: 'monospace', fontSize: 14 } }}
          />
        </Box>
      ) : (
        <>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center' }}>
            {buildSelectField(
              'Minute',
              MINUTE_OPTIONS,
              minute,
              true,
              Array.from({ length: 60 }, (_, i) => ({ label: String(i), value: String(i) })),
              minuteSpecific,
              setMinute,
              setMinuteSpecific,
              isDark,
            )}

            {buildSelectField(
              'Hour',
              HOUR_OPTIONS,
              hour,
              true,
              Array.from({ length: 24 }, (_, i) => ({ label: String(i).padStart(2, '0'), value: String(i) })),
              hourSpecific,
              setHour,
              setHourSpecific,
              isDark,
            )}

            {buildSelectField(
              'Day of month',
              DAY_OF_MONTH_OPTIONS,
              dayOfMonth,
              true,
              Array.from({ length: 31 }, (_, i) => ({ label: String(i + 1), value: String(i + 1) })),
              dayOfMonthSpecific,
              setDayOfMonth,
              setDayOfMonthSpecific,
              isDark,
            )}

            {buildSelectField(
              'Month',
              MONTH_OPTIONS,
              month,
              false,
              [],
              month,
              setMonth,
              () => {},
              isDark,
            )}

            {buildSelectField(
              'Day of week',
              DAY_OF_WEEK_OPTIONS,
              dayOfWeek,
              false,
              [],
              dayOfWeek,
              setDayOfWeek,
              () => {},
              isDark,
            )}
          </Box>

          <FormControl size="small" sx={{ minWidth: 220 }}>
            <InputLabel>Timezone</InputLabel>
            <Select
              value={timezone}
              label="Timezone"
              onChange={(e) => setTimezone(e.target.value)}
              sx={{
                '& .MuiSelect-select': { py: 1 },
                fontSize: 13,
                backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)',
              }}
            >
              {validMomentTimezones.map((tz) => (
                <MenuItem key={tz} value={tz} sx={{ fontSize: 12 }}>
                  {tz}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </>
      )}

      <Box
        sx={{
          p: 1.5,
          borderRadius: 2,
          background: 'rgba(99,102,241,0.07)',
          border: '1px solid rgba(99,102,241,0.2)',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 }}>
            Cron expression
          </Typography>
          <Tooltip title="minute hour day-of-month month day-of-week" arrow placement="top">
            <InfoOutlined sx={{ fontSize: 13, color: 'text.disabled' }} />
          </Tooltip>
        </Box>
        <Typography
          sx={{
            fontFamily: 'monospace',
            fontSize: 15,
            fontWeight: 700,
            color: customMode && customError ? 'error.main' : '#6366f1',
            letterSpacing: 1,
          }}
        >
          {(customMode ? customCron.trim() || '—' : generatedCron)}
        </Typography>
      </Box>

      {nextRuns.length > 0 && (
        <Box>
          <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, display: 'block', mb: 1 }}>
            Next {nextRuns.length} runs ({timezone})
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            {nextRuns.map((run, i) => (
              <Box
                key={i}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  px: 1.5,
                  py: 0.75,
                  borderRadius: 1.5,
                  background: 'rgba(16,185,129,0.08)',
                  border: '1px solid rgba(16,185,129,0.2)',
                }}
              >
                <Typography variant="caption" sx={{ fontWeight: 700, color: '#10b981', fontSize: 11 }}>
                  #{i + 1}
                </Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 12, fontFamily: 'monospace' }}>
                  {formatNextRun(run, timezone)}
                </Typography>
              </Box>
            ))}
          </Box>
        </Box>
      )}
    </Box>
  );
};
