import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Link,
  Stack,
  Typography,
} from '@mui/material';
import CheckCircleOutline from '@mui/icons-material/CheckCircleOutline';
import FlagOutlined from '@mui/icons-material/FlagOutlined';
import OpenInNew from '@mui/icons-material/OpenInNew';
import PersonOutline from '@mui/icons-material/PersonOutline';
import RefreshIcon from '@mui/icons-material/Refresh';
import ScheduleOutlined from '@mui/icons-material/ScheduleOutlined';
import {
  adminListJobReports,
  adminUpdateJobReport,
  type JobReportRow,
} from '../api/adminClusters';
import { useGlobalInfoStore } from '../context/globalInfo';
import { OpsHeroBackdrop } from '../components/dashboard/ops/OpsHeroBackdrop';
import {
  FIRSTSTEP,
  RADIUS,
  cardSx,
  heroGlassOverlineSx,
  heroGlassPanelSx,
  heroGlassSubtitleSx,
  heroGlassTitleSx,
  tint,
} from '../components/dashboard/ops/dashboardTokens';

const REASON_LABEL: Record<JobReportRow['reason'], string> = {
  incorrect_company: 'Incorrect company',
  incorrect_category: 'Incorrect category',
  old_job: 'Old job',
  other: 'Other',
};

const REASON_TONE: Record<JobReportRow['reason'], { bg: string; fg: string }> = {
  incorrect_company: { bg: tint(FIRSTSTEP.danger, 0.1), fg: FIRSTSTEP.danger },
  incorrect_category: { bg: tint(FIRSTSTEP.teal, 0.14), fg: FIRSTSTEP.tealDeep },
  old_job: { bg: tint(FIRSTSTEP.warning, 0.16), fg: '#8a5a00' },
  other: { bg: tint(FIRSTSTEP.navy, 0.08), fg: FIRSTSTEP.navy },
};

const STATUS_FILTERS: { value: 'open' | 'reviewed' | 'all'; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'reviewed', label: 'Reviewed' },
  { value: 'all', label: 'All' },
];

