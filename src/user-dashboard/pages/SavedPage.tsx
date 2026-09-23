import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  InputAdornment,
  Pagination,
  Stack,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import BookmarkBorder from '@mui/icons-material/BookmarkBorder';
import BookmarkAddedOutlined from '@mui/icons-material/BookmarkAddedOutlined';
import ClearRounded from '@mui/icons-material/ClearRounded';
import SearchOffOutlined from '@mui/icons-material/SearchOffOutlined';
import SearchOutlined from '@mui/icons-material/SearchOutlined';
import { useNavigate } from 'react-router-dom';
import { EmptyState } from '../components/EmptyState';
import { LibraryJobCard } from '../components/LibraryJobCard';
import { ReportJobDialog, type JobReportReason } from '../components/ReportJobDialog';
import { JobListSkeleton } from '../components/Skeletons';
import { useRequirePortalAuth } from '../hooks/usePortalAuth.tsx';
import { assignJob, reportJob, unsaveJob } from '../api/portalApi';
import { invalidatePortalShell, usePortalSaved } from '../hooks/portalQueries';
import { pluralize } from '../utils/format';
import {
  BODY_FONT,
  DISPLAY_FONT,
  EASE,
  FIRSTSTEP,
  RADIUS,
  STITCH,
  ghostButtonSx,
  tint,
} from '../tokens';
import { useQueryClient } from '@tanstack/react-query';
import { useGlobalInfoStore } from '../../context/globalInfo';
import type { FeedJob } from '../types';

/** Match First Step Job Board page size. */
const PAGE_SIZE = 24;
const COMPANY_CHIP_LIMIT = 10;

