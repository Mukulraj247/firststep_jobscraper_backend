import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  alpha,
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Drawer,
  FormControl,
  IconButton,
  InputAdornment,
  InputLabel,
  MenuItem,
  Pagination,
  Select,
  Stack,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import {
  AccessTime,
  ArrowForward,
  BusinessOutlined,
  CategoryOutlined,
  Close,
  LocationOnOutlined,
  OpenInNew,
  PaymentsOutlined,
  Search,
  WorkOutline,
} from '@mui/icons-material';
import { getJob, listJobs, JobBoardJob, JobBoardFilters } from '../../api/jobs';

const ACCENT = '#ff00c3';
const TEAL = '#023345';

const AVATAR_PALETTE = [
  '#0e7490',
  '#0369a1',
  '#0f766e',
  '#1d4ed8',
  '#b45309',
  '#be123c',
  '#6d28d9',
  '#047857',
];

const asText = (value: unknown): string => {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
};

const companyInitials = (name: string): string => {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase();
};

const colorForCompany = (name: string): string => {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
};

const formatPosted = (value: unknown): string => {
  const raw = asText(value);
  if (!raw) return '';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

const formatRelative = (value: unknown): string => {
  const raw = asText(value);
  if (!raw) return '';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  const diffMs = Date.now() - d.getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days < 0) return formatPosted(value);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return formatPosted(value);
};

