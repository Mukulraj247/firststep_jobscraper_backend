import React, { useEffect, useState } from 'react';
import { Box, Button, Chip, Grid, InputAdornment, MenuItem, Stack, TextField, Typography } from '@mui/material';
import SearchOutlined from '@mui/icons-material/SearchOutlined';
import type { FeedFilters } from '../types';
import { countActiveFilters } from '../utils/format';
import { BODY_FONT, RADIUS, STITCH, panelSx, tint } from '../tokens';

type Props = {
  filters: FeedFilters;
  onChange: (filters: FeedFilters) => void;
};

const fieldSx = {
  '& .MuiOutlinedInput-root': {
    borderRadius: RADIUS.control,
    bgcolor: STITCH.surfaceLow,
    fontFamily: BODY_FONT,
    fontSize: '0.8125rem',
    '& fieldset': { border: 'none' },
    '&.Mui-focused': { bgcolor: STITCH.surfaceContainer },
  },
  '& .MuiInputLabel-root': { fontFamily: BODY_FONT },
} as const;

/** Stitch always-visible filter strip (search + 4 selects + H-1B chips + sort). */
export function FeedFilterBar({ filters, onChange }: Props) {
  const [query, setQuery] = useState(filters.q ?? '');
  const set = (patch: Partial<FeedFilters>) => onChange({ ...filters, ...patch });
  const activeCount = countActiveFilters(filters);

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
    <Box sx={{ ...panelSx, p: 2, mb: 2 }}>
      <Grid container spacing={1.25}>
        <Grid item xs={12} md={4}>
          <TextField
            size="small"
            fullWidth
            placeholder="Search keywords, skills, titles (e.g. Python, distributed systems, L4)…"
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
            <MenuItem value="Google">Google</MenuItem>
            <MenuItem value="Meta">Meta</MenuItem>
            <MenuItem value="Apple">Apple</MenuItem>
            <MenuItem value="Amazon">Amazon</MenuItem>
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
            <MenuItem value="CA">California</MenuItem>
            <MenuItem value="NY">New York</MenuItem>
            <MenuItem value="Remote">Remote</MenuItem>
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
            <MenuItem value="Junior">Junior 0–2y</MenuItem>
            <MenuItem value="Mid">Mid-Level 3–5y</MenuItem>
            <MenuItem value="Senior">Senior 5y+</MenuItem>
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
            <MenuItem value="">Work Mode</MenuItem>
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
        sx={{ mt: 1.5 }}
      >
        <Stack direction="row" flexWrap="wrap" gap={0.75} useFlexGap>
          {(
            [
              ['h1bSponsorFriendly', 'H-1B Sponsor-Friendly (Active)'],
              ['h1bFy2026Match', 'FY2026 Filing Match (Active)'],
            ] as const
          ).map(([key, label]) => {
            const on = Boolean(filters[key]);
            return (
              <Chip
                key={key}
                label={label}
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
                    : STITCH.surfaceLow,
                  color: on
                    ? key === 'h1bSponsorFriendly'
                      ? STITCH.onSecondaryContainer
                      : STITCH.onPrimary
                    : STITCH.onSurfaceVariant,
                  '&:hover': { opacity: 0.92 },
                }}
              />
            );
          })}
          <Chip
            label="Salary: $150k+"
            sx={{
              borderRadius: RADIUS.pill,
              fontWeight: 600,
              fontSize: '0.72rem',
              bgcolor: STITCH.surfaceContainer,
              color: STITCH.onSurfaceVariant,
            }}
          />
        </Stack>

        <Stack direction="row" alignItems="center" spacing={1}>
          {activeCount > 0 && (
            <Button
              size="small"
              onClick={() => onChange({})}
              sx={{ textTransform: 'none', fontWeight: 600, color: STITCH.muted, fontFamily: BODY_FONT }}
            >
              Clear
            </Button>
          )}
          <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: STITCH.onSurfaceVariant, fontFamily: BODY_FONT }}>
            Newest First (Last 2 Hours)
          </Typography>
        </Stack>
      </Stack>
    </Box>
  );
}
