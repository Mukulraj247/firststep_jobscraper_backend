import React, { useEffect, useMemo, useState } from 'react';
import { Box, Button, Chip, Grid, InputAdornment, MenuItem, Stack, TextField, Typography } from '@mui/material';
import SearchOutlined from '@mui/icons-material/SearchOutlined';
import type { FeedFilters } from '../types';
import { countActiveFilters } from '../utils/format';
import { BODY_FONT, RADIUS, STITCH } from '../tokens';

type Props = {
  filters: FeedFilters;
  onChange: (filters: FeedFilters) => void;
  /** Companies present in the current feed (dynamic options). */
  companyOptions?: string[];
};

const fieldSx = {
  '& .MuiOutlinedInput-root': {
    borderRadius: RADIUS.control,
    bgcolor: STITCH.surfaceLowest,
    fontFamily: BODY_FONT,
    fontSize: '0.8125rem',
    '& fieldset': { borderColor: STITCH.outlineVariant },
    '&.Mui-focused fieldset': { borderColor: STITCH.secondary },
  },
  '& .MuiInputLabel-root': { fontFamily: BODY_FONT },
} as const;

const LEVEL_OPTIONS = [
  { value: 'Junior', label: 'Entry / Junior' },
  { value: 'Mid', label: 'Mid-Senior' },
  { value: 'Senior', label: 'Senior+' },
] as const;

const LOCATION_OPTIONS = [
  { value: 'CA', label: 'California (CA)' },
  { value: 'NY', label: 'New York (NY)' },
  { value: 'WA', label: 'Washington (WA)' },
  { value: 'TX', label: 'Texas (TX)' },
  { value: 'Remote', label: 'Remote' },
] as const;

/** Slim feed filter strip. */
export function FeedFilterBar({ filters, onChange, companyOptions = [] }: Props) {
  const [query, setQuery] = useState(filters.q ?? '');
  const set = (patch: Partial<FeedFilters>) => onChange({ ...filters, ...patch });
  const activeCount = countActiveFilters(filters);

  const companies = useMemo(() => {
    const setNames = new Set<string>();
    for (const c of companyOptions) {
      const name = String(c || '').trim();
      if (name) setNames.add(name);
    }
    if (filters.company) setNames.add(filters.company);
    return [...setNames].sort((a, b) => a.localeCompare(b));
  }, [companyOptions, filters.company]);

  useEffect(() => {
    setQuery(filters.q ?? '');
  }, [filters.q]);

  useEffect(() => {
    if (query === (filters.q ?? '')) return undefined;
    const timer = setTimeout(() => onChange({ ...filters, q: query || undefined }), 260);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  return (
    <Box sx={{ mb: 2 }}>
      <Grid container spacing={1.25}>
        <Grid item xs={12} md={4}>
          <TextField
            size="small"
            fullWidth
            placeholder="Search titles, companies, skills…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            sx={fieldSx}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchOutlined sx={{ fontSize: 20, color: STITCH.onSurfaceVariant }} />
                </InputAdornment>
              ),
            }}
          />
        </Grid>
        <Grid item xs={6} sm={3} md={2}>
          <TextField
            size="small"
            fullWidth
            select
            value={filters.company ?? ''}
            onChange={(e) => set({ company: e.target.value || undefined })}
            sx={fieldSx}
            SelectProps={{ displayEmpty: true }}
          >
            <MenuItem value="">Company</MenuItem>
            {companies.length === 0 ? (
              <MenuItem value="" disabled>
                No companies yet
              </MenuItem>
            ) : (
              companies.map((c) => (
                <MenuItem key={c} value={c}>
                  {c}
                </MenuItem>
              ))
            )}
          </TextField>
        </Grid>
        <Grid item xs={6} sm={3} md={2}>
          <TextField
            size="small"
            fullWidth
            select
            value={filters.location ?? ''}
            onChange={(e) => set({ location: e.target.value || undefined })}
            sx={fieldSx}
            SelectProps={{ displayEmpty: true }}
          >
            <MenuItem value="">Location</MenuItem>
            {LOCATION_OPTIONS.map((o) => (
              <MenuItem key={o.value} value={o.value}>
                {o.label}
              </MenuItem>
            ))}
          </TextField>
        </Grid>
        <Grid item xs={6} sm={3} md={2}>
          <TextField
            size="small"
            fullWidth
            select
            value={filters.experience ?? ''}
            onChange={(e) => set({ experience: e.target.value || undefined })}
            sx={fieldSx}
            SelectProps={{ displayEmpty: true }}
          >
            <MenuItem value="">Level</MenuItem>
            {LEVEL_OPTIONS.map((o) => (
              <MenuItem key={o.value} value={o.value}>
                {o.label}
              </MenuItem>
            ))}
          </TextField>
        </Grid>
        <Grid item xs={6} sm={3} md={2}>
          <TextField
            size="small"
            fullWidth
            select
            value={filters.workMode ?? ''}
            onChange={(e) => set({ workMode: e.target.value || undefined })}
            sx={fieldSx}
            SelectProps={{ displayEmpty: true }}
          >
            <MenuItem value="">Work mode</MenuItem>
            <MenuItem value="Remote">Remote</MenuItem>
            <MenuItem value="Hybrid">Hybrid</MenuItem>
            <MenuItem value="Onsite">Onsite</MenuItem>
          </TextField>
        </Grid>
      </Grid>

      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        justifyContent="space-between"
        alignItems={{ sm: 'center' }}
        spacing={1.25}
        sx={{ mt: 1.25 }}
      >
        <Stack direction="row" flexWrap="wrap" gap={0.75} useFlexGap>
          {(
            [
              ['h1bSponsorFriendly', 'H-1B sponsor-friendly'],
              ['h1bFy2026Match', 'FY2026 filing match'],
            ] as const
          ).map(([key, label]) => {
            const on = Boolean(filters[key]);
            return (
              <Chip
                key={key}
                label={on ? `${label} · On` : label}
                onClick={() => set({ [key]: on ? undefined : true } as Partial<FeedFilters>)}
                sx={{
                  borderRadius: RADIUS.pill,
                  fontWeight: 700,
                  fontSize: '0.72rem',
                  fontFamily: BODY_FONT,
                  bgcolor: on
                    ? key === 'h1bSponsorFriendly'
                      ? STITCH.secondaryContainer
                      : STITCH.primaryContainer
                    : STITCH.surfaceLowest,
                  color: on
                    ? key === 'h1bSponsorFriendly'
                      ? STITCH.onSecondaryContainer
                      : STITCH.onPrimary
                    : STITCH.onSurfaceVariant,
                  border: on ? 'none' : `1px solid ${STITCH.outlineVariant}`,
                  '&:hover': { opacity: 0.92 },
                }}
              />
            );
          })}
        </Stack>

        <Stack direction="row" alignItems="center" spacing={1}>
          {activeCount > 0 && (
            <Button
              size="small"
              onClick={() => onChange({})}
              sx={{ textTransform: 'none', fontWeight: 600, color: STITCH.muted, fontFamily: BODY_FONT }}
            >
              Clear filters
            </Button>
          )}
          <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: STITCH.onSurfaceVariant, fontFamily: BODY_FONT }}>
            Newest first
          </Typography>
        </Stack>
      </Stack>
    </Box>
  );
}
