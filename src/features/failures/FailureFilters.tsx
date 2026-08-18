import React from 'react';
import {
  Box,
  Button,
  Chip,
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
import { cardSx, FIRSTSTEP, RADIUS } from '../../components/dashboard/ops/dashboardTokens';
import {
  DEFAULT_FAILURE_STATUS_FILTER,
  FAILURE_REASON_OPTIONS,
  FILTER_CONTROL_IDS,
  FILTER_LABEL_IDS,
  activeFilterPills,
  controlMinHeight,
  failureReasonLabel,
  filterControlSx,
  hasActiveFilters,
  resultCountLabel,
  workspaceNoLiftHoverSx,
} from './failuresPageBehavior';

const STATUS_OPTIONS = [
  { value: DEFAULT_FAILURE_STATUS_FILTER, label: 'Failed + Dead + Aborted' },
  { value: 'failed,dead', label: 'Failed + Dead' },
  { value: 'failed', label: 'Failed only' },
  { value: 'dead', label: 'Dead only' },
  { value: 'aborted', label: 'Aborted only' },
] as const;

const ANOMALY_OPTIONS = [
  { value: '', label: 'Any' },
  { value: 'zero_rows', label: 'Zero rows' },
  { value: 'row_drop', label: 'Row drop' },
] as const;

export function FailureFilters({
  q,
  status,
  reason,
  anomaly,
  resultCount,
  onSearchChange,
  onStatusChange,
  onReasonChange,
  onAnomalyChange,
  onClearAll,
}: {
  q: string;
  status: string;
  reason: string;
  anomaly: string;
  resultCount: number;
  onSearchChange: (value: string) => void;
  onStatusChange: (value: string) => void;
  onReasonChange: (value: string) => void;
  onAnomalyChange: (value: string) => void;
  onClearAll: () => void;
}) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'), { noSsr: true });
  const controlSx = filterControlSx(isMobile);
  const minHeight = controlMinHeight(isMobile);
  const filtersActive = hasActiveFilters({ q, status, reason, anomaly });
  const statusLabel = STATUS_OPTIONS.find((option) => option.value === status)?.label;
  const anomalyLabel = ANOMALY_OPTIONS.find((option) => option.value === anomaly)?.label;
  const pills = activeFilterPills({
    q,
    status,
    statusLabel,
    reason,
    reasonLabel: failureReasonLabel(reason),
    anomaly,
    anomalyLabel,
  });

  const removePill = (key: string) => {
    if (key === 'q') onSearchChange('');
    else if (key === 'status') onStatusChange(DEFAULT_FAILURE_STATUS_FILTER);
    else if (key === 'reason') onReasonChange('');
    else if (key === 'anomaly') onAnomalyChange('');
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
            lg: 'minmax(180px, 1.6fr) minmax(150px, 1fr) minmax(160px, 1fr) minmax(140px, 1fr)',
          },
          gap: 1.5,
          alignItems: 'center',
        }}
      >
        <TextField
          id={FILTER_CONTROL_IDS.search}
          size="small"
          label="Search"
          placeholder="Name, company, or ID"
          value={q}
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
        <FormControl size="small" sx={controlSx}>
          <InputLabel id={FILTER_LABEL_IDS.status}>Status</InputLabel>
          <Select
            id={FILTER_CONTROL_IDS.status}
            labelId={FILTER_LABEL_IDS.status}
            label="Status"
            value={status}
            onChange={(event) => onStatusChange(String(event.target.value))}
          >
            {STATUS_OPTIONS.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small" sx={controlSx}>
          <InputLabel id={FILTER_LABEL_IDS.reason}>Failure reason</InputLabel>
          <Select
            id={FILTER_CONTROL_IDS.reason}
            labelId={FILTER_LABEL_IDS.reason}
            label="Failure reason"
            value={reason}
            onChange={(event) => onReasonChange(String(event.target.value))}
          >
            <MenuItem value="">Any</MenuItem>
            {FAILURE_REASON_OPTIONS.map((option) => (
              <MenuItem key={option.code} value={option.code}>
                {option.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small" sx={controlSx}>
          <InputLabel id={FILTER_LABEL_IDS.anomaly}>Anomaly</InputLabel>
          <Select
            id={FILTER_CONTROL_IDS.anomaly}
            labelId={FILTER_LABEL_IDS.anomaly}
            label="Anomaly"
            value={anomaly}
            onChange={(event) => onAnomalyChange(String(event.target.value))}
          >
            {ANOMALY_OPTIONS.map((option) => (
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
          <Typography variant="body2" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
            {resultCountLabel(resultCount)}
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