export function SavedPage() {
  const { loading } = useRequirePortalAuth();
  const navigate = useNavigate();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const { notify } = useGlobalInfoStore();
  const queryClient = useQueryClient();

  const [searchInput, setSearchInput] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [company, setCompany] = useState('');
  const [page, setPage] = useState(1);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [reportTarget, setReportTarget] = useState<FeedJob | null>(null);
  const [reporting, setReporting] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQ(searchInput.trim()), 280);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [debouncedQ, company]);

  const { data, isLoading, isFetching, refetch } = usePortalSaved(!loading, {
    page,
    limit: PAGE_SIZE,
    q: debouncedQ,
    company,
  });

  const jobs = data?.jobs || [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;
  const companies = data?.companies || [];
  const ready = !isLoading;
  const filtersActive = Boolean(debouncedQ || company);

  const visibleCompanies = useMemo(
    () => companies.slice(0, COMPANY_CHIP_LIMIT),
    [companies],
  );
  const hiddenCompanyCount = Math.max(0, companies.length - visibleCompanies.length);

  const rangeLabel = useMemo(() => {
    if (total === 0) return '0 roles';
    const start = (page - 1) * PAGE_SIZE + 1;
    const end = Math.min(page * PAGE_SIZE, total);
    return `${start}–${end} of ${total}`;
  }, [page, total]);

  const load = () => {
    void invalidatePortalShell(queryClient);
    return refetch();
  };

  const handleAssign = async (id: string) => {
    setAssigningId(id);
    try {
      const result = await assignJob(id);
      notify(
        result.status === 'already_assigned' ? 'info' : 'success',
        result.message || 'Assigned to OD Jobs',
      );
      void load();
    } catch (err: any) {
      notify('error', err?.response?.data?.error || err?.message || 'Could not assign job');
    } finally {
      setAssigningId(null);
    }
  };

  const handleReportSubmit = async (payload: { reason: JobReportReason; note: string }) => {
    if (!reportTarget) return;
    setReporting(true);
    try {
      const result = await reportJob(reportTarget.id, payload);
      notify('success', result.message || 'Report submitted');
      setReportTarget(null);
    } catch (err: any) {
      notify('error', err?.response?.data?.error || err?.message || 'Could not submit report');
    } finally {
      setReporting(false);
    }
  };

  const clearFilters = () => {
    setSearchInput('');
    setDebouncedQ('');
    setCompany('');
    setPage(1);
  };

  const handlePageChange = (_: React.ChangeEvent<unknown>, next: number) => {
    setPage(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (loading) return null;

  return (
    <Box sx={{ width: '100%', maxWidth: 1400, mx: 'auto' }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        alignItems={{ xs: 'flex-start', sm: 'center' }}
        justifyContent="space-between"
        spacing={1.5}
        sx={{ mb: 2 }}
      >
        <Stack direction="row" spacing={1.5} alignItems="flex-start" sx={{ minWidth: 0 }}>
          <Box
            sx={{
              width: 44,
              height: 44,
              borderRadius: '12px',
              flexShrink: 0,
              display: 'grid',
              placeItems: 'center',
              bgcolor: tint(STITCH.secondary, 0.16),
              color: STITCH.secondaryDark,
              border: `1px solid ${tint(STITCH.secondary, 0.35)}`,
            }}
          >
            <BookmarkAddedOutlined sx={{ fontSize: 22 }} />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography
              sx={{
                color: STITCH.secondaryDark,
                fontWeight: 700,
                letterSpacing: '0.14em',
                fontSize: '0.66rem',
                textTransform: 'uppercase',
                fontFamily: BODY_FONT,
                mb: 0.25,
              }}
            >
              My library
            </Typography>
            <Typography
              component="h1"
              sx={{
                fontFamily: DISPLAY_FONT,
                fontWeight: 700,
                letterSpacing: '-0.03em',
                lineHeight: 1.15,
                color: STITCH.primaryContainer,
                fontSize: { xs: '1.35rem', md: '1.55rem' },
              }}
            >
              Saved jobs
            </Typography>
            <Typography
              sx={{
                color: STITCH.muted,
                mt: 0.35,
                fontSize: '0.84rem',
                fontFamily: BODY_FONT,
                maxWidth: 560,
                lineHeight: 1.45,
              }}
            >
              Bookmarks stay here after they leave your feed window.
            </Typography>
          </Box>
        </Stack>

        {ready && total > 0 && (
          <Chip
            icon={<BookmarkBorder sx={{ fontSize: '16px !important' }} />}
            label={`${total} ${pluralize(total, 'job')} saved`}
            size="small"
            sx={{
              borderRadius: RADIUS.pill,
              fontWeight: 700,
              height: 30,
              bgcolor: tint(STITCH.secondary, 0.14),
              color: STITCH.secondaryDark,
              border: `1px solid ${tint(STITCH.secondary, 0.3)}`,
              '& .MuiChip-icon': { color: STITCH.secondaryDark },
            }}
          />
        )}
      </Stack>

      {(ready || total > 0 || filtersActive) && (
        <Box
          sx={{
            mb: 2.5,
            p: { xs: 1.25, sm: 1.5 },
            borderRadius: '16px',
            bgcolor: STITCH.surfaceLowest,
            border: `1px solid ${tint(STITCH.primary, 0.08)}`,
            boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
          }}
        >
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25} alignItems={{ md: 'center' }}>
            <TextField
              size="small"
              placeholder="Search title, company, or location…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              sx={{
                flex: 1,
                minWidth: 0,
                '& .MuiOutlinedInput-root': {
                  borderRadius: '12px',
                  bgcolor: STITCH.surfaceLow,
                  transition: `box-shadow 160ms ${EASE}`,
                  '& fieldset': { borderColor: STITCH.outlineVariant },
                  '&:hover fieldset': { borderColor: tint(STITCH.secondary, 0.55) },
                  '&.Mui-focused': {
                    bgcolor: STITCH.surfaceLowest,
                    boxShadow: `0 0 0 3px ${tint(STITCH.secondary, 0.18)}`,
                  },
                  '&.Mui-focused fieldset': { borderColor: STITCH.secondaryDark },
                },
              }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchOutlined sx={{ fontSize: 18, color: FIRSTSTEP.textMuted }} />
                  </InputAdornment>
                ),
                endAdornment: searchInput ? (
                  <InputAdornment position="end">
                    <ClearRounded
                      onClick={() => setSearchInput('')}
                      sx={{
                        fontSize: 18,
                        color: FIRSTSTEP.textMuted,
                        cursor: 'pointer',
                        '&:hover': { color: STITCH.primary },
                      }}
                    />
                  </InputAdornment>
                ) : undefined,
              }}
            />

            <Stack direction="row" alignItems="center" spacing={1} sx={{ flexShrink: 0 }}>
              <Typography
                sx={{
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  color: STITCH.muted,
                  fontFamily: BODY_FONT,
                  whiteSpace: 'nowrap',
                  opacity: isFetching ? 0.6 : 1,
                }}
              >
                {rangeLabel}
              </Typography>
              {filtersActive && (
                <Button
                  size="small"
                  onClick={clearFilters}
                  sx={{
                    ...ghostButtonSx,
                    minWidth: 0,
                    px: 1.25,
                    py: 0.4,
                    fontSize: '0.75rem',
                    borderRadius: RADIUS.pill,
                  }}
                >
                  Clear
                </Button>
              )}
            </Stack>
          </Stack>

          {companies.length > 0 && (
            <Stack direction="row" flexWrap="wrap" gap={0.75} sx={{ mt: 1.25 }}>
              {['', ...visibleCompanies].map((c) => {
                const active = company === c;
                return (
                  <Chip
                    key={c || 'all'}
                    label={c || 'All companies'}
                    onClick={() => setCompany(c)}
                    size="small"
                    sx={{
                      borderRadius: RADIUS.pill,
                      fontWeight: active ? 700 : 500,
                      height: 28,
                      border: `1px solid ${active ? STITCH.secondary : STITCH.outlineVariant}`,
                      bgcolor: active ? tint(STITCH.secondary, 0.16) : STITCH.surfaceLow,
                      color: active ? STITCH.secondaryDark : STITCH.muted,
                      transition: `background-color 140ms ${EASE}, border-color 140ms ${EASE}`,
                      '&:hover': {
                        bgcolor: active
                          ? tint(STITCH.secondary, 0.22)
                          : tint(STITCH.secondary, 0.08),
                      },
                    }}
                  />
                );
              })}
              {hiddenCompanyCount > 0 && company && !visibleCompanies.includes(company) && (
                <Chip
                  label={company}
                  onDelete={() => setCompany('')}
                  size="small"
                  sx={{
                    borderRadius: RADIUS.pill,
                    fontWeight: 700,
                    height: 28,
                    border: `1px solid ${STITCH.secondary}`,
                    bgcolor: tint(STITCH.secondary, 0.16),
                    color: STITCH.secondaryDark,
                  }}
                />
              )}
              {hiddenCompanyCount > 0 && (
                <Chip
                  label={`+${hiddenCompanyCount} more`}
                  size="small"
                  variant="outlined"
                  sx={{
                    borderRadius: RADIUS.pill,
                    height: 28,
                    fontWeight: 600,
                    color: STITCH.muted,
                    borderColor: STITCH.outlineVariant,
                  }}
                />
              )}
            </Stack>
          )}
        </Box>
      )}

      {!ready && !data ? (
        <JobListSkeleton count={8} />
      ) : total === 0 && !filtersActive ? (
        <EmptyState
          icon={BookmarkBorder}
          title="No saved jobs yet"
          description="Tap the bookmark icon on any job in your feed to keep it here for later."
          actionLabel="Open my feed"
          actionTo="/user/feed"
          secondaryLabel="Browse clusters"
          secondaryTo="/user/clusters"
        />
      ) : total === 0 && filtersActive ? (
        <EmptyState
          icon={SearchOffOutlined}
          variant="filtered"
          title="Nothing matches that search"
          description="Try a different keyword or switch back to all companies."
          actionLabel="Clear filters"
          onAction={clearFilters}
        />
      ) : (
        <>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: {
                xs: '1fr',
                sm: 'repeat(2, 1fr)',
                md: 'repeat(3, 1fr)',
                lg: 'repeat(4, 1fr)',
              },
              gap: 2,
              opacity: isFetching ? 0.72 : 1,
              transition: `opacity 160ms ${EASE}`,
            }}
          >
            {jobs.map((job) => (
              <LibraryJobCard
                key={job.id}
                job={job}
                assigning={assigningId === job.id}
                onOpen={(id) => navigate(`/user/jobs/${id}`)}
                onAssign={handleAssign}
                onReport={(id) => {
                  const found = jobs.find((j) => j.id === id);
                  if (found) setReportTarget(found);
                }}
                onUnsave={async (id) => {
                  await unsaveJob(id);
                  void load();
                }}
              />
            ))}
          </Box>

          {totalPages > 1 && (
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 1,
                mt: 4,
                mb: 1,
              }}
            >
              <Pagination
                count={totalPages}
                page={page}
                onChange={handlePageChange}
                color="primary"
                shape="rounded"
                size={isMobile ? 'small' : 'medium'}
                showFirstButton={!isMobile}
                showLastButton={!isMobile}
                sx={{
                  '& .MuiPaginationItem-root': {
                    fontWeight: 600,
                    fontSize: '0.8rem',
                    borderRadius: '10px',
                    fontFamily: BODY_FONT,
                    '&.Mui-selected': {
                      bgcolor: STITCH.primary,
                      boxShadow: `0 4px 12px ${tint(STITCH.primary, 0.3)}`,
                      '&:hover': { bgcolor: STITCH.primaryDark },
                    },
                  },
                }}
              />
              <Typography
                sx={{
                  fontSize: '0.75rem',
                  color: STITCH.muted,
                  fontFamily: BODY_FONT,
                }}
              >
                Page {page} of {totalPages} · {PAGE_SIZE} per page
              </Typography>
            </Box>
          )}
        </>
      )}

      <ReportJobDialog
        open={Boolean(reportTarget)}
        job={reportTarget}
        submitting={reporting}
        onClose={() => !reporting && setReportTarget(null)}
        onSubmit={handleReportSubmit}
      />
    </Box>
  );
}
