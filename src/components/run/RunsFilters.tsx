import React from 'react';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControl,
  InputAdornment,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import { cardSx, FIRSTSTEP, RADIUS } from '../dashboard/ops/dashboardTokens';
import {
  controlMinHeight,
  filterControlSx,
  workspaceNoLiftHoverSx,
} from '../../features/failures/failuresPageBehavior';
import {
  activeFilterPills,
  DURATION_FILTER_OPTIONS,
  FILTER_CONTROL_IDS,
  FILTER_LABEL_IDS,
  hasActiveRunFilters,
  JOBS_FILTER_OPTIONS,
  resultRangeLabel,
  RUN_STATUS_FILTER_OPTIONS,
  type RunsFiltersValue,
} from '../../features/runs/runsPageBehavior';

export type { RunsFiltersValue };

export { hasActiveRunFilters };

export function RunsFilters({
  value,
  resultCount,
  resultFrom,
  resultTo,
  isFetching,
  onSearchChange,
  onDateChange,
  onStatusChange,
  onJobsAddedChange,
  onDurationChange,
  onClearAll,
}: {
  value: RunsFiltersValue;
  resultCount: number;
  resultFrom: number;
  resultTo: number;
  isFetching?: boolean;
  onSearchChange: (value: string) => void;
  onDateChange: (value: string) => void;
  onStatusChange: (value: string) => void;
  onJobsAddedChange: (value: string) => void;
  onDurationChange: (value: string) => void;
  onClearAll: () => void;
}) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'), { noSsr: true });
  const controlSx = filterControlSx(isMobile);
  const minHeight = controlMinHeight(isMobile);
  const filtersActive = hasActiveRunFilters(value);
  const pills = activeFilterPills(value);

  const removePill = (key: string) => {
    if (key === 'q') onSearchChange('');
    else if (key === 'date') onDateChange('');
    else if (key === 'status') onStatusChange('');
    else if (key === 'jobs') onJobsAddedChange('');
    else if (key === 'duration') onDurationChange('');
  };

  return (
    <Paper
      elevation={0}
      sx={[cardSx(), workspaceNoLiftHoverSx, { p: { xs: 2, md: 2.25 }, mb: 2.5 }]}
    >
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: '1fr',
            sm: '1fr 1fr',
            lg: 'minmax(200px, 1.6fr) minmax(150px, 1fr) minmax(140px, 1fr) minmax(140px, 1fr) minmax(140px, 1fr)',
          },
          gap: 1.5,
          alignItems: 'center',
        }}
      >
        <TextField
          id={FILTER_CONTROL_IDS.search}
          size="small"
          label="Search"
          placeholder="Search runs by name or company…"
          value={value.searchInput}
          onChange={(event) => onSearchChange(event.target.value)}
          sx={controlSx}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
          }}
        />
        <TextField
          id={FILTER_CONTROL_IDS.date}
          size="small"
          type="date"
          label="Date"
          InputLabelProps={{ shrink: true }}
          value={value.date}
          onChange={(event) => onDateChange(event.target.value)}
          sx={controlSx}
        />
        <FormControl size="small" sx={controlSx}>
          <InputLabel id={FILTER_LABEL_IDS.status}>Status</InputLabel>
          <Select
            id={FILTER_CONTROL_IDS.status}
            labelId={FILTER_LABEL_IDS.status}
            label="Status"
            value={value.status}
            onChange={(event) => onStatusChange(String(event.target.value))}
          >
            {RUN_STATUS_FILTER_OPTIONS.map((option) => (
              <MenuItem key={option.value || 'any'} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small" sx={controlSx}>
          <InputLabel id={FILTER_LABEL_IDS.jobs}>Jobs added</InputLabel>
          <Select
            id={FILTER_CONTROL_IDS.jobs}
            labelId={FILTER_LABEL_IDS.jobs}
            label="Jobs added"
            value={value.jobsAdded}
            onChange={(event) => onJobsAddedChange(String(event.target.value))}
          >
            {JOBS_FILTER_OPTIONS.map((option) => (
              <MenuItem key={option.value || 'any'} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small" sx={controlSx}>
          <InputLabel id={FILTER_LABEL_IDS.duration}>Duration</InputLabel>
          <Select
            id={FILTER_CONTROL_IDS.duration}
            labelId={FILTER_LABEL_IDS.duration}
            label="Duration"
            value={value.duration}
            onChange={(event) => onDurationChange(String(event.target.value))}
          >
            {DURATION_FILTER_OPTIONS.map((option) => (
              <MenuItem key={option.value || 'any'} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Box>

      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1.25}
        alignItems={{ xs: 'flex-start', sm: 'center' }}
        justifyContent="space-between"
        mt={2}
      >
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {pills.map((pill) => (
            <Chip
              key={pill.key}
              size="small"
              label={pill.label}
              onDelete={() => removePill(pill.key)}
              sx={{ borderRadius: RADIUS.pill }}
            />
          ))}
        </Stack>
        <Stack direction="row" spacing={1.5} alignItems="center">
          {isFetching ? <CircularProgress size={16} /> : null}
          <Typography variant="body2" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
            {resultRangeLabel(resultFrom, resultTo, resultCount)}
          </Typography>
          {filtersActive ? (
            <Button
              id={FILTER_CONTROL_IDS.clearAll}
              size="small"
              onClick={onClearAll}
              sx={{ fontWeight: 700, color: FIRSTSTEP.tealDark, borderRadius: RADIUS.pill, minHeight }}
            >
              Clear all
            </Button>
          ) : null}
        </Stack>
      </Stack>
    </Paper>
  );
}