function formatWhen(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function jobHeadline(r: JobReportRow): string {
  const title = String(r.title || '').trim();
  if (title) return title;
  try {
    if (r.jobUrl) return new URL(r.jobUrl).hostname.replace(/^www\./, '');
  } catch {
    /* ignore */
  }
  return 'Untitled listing';
}

export function JobReportsPage() {
  const { notify } = useGlobalInfoStore();
  const [status, setStatus] = useState<'open' | 'reviewed' | 'all'>('open');
  const [reports, setReports] = useState<JobReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await adminListJobReports(status);
      setReports(data.reports || []);
    } catch (err: any) {
      notify('error', err?.response?.data?.error || err?.message || 'Failed to load reports');
    } finally {
      setLoading(false);
    }
  }, [status, notify]);

  useEffect(() => {
    void load();
  }, [load]);

  const markReviewed = async (id: string) => {
    setUpdatingId(id);
    try {
      await adminUpdateJobReport(id, 'reviewed');
      notify('success', 'Marked as reviewed');
      await load();
    } catch (err: any) {
      notify('error', err?.response?.data?.error || err?.message || 'Update failed');
    } finally {
      setUpdatingId(null);
    }
  };

  const openCount = useMemo(
    () => reports.filter((r) => r.status === 'open').length,
    [reports],
  );

  return (
    <Box sx={{ p: { xs: 2, md: 2.5 }, width: '100%' }}>
      <Box sx={{ ...heroGlassPanelSx({ mb: 2.5, shadow: 'soft' }), p: { xs: 2.25, md: 3 } }}>
        <OpsHeroBackdrop>
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            justifyContent="space-between"
            alignItems={{ md: 'flex-start' }}
            spacing={2}
          >
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="overline" sx={heroGlassOverlineSx}>
                ScoutX feedback
              </Typography>
              <Typography sx={heroGlassTitleSx('md')}>Job reports</Typography>
              <Typography sx={{ ...heroGlassSubtitleSx, maxWidth: 520, fontSize: '0.9rem' }}>
                Review flags from portal users on incorrect companies, categories, or stale
                listings — then mark them reviewed when handled.
              </Typography>
              {!loading && (
                <Stack direction="row" spacing={1} sx={{ mt: 1.75 }} flexWrap="wrap" useFlexGap>
                  <Chip
                    size="small"
                    icon={<FlagOutlined sx={{ fontSize: '16px !important' }} />}
                    label={`${reports.length} in this view`}
                    sx={{
                      height: 28,
                      borderRadius: RADIUS.pill,
                      fontWeight: 700,
                      bgcolor: tint(FIRSTSTEP.teal, 0.12),
                      color: FIRSTSTEP.navy,
                      '& .MuiChip-icon': { color: FIRSTSTEP.tealDeep },
                    }}
                  />
                  {status !== 'reviewed' && (
                    <Chip
                      size="small"
                      label={`${openCount} open`}
                      sx={{
                        height: 28,
                        borderRadius: RADIUS.pill,
                        fontWeight: 700,
                        bgcolor: tint(FIRSTSTEP.warning, 0.16),
                        color: '#8a5a00',
                      }}
                    />
                  )}
                </Stack>
              )}
            </Box>

            <Stack direction="row" spacing={1} alignItems="center" flexShrink={0}>
              <Button
                variant="outlined"
                size="small"
                startIcon={<RefreshIcon />}
                onClick={() => void load()}
                disabled={loading}
                sx={{
                  textTransform: 'none',
                  fontWeight: 700,
                  borderRadius: RADIUS.control,
                  borderColor: FIRSTSTEP.border,
                  color: FIRSTSTEP.navy,
                  bgcolor: FIRSTSTEP.white,
                  px: 1.5,
                  '&:hover': { borderColor: FIRSTSTEP.teal, bgcolor: tint(FIRSTSTEP.teal, 0.06) },
                }}
              >
                Refresh
              </Button>
            </Stack>
          </Stack>
        </OpsHeroBackdrop>
      </Box>

      <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
        {STATUS_FILTERS.map((f) => {
          const active = status === f.value;
          return (
            <Chip
              key={f.value}
              label={f.label}
              onClick={() => setStatus(f.value)}
              sx={{
                height: 36,
                borderRadius: RADIUS.pill,
                fontWeight: 700,
                fontSize: '0.8125rem',
                px: 0.5,
                bgcolor: active ? FIRSTSTEP.navy : FIRSTSTEP.white,
                color: active ? '#fff' : FIRSTSTEP.navy,
                border: active ? 'none' : `1px solid ${FIRSTSTEP.border}`,
                '&:hover': {
                  bgcolor: active ? FIRSTSTEP.navyDeep : tint(FIRSTSTEP.teal, 0.08),
                },
              }}
            />
          );
        })}
      </Stack>

      {loading ? (
        <Box
          sx={{
            ...cardSx,
            display: 'grid',
            placeItems: 'center',
            py: 10,
          }}
        >
          <CircularProgress size={28} sx={{ color: FIRSTSTEP.teal }} />
        </Box>
      ) : reports.length === 0 ? (
        <Box sx={{ ...cardSx, py: 8, px: 3 }}>
          <Stack alignItems="center" spacing={1.25} sx={{ color: FIRSTSTEP.textMuted, textAlign: 'center' }}>
            <Box
              sx={{
                width: 56,
                height: 56,
                borderRadius: '50%',
                display: 'grid',
                placeItems: 'center',
                bgcolor: tint(FIRSTSTEP.teal, 0.12),
                color: FIRSTSTEP.tealDeep,
                mb: 0.5,
              }}
            >
              <FlagOutlined sx={{ fontSize: 28 }} />
            </Box>
            <Typography sx={{ fontWeight: 700, fontSize: '1.05rem', color: FIRSTSTEP.navy }}>
              No {status === 'all' ? '' : status} reports
            </Typography>
            <Typography sx={{ fontSize: '0.875rem', maxWidth: 360 }}>
              {status === 'open'
                ? 'Inbox is clear. New flags from ScoutX users will show up here.'
                : 'Nothing matches this filter. Try Open or All.'}
            </Typography>
          </Stack>
        </Box>
      ) : (
        <Stack spacing={1.5}>
          {reports.map((r) => {
            const tone = REASON_TONE[r.reason] || REASON_TONE.other;
            const isOpen = r.status === 'open';
            return (
              <Box
                key={r.id}
                sx={{
                  ...cardSx,
                  p: { xs: 2, md: 2.25 },
                  borderLeft: `3px solid ${isOpen ? FIRSTSTEP.warning : FIRSTSTEP.success}`,
                  transition: 'box-shadow 0.15s ease, border-color 0.15s ease',
                  '&:hover': {
                    boxShadow: '0 8px 24px rgba(2, 51, 69, 0.08)',
                  },
                }}
              >
                <Stack
                  direction={{ xs: 'column', md: 'row' }}
                  spacing={2}
                  justifyContent="space-between"
                  alignItems={{ md: 'flex-start' }}
                >
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
                      <Chip
                        size="small"
                        label={REASON_LABEL[r.reason] || r.reason}
                        sx={{
                          height: 28,
                          borderRadius: RADIUS.pill,
                          fontWeight: 700,
                          fontSize: '0.75rem',
                          px: 0.5,
                          bgcolor: tone.bg,
                          color: tone.fg,
                        }}
                      />
                      <Chip
                        size="small"
                        label={isOpen ? 'Open' : 'Reviewed'}
                        sx={{
                          height: 28,
                          borderRadius: RADIUS.pill,
                          fontWeight: 700,
                          fontSize: '0.75rem',
                          bgcolor: isOpen
                            ? tint(FIRSTSTEP.warning, 0.18)
                            : tint(FIRSTSTEP.success, 0.16),
                          color: isOpen ? '#8a5a00' : FIRSTSTEP.successDeep,
                        }}
                      />
                    </Stack>

                    <Typography
                      sx={{
                        fontWeight: 700,
                        fontSize: '1.05rem',
                        color: FIRSTSTEP.navy,
                        letterSpacing: '-0.01em',
                        lineHeight: 1.35,
                      }}
                    >
                      {jobHeadline(r)}
                    </Typography>
                    {(r.company || '').trim() && (
                      <Typography sx={{ mt: 0.35, fontSize: '0.875rem', fontWeight: 600, color: FIRSTSTEP.textMuted }}>
                        {r.company}
                      </Typography>
                    )}

                    {r.note && (
                      <Typography
                        sx={{
                          mt: 1.25,
                          p: 1.25,
                          borderRadius: RADIUS.control,
                          bgcolor: FIRSTSTEP.surfaceAlt,
                          border: `1px solid ${FIRSTSTEP.border}`,
                          fontSize: '0.8125rem',
                          color: FIRSTSTEP.navy,
                          lineHeight: 1.5,
                          fontStyle: 'italic',
                        }}
                      >
                        “{r.note}”
                      </Typography>
                    )}

                    <Stack
                      direction="row"
                      flexWrap="wrap"
                      gap={1.5}
                      useFlexGap
                      sx={{ mt: 1.5, color: FIRSTSTEP.textMuted, fontSize: '0.78rem' }}
                    >
                      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.4 }}>
                        <ScheduleOutlined sx={{ fontSize: 16 }} />
                        {formatWhen(r.createdAt)}
                      </Box>
                      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.4 }}>
                        <PersonOutline sx={{ fontSize: 16 }} />
                        {r.reporterName || r.reporterEmail || 'Unknown reporter'}
                      </Box>
                      {r.jobUrl && (
                        <Link
                          href={r.jobUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          underline="hover"
                          sx={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 0.35,
                            fontSize: '0.78rem',
                            fontWeight: 700,
                            color: FIRSTSTEP.tealDeep,
                          }}
                        >
                          Open posting
                          <OpenInNew sx={{ fontSize: 14 }} />
                        </Link>
                      )}
                    </Stack>
                  </Box>

                  <Box sx={{ flexShrink: 0, alignSelf: { xs: 'stretch', md: 'center' } }}>
                    {isOpen ? (
                      <Button
                        variant="contained"
                        disableElevation
                        disabled={updatingId === r.id}
                        startIcon={<CheckCircleOutline />}
                        onClick={() => void markReviewed(r.id)}
                        sx={{
                          textTransform: 'none',
                          fontWeight: 700,
                          borderRadius: RADIUS.control,
                          bgcolor: FIRSTSTEP.navy,
                          px: 2,
                          py: 1,
                          width: { xs: '100%', md: 'auto' },
                          '&:hover': { bgcolor: FIRSTSTEP.navyDeep },
                        }}
                      >
                        {updatingId === r.id ? 'Saving…' : 'Mark reviewed'}
                      </Button>
                    ) : (
                      <Stack spacing={0.25} alignItems={{ xs: 'flex-start', md: 'flex-end' }}>
                        <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: FIRSTSTEP.successDeep }}>
                          Reviewed
                        </Typography>
                        <Typography sx={{ fontSize: '0.75rem', color: FIRSTSTEP.textMuted }}>
                          {r.reviewedBy || formatWhen(r.reviewedAt)}
                        </Typography>
                      </Stack>
                    )}
                  </Box>
                </Stack>
              </Box>
            );
          })}
        </Stack>
      )}
    </Box>
  );
}
