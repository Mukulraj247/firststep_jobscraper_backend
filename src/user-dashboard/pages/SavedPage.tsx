import React, { useEffect, useMemo, useState } from 'react';
import { Box, Chip, InputAdornment, Stack, TextField, Typography } from '@mui/material';
import BookmarkBorder from '@mui/icons-material/BookmarkBorder';
import SearchOffOutlined from '@mui/icons-material/SearchOffOutlined';
import SearchOutlined from '@mui/icons-material/SearchOutlined';
import { useNavigate } from 'react-router-dom';
import { EmptyState } from '../components/EmptyState';
import { JobCard } from '../components/JobCard';
import { PageHeader } from '../components/PageHeader';
import { JobListSkeleton } from '../components/Skeletons';
import { useRequirePortalAuth } from '../hooks/usePortalAuth';
import { listSaved, unsaveJob } from '../mock/mockApi';
import type { FeedJob } from '../types';
import { pluralize } from '../utils/format';
import { FIRSTSTEP, RADIUS, tint } from '../tokens';

export function SavedPage() {
  const { loading } = useRequirePortalAuth();
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<FeedJob[]>([]);
  const [ready, setReady] = useState(false);
  const [search, setSearch] = useState('');
  const [company, setCompany] = useState('');

  const load = () =>
    listSaved().then((list) => {
      setJobs(list);
      setReady(true);
    });

  useEffect(() => {
    if (loading) return;
    load();
  }, [loading]);

  const companies = useMemo(
    () => Array.from(new Set(jobs.map((j) => j.company))).sort(),
    [jobs],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return jobs.filter((j) => {
      const matchQ = !q || j.title.toLowerCase().includes(q) || j.company.toLowerCase().includes(q);
      return matchQ && (!company || j.company === company);
    });
  }, [jobs, search, company]);

  if (loading) return null;

  return (
    <Box>
      <PageHeader
        eyebrow="My library"
        title="Saved jobs"
        subtitle="Roles you bookmarked from your feed. Saved jobs stay here even after they drop out of the refresh window."
        meta={
          ready ? (
            <Chip
              label={`${jobs.length} ${pluralize(jobs.length, 'job')} saved`}
              size="small"
              sx={{
                borderRadius: RADIUS.pill,
                fontWeight: 600,
                bgcolor: tint(FIRSTSTEP.teal, 0.13),
                color: FIRSTSTEP.tealDark,
              }}
            />
          ) : undefined
        }
      />

      {ready && jobs.length > 0 && (
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mb: 2 }}>
          <TextField
            size="small"
            placeholder="Search saved jobs…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            sx={{
              flex: 1,
              maxWidth: { sm: 340 },
              '& .MuiOutlinedInput-root': { borderRadius: RADIUS.pill, bgcolor: FIRSTSTEP.white },
            }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchOutlined sx={{ fontSize: 18, color: FIRSTSTEP.textMuted }} />
                </InputAdornment>
              ),
            }}
          />
          <Stack direction="row" flexWrap="wrap" gap={0.75}>
            {['', ...companies].slice(0, 7).map((c) => {
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
                    border: `1px solid ${active ? FIRSTSTEP.teal : FIRSTSTEP.border}`,
                    bgcolor: active ? tint(FIRSTSTEP.teal, 0.16) : FIRSTSTEP.white,
                    color: active ? FIRSTSTEP.tealDark : FIRSTSTEP.textMuted,
                  }}
                />
              );
            })}
          </Stack>
        </Stack>
      )}

      {!ready ? (
        <JobListSkeleton count={4} />
      ) : jobs.length === 0 ? (
        <EmptyState
          icon={BookmarkBorder}
          title="No saved jobs yet"
          description="Tap the bookmark icon on any job in your feed to keep it here for later."
          actionLabel="Open my feed"
          actionTo="/user/feed"
          secondaryLabel="Browse clusters"
          secondaryTo="/user/clusters"
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={SearchOffOutlined}
          variant="filtered"
          title="Nothing matches that search"
          description="Try a different keyword or switch back to all companies."
          actionLabel="Clear filters"
          onAction={() => {
            setSearch('');
            setCompany('');
          }}
        />
      ) : (
        <>
          {filtered.length !== jobs.length && (
            <Typography variant="body2" sx={{ color: FIRSTSTEP.textMuted, mb: 1.5 }}>
              {filtered.length} of {jobs.length} shown
            </Typography>
          )}
          <Stack spacing={1.5}>
            {filtered.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                showCluster
                onOpen={(id) => navigate(`/user/jobs/${id}`)}
                onUnsave={async (id) => {
                  await unsaveJob(id);
                  load();
                }}
              />
            ))}
          </Stack>
        </>
      )}
    </Box>
  );
}
