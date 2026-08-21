import React, { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Collapse,
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
import LocalOfferOutlinedIcon from '@mui/icons-material/LocalOfferOutlined';
import { TagPicker, formatTagChipLabel } from '../../components/automation/TagPicker';
import { getScheduleLabel, SCHEDULE_OPTIONS } from '../../constants/scheduleOptions';
import { cardSx, FIRSTSTEP, RADIUS } from '../../components/dashboard/ops/dashboardTokens';
import {
  FILTER_CONTROL_IDS,
  activeFilterPills,
  controlMinHeight,
  filterControlSx,
  hasActiveFilters,
  resultCountLabel,
  workspaceNoLiftHoverSx,
} from './automationsPageBehavior';

export function AutomationFilters({
  nameFilter,
  idFilter,
  scheduleCronFilter,
  tagFilter,
  resultCount,
  onNameChange,
  onIdChange,
  onScheduleChange,
  onTagChange,
  onClearAll,
}: {
  nameFilter: string;
  idFilter: string;
  scheduleCronFilter: string;
  tagFilter: string[];
  resultCount: number;
  onNameChange: (value: string) => void;
  onIdChange: (value: string) => void;
  onScheduleChange: (value: string) => void;
  onTagChange: (tags: string[]) => void;
  onClearAll: () => void;
}) {
  const [tagsOpen, setTagsOpen] = useState(tagFilter.length > 0);
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'), { noSsr: true });
  const controlSx = filterControlSx(isMobile);
  const minHeight = controlMinHeight(isMobile);
  const filtersActive = hasActiveFilters({
    q: nameFilter,
    id: idFilter,
    schedule: scheduleCronFilter,
    tags: tagFilter,
  });
  const pills = activeFilterPills({
    q: nameFilter,
    id: idFilter,
    schedule: scheduleCronFilter,
    scheduleLabel: scheduleCronFilter ? getScheduleLabel(scheduleCronFilter) : undefined,
    tags: tagFilter,
  });

  useEffect(() => {
    if (tagFilter.length > 0) setTagsOpen(true);
  }, [tagFilter.length]);

  const removePill = (key: string, tag?: string) => {
    if (key === 'q') onNameChange('');
    else if (key === 'id') onIdChange('');
    else if (key === 'schedule') onScheduleChange('');
    else if (key.startsWith('tag:') && tag) {
      onTagChange(tagFilter.filter((item) => item !== tag));
    }
  };

  return (
    <Paper
      elevation={0}
      sx={[cardSx(), workspaceNoLiftHoverSx, { p: { xs: 1.5, md: 2 } }]}
    >
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: '1fr',
            md: '1fr 1fr',
            xl: 'minmax(180px, 1.5fr) minmax(160px, 1fr) minmax(180px, 1fr) auto',
          },
          gap: 1.5,
          alignItems: 'center',
        }}
      >
        <TextField
          id={FILTER_CONTROL_IDS.search}
          size="small"
          label="Search"
          placeholder="Name or company"
          value={nameFilter}
          onChange={(event) => onNameChange(event.target.value)}
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
          id={FILTER_CONTROL_IDS.scoutId}
          size="small"
          label="Scout ID"
          placeholder="SX…"
          value={idFilter}
          onChange={(event) => onIdChange(event.target.value)}
          sx={controlSx}
        />
        <FormControl size="small" sx={controlSx}>
          <InputLabel id="schedule-filter-label">Schedule</InputLabel>
          <Select
            id={FILTER_CONTROL_IDS.schedule}
            labelId="schedule-filter-label"
            label="Schedule"
            value={scheduleCronFilter}
            onChange={(event) => onScheduleChange(String(event.target.value))}
          >
            <MenuItem value="">All schedules</MenuItem>
            <MenuItem value="none">Off / none</MenuItem>
            {SCHEDULE_OPTIONS.filter((option) => option.cron).map((option) => (
              <MenuItem key={option.cron!} value={option.cron!}>
                {option.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Button
          id={FILTER_CONTROL_IDS.tagsToggle}
          variant="outlined"
          startIcon={<LocalOfferOutlinedIcon />}
          onClick={() => setTagsOpen((open) => !open)}
          aria-expanded={tagsOpen}
          sx={{
            borderRadius: RADIUS.pill,
            fontWeight: 700,
            color: FIRSTSTEP.navy,
            borderColor: 'divider',
            justifySelf: { xl: 'start' },
            whiteSpace: 'normal',
            minHeight,
          }}
        >
          {tagsOpen ? 'Hide tags' : tagFilter.length ? `Tags (${tagFilter.length})` : 'Tags'}
        </Button>
      </Box>

      <Collapse in={tagsOpen} unmountOnExit>
        <Box sx={{ mt: 2 }}>
          <TagPicker value={tagFilter} onChange={onTagChange} />
        </Box>
      </Collapse>

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
              label={pill.kind === 'tag' && pill.tag ? formatTagChipLabel(pill.tag) : pill.label}
              onDelete={() => removePill(pill.key, pill.tag)}
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