const snippet = (text: string, max = 140): string => {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max).trim()}…`;
};

const CompanyAvatar: React.FC<{ name: string; size?: number }> = ({ name, size = 44 }) => {
  const bg = colorForCompany(name || 'Company');
  return (
    <Avatar
      sx={{
        width: size,
        height: size,
        bgcolor: bg,
        fontWeight: 700,
        fontSize: size > 48 ? '1.15rem' : '0.85rem',
        letterSpacing: 0.4,
        flexShrink: 0,
        boxShadow: `0 8px 18px ${alpha(bg, 0.28)}`,
      }}
    >
      {companyInitials(name || '?')}
    </Avatar>
  );
};

const SoftChip: React.FC<{
  icon?: React.ReactElement;
  label: string;
  tone?: 'neutral' | 'teal' | 'accent';
}> = ({ icon, label, tone = 'neutral' }) => {
  const colors =
    tone === 'teal'
      ? { bg: alpha(TEAL, 0.08), fg: TEAL, border: alpha(TEAL, 0.14) }
      : tone === 'accent'
        ? { bg: alpha(ACCENT, 0.08), fg: '#b8008f', border: alpha(ACCENT, 0.18) }
        : { bg: alpha('#0f172a', 0.04), fg: '#475569', border: alpha('#0f172a', 0.08) };

  return (
    <Chip
      size="small"
      icon={icon}
      label={label}
      sx={{
        height: 26,
        bgcolor: colors.bg,
        color: colors.fg,
        border: `1px solid ${colors.border}`,
        fontWeight: 560,
        fontSize: '0.75rem',
        '& .MuiChip-icon': { color: 'inherit', ml: 0.5 },
        '& .MuiChip-label': { px: 1 },
      }}
    />
  );
};

const JobCard: React.FC<{
  job: JobBoardJob;
  selected: boolean;
  onSelect: () => void;
}> = ({ job, selected, onSelect }) => {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const data = job.data || {};
  const title = asText(data.jobTitle) || 'Untitled role';
  const company = asText(data.companyName) || 'Unknown company';
  const location = asText(data.location);
  const salary = asText(data.salaryRange);
  const employment = asText(data.employmentType);
  const remote = asText(data.remoteType);
  const category = asText(data.jobCategory);
  const desc = snippet(asText(data.jobDescription));
  const posted = formatRelative(data.date || job.createdAt);

  return (
    <Box
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      sx={{
        cursor: 'pointer',
        position: 'relative',
        borderRadius: 3,
        border: '1px solid',
        borderColor: selected
          ? alpha(ACCENT, 0.55)
          : isDark
            ? alpha('#fff', 0.08)
            : alpha(TEAL, 0.1),
        bgcolor: selected
          ? isDark
            ? alpha(ACCENT, 0.08)
            : alpha(ACCENT, 0.03)
          : isDark
            ? alpha('#fff', 0.03)
            : '#fff',
        p: 2,
        overflow: 'hidden',
        transition: 'border-color 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease, background 0.18s ease',
        boxShadow: selected
          ? `0 12px 28px ${alpha(TEAL, 0.1)}`
          : `0 1px 2px ${alpha('#0f172a', 0.04)}`,
        '&::before': selected
          ? {
              content: '""',
              position: 'absolute',
              left: 0,
              top: 10,
              bottom: 10,
              width: 3,
              borderRadius: 999,
              bgcolor: ACCENT,
            }
          : undefined,
        '&:hover': {
          borderColor: alpha(ACCENT, 0.45),
          transform: 'translateY(-2px)',
          boxShadow: `0 14px 30px ${alpha(TEAL, 0.12)}`,
        },
      }}
    >
      <Stack direction="row" spacing={1.75} alignItems="flex-start">
        <CompanyAvatar name={company} />
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start" gap={1}>
            <Box sx={{ minWidth: 0 }}>
              <Typography
                sx={{
                  fontWeight: 750,
                  fontSize: '1rem',
                  lineHeight: 1.3,
                  letterSpacing: '-0.01em',
                  mb: 0.35,
                }}
              >
                {title}
              </Typography>
              <Typography
                variant="body2"
                sx={{ color: isDark ? 'text.secondary' : TEAL, fontWeight: 600, mb: 0.75 }}
              >
                {company}
              </Typography>
            </Box>
            <Stack alignItems="flex-end" spacing={0.75} sx={{ flexShrink: 0 }}>
              {posted && (
                <Stack direction="row" spacing={0.4} alignItems="center">
                  <AccessTime sx={{ fontSize: 14, color: 'text.disabled' }} />
                  <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
                    {posted}
                  </Typography>
                </Stack>
              )}
              <Chip
                size="small"
                label={job.scraperName}
                sx={{
                  maxWidth: 120,
                  height: 22,
                  fontSize: '0.68rem',
                  bgcolor: alpha(TEAL, isDark ? 0.2 : 0.06),
                  color: isDark ? 'text.secondary' : TEAL,
                  '& .MuiChip-label': { px: 0.9, overflow: 'hidden', textOverflow: 'ellipsis' },
                }}
              />
            </Stack>
          </Stack>

          {desc && (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ mb: 1.1, lineHeight: 1.5, display: { xs: 'none', sm: 'block' } }}
            >
              {desc}
            </Typography>
          )}

          <Stack direction="row" flexWrap="wrap" gap={0.75}>
            {location && (
              <SoftChip
                icon={<LocationOnOutlined sx={{ fontSize: '15px !important' }} />}
                label={location}
              />
            )}
            {salary && (
              <SoftChip
                icon={<PaymentsOutlined sx={{ fontSize: '15px !important' }} />}
                label={salary}
                tone="accent"
              />
            )}
            {remote && <SoftChip label={remote} tone="teal" />}
            {employment && <SoftChip label={employment} />}
            {category && <SoftChip label={category} />}
            {!location && !salary && !remote && !employment && !category && (
              <SoftChip icon={<BusinessOutlined sx={{ fontSize: '15px !important' }} />} label={company} />
            )}
          </Stack>
        </Box>
      </Stack>
    </Box>
  );
};

const MetaTile: React.FC<{ icon: React.ReactNode; label: string; value: string }> = ({
  icon,
  label,
  value,
}) => {
  if (!value) return null;
  return (
    <Box
      sx={{
        p: 1.25,
        borderRadius: 2,
        bgcolor: (theme) =>
          theme.palette.mode === 'dark' ? alpha('#fff', 0.04) : alpha(TEAL, 0.035),
        border: '1px solid',
        borderColor: (theme) =>
          theme.palette.mode === 'dark' ? alpha('#fff', 0.06) : alpha(TEAL, 0.08),
        minHeight: 72,
      }}
    >
      <Stack direction="row" spacing={0.75} alignItems="center" mb={0.5}>
        <Box sx={{ color: 'text.disabled', display: 'flex', fontSize: 16 }}>{icon}</Box>
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
          {label}
        </Typography>
      </Stack>
      <Typography variant="body2" sx={{ fontWeight: 650, lineHeight: 1.35 }}>
        {value}
      </Typography>
    </Box>
  );
};

const JobDetailPanel: React.FC<{
  job: JobBoardJob | null;
  loading: boolean;
  onClose: () => void;
  showClose?: boolean;
}> = ({ job, loading, onClose, showClose = true }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', p: 4 }}>
        <CircularProgress size={32} />
      </Box>
    );
  }

  if (!job) {
    return (
      <Box
        sx={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          p: 4,
          textAlign: 'center',
        }}
      >
        <Box
          sx={{
            width: 72,
            height: 72,
            borderRadius: '50%',
            bgcolor: alpha(TEAL, 0.06),
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            mb: 2,
          }}
        >
          <WorkOutline sx={{ fontSize: 32, color: alpha(TEAL, 0.45) }} />
        </Box>
        <Typography sx={{ fontWeight: 700, mb: 0.5 }}>Pick a role</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 240 }}>
          Select a listing on the left to preview details and apply.
        </Typography>
      </Box>
    );
  }

  const data = job.data || {};
  const title = asText(data.jobTitle) || 'Untitled role';
  const company = asText(data.companyName) || 'Unknown company';
  const url = asText(data.jobUrl);
  const description = asText(data.jobDescription);
  const location = asText(data.location);
  const salary = asText(data.salaryRange);
  const employment = asText(data.employmentType);
  const remote = asText(data.remoteType);
  const category = asText(data.jobCategory);
  const experience =
    typeof data.jobExperience === 'number' && data.jobExperience > 0
      ? t('jobboard.years', { count: data.jobExperience })
      : '';

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Box
        sx={{
          position: 'relative',
          px: 2.75,
          pt: 2.75,
          pb: 2.25,
          background: isDark
            ? `linear-gradient(145deg, ${alpha('#0e7490', 0.22)} 0%, ${alpha('#023345', 0.35)} 100%)`
            : `linear-gradient(145deg, ${alpha('#e0f2fe', 0.95)} 0%, ${alpha('#f0fdfa', 0.9)} 55%, ${alpha('#fff', 0.6)} 100%)`,
          borderBottom: '1px solid',
          borderColor: isDark ? alpha('#fff', 0.06) : alpha(TEAL, 0.08),
        }}
      >
        {showClose && (
          <IconButton
            aria-label="Close"
            onClick={onClose}
            size="small"
            sx={{ position: 'absolute', top: 10, right: 10 }}
          >
            <Close fontSize="small" />
          </IconButton>
        )}

        <Stack direction="row" spacing={2} alignItems="flex-start">
          <CompanyAvatar name={company} size={56} />
          <Box sx={{ minWidth: 0, flex: 1, pr: showClose ? 3 : 0 }}>
            <Typography
              sx={{
                fontWeight: 800,
                fontSize: '1.35rem',
                letterSpacing: '-0.02em',
                lineHeight: 1.25,
                mb: 0.5,
              }}
            >
              {title}
            </Typography>
            <Typography sx={{ fontWeight: 650, color: isDark ? 'text.secondary' : TEAL, mb: 1.25 }}>
              {company}
            </Typography>
            <Stack direction="row" flexWrap="wrap" gap={0.75}>
              {location && (
                <SoftChip icon={<LocationOnOutlined sx={{ fontSize: '15px !important' }} />} label={location} />
              )}
              {salary && (
                <SoftChip
                  icon={<PaymentsOutlined sx={{ fontSize: '15px !important' }} />}
                  label={salary}
                  tone="accent"
                />
              )}
              {remote && <SoftChip label={remote} tone="teal" />}
              {employment && <SoftChip label={employment} />}
            </Stack>
          </Box>
        </Stack>
      </Box>

      <Box sx={{ flex: 1, overflowY: 'auto', px: 2.75, py: 2.25 }}>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 1,
            mb: 2.5,
          }}
        >
          <MetaTile
            icon={<AccessTime fontSize="inherit" />}
            label={t('jobboard.posted')}
            value={formatPosted(data.date) || formatRelative(job.createdAt)}
          />
          <MetaTile
            icon={<CategoryOutlined fontSize="inherit" />}
            label={t('jobboard.category')}
            value={category}
          />
          <MetaTile
            icon={<WorkOutline fontSize="inherit" />}
            label={t('jobboard.experience')}
            value={experience}
          />
          <MetaTile
            icon={<BusinessOutlined fontSize="inherit" />}
            label={t('jobboard.industry')}
            value={asText(data.sectorIndustry)}
          />
          <MetaTile
            icon={<BusinessOutlined fontSize="inherit" />}
            label={t('jobboard.filter_scraper')}
            value={job.scraperName}
          />
          <MetaTile
            icon={<CategoryOutlined fontSize="inherit" />}
            label={t('jobboard.job_id')}
            value={asText(data.jobId)}
          />
        </Box>

        <Typography
          variant="overline"
          sx={{
            display: 'block',
            fontWeight: 750,
            letterSpacing: 1.1,
            color: 'text.secondary',
            mb: 1,
          }}
        >
          {t('jobboard.description')}
        </Typography>

        {description ? (
          <Typography
            variant="body2"
            sx={{
              whiteSpace: 'pre-wrap',
              lineHeight: 1.7,
              color: 'text.primary',
            }}
          >
            {description}
          </Typography>
        ) : (
          <Box
            sx={{
              p: 2,
              borderRadius: 2,
              border: '1px dashed',
              borderColor: 'divider',
              bgcolor: (t) => (t.palette.mode === 'dark' ? alpha('#fff', 0.02) : alpha(TEAL, 0.02)),
            }}
          >
            <Typography variant="body2" color="text.secondary">
              {t('jobboard.no_description')}
            </Typography>
            <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mt: 0.5 }}>
              Open the listing or re-run the scraper to capture a fuller description.
            </Typography>
          </Box>
        )}
      </Box>

      <Divider />
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1}
        sx={{
          p: 2,
          bgcolor: (t) => (t.palette.mode === 'dark' ? alpha('#000', 0.2) : alpha(TEAL, 0.02)),
        }}
      >
        {url ? (
          <Button
            variant="contained"
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            endIcon={<OpenInNew />}
            fullWidth
            sx={{
              bgcolor: ACCENT,
              textTransform: 'none',
              fontWeight: 700,
              py: 1.1,
              borderRadius: 2,
              boxShadow: `0 10px 24px ${alpha(ACCENT, 0.28)}`,
              '&:hover': { bgcolor: '#d600a3' },
            }}
          >
            {t('jobboard.apply')}
          </Button>
        ) : (
          <Button variant="contained" disabled fullWidth sx={{ textTransform: 'none', borderRadius: 2 }}>
            No apply link
          </Button>
        )}
        <Button
          variant="outlined"
          onClick={() => navigate(`/automation/${job.robotMetaId}/data`)}
          endIcon={<ArrowForward />}
          sx={{
            textTransform: 'none',
            fontWeight: 600,
            borderRadius: 2,
            borderColor: alpha(TEAL, 0.25),
            color: TEAL,
            whiteSpace: 'nowrap',
            '&:hover': { borderColor: TEAL, bgcolor: alpha(TEAL, 0.04) },
          }}
        >
          {t('jobboard.view_scraper_data')}
        </Button>
      </Stack>
    </Box>
  );
};

export const JobBoardPage: React.FC = () => {
  const { t } = useTranslation();
  const theme = useTheme();
  const navigate = useNavigate();
  const isNarrow = useMediaQuery(theme.breakpoints.down('md'));
  const isDark = theme.palette.mode === 'dark';

  const [jobs, setJobs] = useState<JobBoardJob[]>([]);
  const [filters, setFilters] = useState<JobBoardFilters>({
    companies: [],
    categories: [],
    scrapers: [],
  });
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [q, setQ] = useState('');
  const [company, setCompany] = useState('');
  const [category, setCategory] = useState('');
  const [robotMetaId, setRobotMetaId] = useState('');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedJob, setSelectedJob] = useState<JobBoardJob | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setQ(searchInput.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(handle);
  }, [searchInput]);

  const loadJobs = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await listJobs({
        page,
        limit: 20,
        q: q || undefined,
        company: company || undefined,
        category: category || undefined,
        robotMetaId: robotMetaId || undefined,
      });
      setJobs(result.jobs);
      setPagination(result.pagination);
      setFilters(result.filters);
      if (result.jobs.length > 0) {
        const stillVisible = selectedId && result.jobs.some((j) => j.id === selectedId);
        if (!stillVisible && !isNarrow) {
          setSelectedId(result.jobs[0].id);
        }
      } else {
        setSelectedId(null);
        setSelectedJob(null);
      }
    } catch {
      setError(t('jobboard.load_error'));
      setJobs([]);
    } finally {
      setLoading(false);
    }
  }, [page, q, company, category, robotMetaId, t, selectedId, isNarrow]);

  useEffect(() => {
    void loadJobs();
  }, [page, q, company, category, robotMetaId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selectedId) {
      setSelectedJob(null);
      return;
    }
    const fromList = jobs.find((j) => j.id === selectedId);
    if (fromList) {
      setSelectedJob(fromList);
    }
    let cancelled = false;
    setDetailLoading(true);
    getJob(selectedId)
      .then((job) => {
        if (!cancelled) setSelectedJob(job);
      })
      .catch(() => {
        /* keep list snapshot */
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, jobs]);

  const subtitle = useMemo(() => {
    if (pagination.total === 0) return t('jobboard.heading_subtitle_empty');
    return t('jobboard.heading_subtitle', { count: pagination.total.toLocaleString() });
  }, [pagination.total, t]);

  const handleSelect = (id: string) => {
    setSelectedId(id);
    if (isNarrow) setDrawerOpen(true);
  };

  const handleCloseDetail = () => {
    setDrawerOpen(false);
    if (isNarrow) setSelectedId(null);
  };

  const detailContent = (
    <JobDetailPanel
      job={selectedJob}
      loading={detailLoading && !selectedJob}
      onClose={handleCloseDetail}
      showClose={isNarrow}
    />
  );

  const filterSx = {
    minWidth: { xs: '100%', sm: 150 },
    bgcolor: isDark ? alpha('#fff', 0.04) : '#fff',
    borderRadius: 2,
    '& .MuiOutlinedInput-notchedOutline': {
      borderColor: isDark ? alpha('#fff', 0.1) : alpha(TEAL, 0.12),
    },
  };

  return (
    <Box
      sx={{
        minHeight: '100%',
        boxSizing: 'border-box',
        position: 'relative',
        background: isDark
          ? `radial-gradient(1200px 500px at 10% -10%, ${alpha('#0e7490', 0.18)}, transparent 60%),
             radial-gradient(900px 400px at 90% 0%, ${alpha(ACCENT, 0.08)}, transparent 55%),
             ${theme.palette.background.default}`
          : `radial-gradient(1100px 480px at 8% -8%, ${alpha('#bae6fd', 0.55)}, transparent 55%),
             radial-gradient(900px 420px at 92% 0%, ${alpha(ACCENT, 0.06)}, transparent 50%),
             linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%)`,
        p: { xs: 2, md: 3.5 },
      }}
    >
      <Box
        sx={{
          mb: 2.5,
          p: { xs: 2, md: 2.5 },
          borderRadius: 3,
          border: '1px solid',
          borderColor: isDark ? alpha('#fff', 0.08) : alpha(TEAL, 0.08),
          bgcolor: isDark ? alpha('#0b1220', 0.55) : alpha('#fff', 0.72),
          backdropFilter: 'blur(10px)',
          boxShadow: `0 10px 30px ${alpha(TEAL, 0.05)}`,
        }}
      >
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          justifyContent="space-between"
          alignItems={{ xs: 'stretch', md: 'center' }}
          gap={2}
          mb={2}
        >
          <Box>
            <Stack direction="row" alignItems="center" spacing={1.25} mb={0.5}>
              <Typography
                sx={{
                  fontWeight: 800,
                  fontSize: { xs: '1.45rem', md: '1.7rem' },
                  letterSpacing: '-0.03em',
                  lineHeight: 1.15,
                }}
              >
                {t('jobboard.heading')}
              </Typography>
              {pagination.total > 0 && (
                <Chip
                  label={pagination.total.toLocaleString()}
                  size="small"
                  sx={{
                    height: 24,
                    fontWeight: 700,
                    bgcolor: alpha(ACCENT, 0.1),
                    color: '#b8008f',
                    border: `1px solid ${alpha(ACCENT, 0.18)}`,
                  }}
                />
              )}
            </Stack>
            <Typography variant="body2" color="text.secondary">
              {subtitle}
            </Typography>
          </Box>

          <TextField
            size="small"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={t('jobboard.search')}
            sx={{
              minWidth: { xs: '100%', md: 320 },
              bgcolor: isDark ? alpha('#fff', 0.04) : '#fff',
              borderRadius: 2,
              '& .MuiOutlinedInput-root': { borderRadius: 2 },
            }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <Search fontSize="small" sx={{ color: 'text.disabled' }} />
                </InputAdornment>
              ),
            }}
          />
        </Stack>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25} flexWrap="wrap" useFlexGap>
          <FormControl size="small" sx={filterSx}>
            <InputLabel>{t('jobboard.filter_company')}</InputLabel>
            <Select
              label={t('jobboard.filter_company')}
              value={company}
              onChange={(e) => {
                setCompany(String(e.target.value));
                setPage(1);
              }}
            >
              <MenuItem value="">{t('jobboard.filter_all')}</MenuItem>
              {filters.companies.map((c) => (
                <MenuItem key={c} value={c}>
                  {c}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" sx={filterSx}>
            <InputLabel>{t('jobboard.filter_category')}</InputLabel>
            <Select
              label={t('jobboard.filter_category')}
              value={category}
              onChange={(e) => {
                setCategory(String(e.target.value));
                setPage(1);
              }}
            >
              <MenuItem value="">{t('jobboard.filter_all')}</MenuItem>
              {filters.categories.map((c) => (
                <MenuItem key={c} value={c}>
                  {c}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" sx={filterSx}>
            <InputLabel>{t('jobboard.filter_scraper')}</InputLabel>
            <Select
              label={t('jobboard.filter_scraper')}
              value={robotMetaId}
              onChange={(e) => {
                setRobotMetaId(String(e.target.value));
                setPage(1);
              }}
            >
              <MenuItem value="">{t('jobboard.filter_all')}</MenuItem>
              {filters.scrapers.map((s) => (
                <MenuItem key={s.id} value={s.id}>
                  {s.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Stack>
      </Box>

      {error && (
        <Typography color="error" sx={{ mb: 2 }}>
          {error}
        </Typography>
      )}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 10 }}>
          <CircularProgress />
        </Box>
      ) : jobs.length === 0 ? (
        <Box
          sx={{
            textAlign: 'center',
            py: 10,
            px: 3,
            borderRadius: 3,
            border: '1px dashed',
            borderColor: isDark ? alpha('#fff', 0.12) : alpha(TEAL, 0.18),
            bgcolor: isDark ? alpha('#fff', 0.02) : alpha('#fff', 0.7),
          }}
        >
          <Box
            sx={{
              width: 72,
              height: 72,
              borderRadius: '50%',
              mx: 'auto',
              mb: 2,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              bgcolor: alpha(ACCENT, 0.08),
            }}
          >
            <WorkOutline sx={{ fontSize: 34, color: ACCENT }} />
          </Box>
          <Typography sx={{ fontWeight: 800, fontSize: '1.25rem', mb: 0.75 }}>
            {t('jobboard.empty_title')}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5, maxWidth: 420, mx: 'auto' }}>
            {t('jobboard.empty_body')}
          </Typography>
          <Button
            variant="contained"
            onClick={() => navigate('/robots')}
            sx={{
              bgcolor: ACCENT,
              textTransform: 'none',
              fontWeight: 700,
              borderRadius: 2,
              px: 2.5,
              '&:hover': { bgcolor: '#d600a3' },
            }}
          >
            {t('jobboard.empty_cta')}
          </Button>
        </Box>
      ) : (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: isNarrow ? '1fr' : 'minmax(0, 1.05fr) minmax(360px, 0.95fr)',
            gap: 2.5,
            alignItems: 'start',
          }}
        >
          <Box>
            <Stack spacing={1.35}>
              {jobs.map((job) => (
                <JobCard
                  key={job.id}
                  job={job}
                  selected={!isNarrow && selectedId === job.id}
                  onSelect={() => handleSelect(job.id)}
                />
              ))}
            </Stack>
            {pagination.totalPages > 1 && (
              <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3, mb: 1 }}>
                <Pagination
                  count={pagination.totalPages}
                  page={page}
                  onChange={(_, value) => setPage(value)}
                  color="primary"
                  shape="rounded"
                />
              </Box>
            )}
          </Box>

          {!isNarrow && (
            <Box
              sx={{
                position: 'sticky',
                top: 88,
                borderRadius: 3,
                overflow: 'hidden',
                border: '1px solid',
                borderColor: isDark ? alpha('#fff', 0.08) : alpha(TEAL, 0.1),
                bgcolor: isDark ? alpha('#0b1220', 0.7) : '#fff',
                minHeight: 560,
                maxHeight: 'calc(100vh - 112px)',
                boxShadow: `0 18px 40px ${alpha(TEAL, 0.08)}`,
              }}
            >
              {detailContent}
            </Box>
          )}
        </Box>
      )}

      <Drawer
        anchor="right"
        open={isNarrow && drawerOpen}
        onClose={handleCloseDetail}
        PaperProps={{
          sx: {
            width: '100%',
            maxWidth: 520,
            bgcolor: isDark ? '#0b1220' : '#fff',
          },
        }}
      >
        {detailContent}
      </Drawer>
    </Box>
  );
};

export default JobBoardPage;
