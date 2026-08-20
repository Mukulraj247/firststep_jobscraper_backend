import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Button,
  CircularProgress,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Typography,
} from '@mui/material';
import { createSearchRobot } from '../../../../api/storage';
import { useCacheInvalidation, useGlobalInfoStore } from '../../../../context/globalInfo';
import { DEFAULT_OUTPUT_FORMATS, OutputFormat } from '../../../../constants/outputFormats';
import { OutputFormatsField } from './OutputFormatsField';

const MAX_SEARCH_RESULTS = 50;
const DEFAULT_SEARCH_RESULTS = 10;

export const SearchCreatePanel: React.FC = () => {
  const navigate = useNavigate();
  const { notify } = useGlobalInfoStore();
  const { invalidateRecordings } = useCacheInvalidation();

  const [name, setName] = useState('');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(DEFAULT_SEARCH_RESULTS);
  const [mode, setMode] = useState<'discover' | 'scrape'>('discover');
  const [timeRange, setTimeRange] = useState<'day' | 'week' | 'month' | 'year' | ''>('');
  const [outputFormats, setOutputFormats] = useState<OutputFormat[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const canSubmit =
    name.trim().length > 0 &&
    query.trim().length > 0 &&
    (mode === 'discover' || outputFormats.length > 0) &&
    !isLoading;

  const handleCreate = async () => {
    if (!name.trim() || !query.trim()) {
      notify('error', 'Please fill required fields');
      return;
    }
    if (mode === 'scrape' && outputFormats.length === 0) {
      notify('error', 'Please select at least one output format');
      return;
    }

    const clamped = Math.min(MAX_SEARCH_RESULTS, Math.max(1, limit || DEFAULT_SEARCH_RESULTS));
    setIsLoading(true);
    try {
      const formatsForRequest = mode === 'discover' ? [] : outputFormats;
      const result = await createSearchRobot(
        name.trim(),
        {
          query: query.trim(),
          limit: clamped,
          provider: 'duckduckgo',
          filters: {
            timeRange: timeRange ? (timeRange as 'day' | 'week' | 'month' | 'year') : undefined,
          },
          mode,
        },
        formatsForRequest
      );
      setIsLoading(false);
      if (result) {
        invalidateRecordings();
        notify('success', `${name.trim()} created successfully!`);
        navigate('/scrapers');
      } else {
        notify('error', 'Failed to create search scraper');
      }
    } catch (error: any) {
      setIsLoading(false);
      notify('error', error.message || 'Failed to create search scraper');
    }
  };

  return (
    <Box display="flex" flexDirection="column" alignItems="stretch" gap={2}>
      <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', mb: 1 }}>
        Search the web and gather data from relevant results.
      </Typography>
      <TextField
        label="Name"
        placeholder="Example: AI News Monitor"
        required
        fullWidth
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <TextField
        label="Search Query"
        placeholder="Example: latest AI breakthroughs"
        required
        fullWidth
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <TextField
        label="Number of Results"
        type="number"
        fullWidth
        value={limit}
        onChange={(e) => setLimit(parseInt(e.target.value, 10) || 1)}
        helperText={`Default ${DEFAULT_SEARCH_RESULTS}. Max ${MAX_SEARCH_RESULTS}.`}
        FormHelperTextProps={{ sx: { ml: 0 } }}
        inputProps={{ min: 1, max: MAX_SEARCH_RESULTS }}
      />
      <Box display="flex" gap={2} flexDirection={{ xs: 'column', sm: 'row' }}>
        <FormControl fullWidth>
          <InputLabel>Mode</InputLabel>
          <Select
            value={mode}
            label="Mode"
            onChange={(e) => {
              const next = e.target.value as 'discover' | 'scrape';
              setMode(next);
              if (next === 'discover') {
                setOutputFormats([]);
              } else if (outputFormats.length === 0) {
                setOutputFormats([...DEFAULT_OUTPUT_FORMATS]);
              }
            }}
          >
            <MenuItem value="discover">Discover URLs Only</MenuItem>
            <MenuItem value="scrape">Extract Data from Results</MenuItem>
          </Select>
        </FormControl>
        <FormControl fullWidth>
          <InputLabel>Time Range</InputLabel>
          <Select
            value={timeRange}
            label="Time Range"
            onChange={(e) =>
              setTimeRange(e.target.value as 'day' | 'week' | 'month' | 'year' | '')
            }
          >
            <MenuItem value="">No Filter</MenuItem>
            <MenuItem value="day">Past 24 Hours</MenuItem>
            <MenuItem value="week">Past Week</MenuItem>
            <MenuItem value="month">Past Month</MenuItem>
            <MenuItem value="year">Past Year</MenuItem>
          </Select>
        </FormControl>
      </Box>
      {mode === 'scrape' ? (
        <OutputFormatsField value={outputFormats} onChange={setOutputFormats} />
      ) : (
        <Typography variant="body2" color="text.secondary">
          Output formats are only available in &quot;Extract Data from Results&quot; mode.
          Discover mode is cheaper — it only collects URLs.
        </Typography>
      )}
      <Button
        variant="contained"
        fullWidth
        onClick={handleCreate}
        disabled={!canSubmit}
        sx={{
          bgcolor: '#ff00c3',
          py: 1.4,
          fontSize: '1rem',
          textTransform: 'none',
          borderRadius: 2,
          '&:hover': { bgcolor: '#ff00c3' },
        }}
        startIcon={isLoading ? <CircularProgress size={20} color="inherit" /> : null}
      >
        {isLoading ? 'Creating...' : 'Create scraper'}
      </Button>
    </Box>
  );
};
