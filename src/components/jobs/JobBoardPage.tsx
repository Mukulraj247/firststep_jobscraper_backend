import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  alpha,
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
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
  AccessTimeOutlined,
  BusinessOutlined,
  CardGiftcardOutlined,
  Close,
  Link as LinkIcon,
  LocationOnOutlined,
  OpenInNew,
  PaymentsOutlined,
  SchoolOutlined,
  Search,
  TagOutlined,
  WorkOutline,
} from '@mui/icons-material';
import { getJob, listJobs, JobBoardJob, JobBoardFilters } from '../../api/jobs';
import {
  sectionBodyLines,
  splitJobDescriptionSections,
  extractCardHighlights,
} from '../../utils/jobDescriptionSections';

const ACCENT = '#ff00c3';
const TEAL = '#023345';
const PAGE_SIZE = 15;

/** Known brand marks when enrichment didn't capture a logo. */
const BRAND_LOGOS: Record<string, string> = {
  google: 'https://www.google.com/s2/favicons?domain=google.com&sz=128',
  'jpmorgan chase': 'https://www.google.com/s2/favicons?domain=jpmorganchase.com&sz=128',
  jpmc: 'https://www.google.com/s2/favicons?domain=jpmorganchase.com&sz=128',
  toyota: 'https://www.google.com/s2/favicons?domain=toyota.com&sz=128',
  ford: 'https://www.google.com/s2/favicons?domain=ford.com&sz=128',
  meta: 'https://www.google.com/s2/favicons?domain=meta.com&sz=128',
  'sia partners': 'https://www.google.com/s2/favicons?domain=sia-partners.com&sz=128',
  carrier: 'https://www.google.com/s2/favicons?domain=carrier.com&sz=128',
};

const resolveCompanyLogo = (company: string, logoUrl?: string): string => {
  if (logoUrl && logoUrl.trim()) return logoUrl.trim();
  const key = company.toLowerCase().replace(/[.\s]+/g, ' ').trim();
  if (BRAND_LOGOS[key]) return BRAND_LOGOS[key];
  // Domain-style fallback from company name
  const domainGuess = key.replace(/\s+/g, '') + '.com';
  if (key.length >= 3) return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domainGuess)}&sz=128`;
  return '';
};

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
  return String(value)
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
};

const toReadableDescription = (value: unknown): string => {
  let raw = value == null ? '' : String(value);
  if (!raw.trim()) return '';
  if (/<\/?[a-z][\s\S]*?>/i.test(raw)) {
    raw = raw
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, '\n')
      .replace(/<(h[1-6])[^>]*>/gi, '\n\n')
      .replace(/<\/?(strong|b)\b[^>]*>/gi, '')
      .replace(/<li[^>]*>/gi, '• ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'");
  }
  return raw
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
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

const snippet = (text: string, max = 110): string => {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max).trim()}…`;
};

const CompanyAvatar: React.FC<{ name: string; logoUrl?: string; size?: number }> = ({
  name,
  logoUrl,
  size = 40,
}) => {
  const bg = colorForCompany(name || 'Company');
  const [imgFailed, setImgFailed] = useState(false);
  const showImg = Boolean(logoUrl) && !imgFailed;

  return (
    <Avatar
      src={showImg ? logoUrl : undefined}
      imgProps={{
        onError: () => setImgFailed(true),
        referrerPolicy: 'no-referrer',
      }}
      variant="rounded"
      sx={{
        width: size,
        height: size,
        bgcolor: showImg ? '#fff' : bg,
        color: '#fff',
        fontWeight: 700,
        fontSize: size > 44 ? '1rem' : '0.8rem',
        letterSpacing: 0.3,
        flexShrink: 0,
        border: `1px solid ${alpha(TEAL, 0.1)}`,
        borderRadius: 1.5,
        '& img': { objectFit: 'contain', p: 0.4 },
      }}
    >
      {!showImg && companyInitials(name || '?')}
    </Avatar>
  );
};

const SoftChip: React.FC<{ label: string; tone?: 'default' | 'teal' | 'accent' }> = ({
  label,
  tone = 'default',
}) => {
  const bg =
    tone === 'teal'
      ? alpha(TEAL, 0.08)
      : tone === 'accent'
        ? alpha(ACCENT, 0.1)
        : alpha('#0f172a', 0.04);
  const color = tone === 'teal' ? TEAL : tone === 'accent' ? '#b8008f' : '#475569';
  const text = asText(label);
  const short = text.length > 42 ? `${text.slice(0, 41).trim()}…` : text;
  return (
    <Chip
      size="small"
      label={short}
      title={text}
      sx={{
        height: 24,
        maxWidth: '100%',
        bgcolor: bg,
        color,
        border: `1px solid ${alpha(color, 0.12)}`,
        fontWeight: 600,
        fontSize: '0.72rem',
        '& .MuiChip-label': {
          px: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          display: 'block',
        },
      }}
    />
  );
};

/** Card-safe location: keep a short readable place, not a city dump. */
const formatCardLocation = (raw: string): string => {
  const loc = asText(raw);
  if (!loc) return '';
  // Prefer first segment when ATS dumps "City, ST +80 more" or long lists
  const primary = loc.split(/\s*\+\s*\d+\s*more/i)[0].trim();
  const parts = primary.split(/\s*,\s*/).filter(Boolean);
  if (parts.length > 3) {
    return `${parts.slice(0, 3).join(', ')}…`;
  }
  if (primary.length > 56) return `${primary.slice(0, 55).trim()}…`;
  return primary;
};

const FieldCell: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => {
  if (value == null || value === '') return null;
  return (
    <Box>
      <Typography
        variant="caption"
        sx={{
          display: 'block',
          color: 'text.secondary',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: 0.7,
          mb: 0.35,
          fontSize: '0.65rem',
        }}
      >
        {label}
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: 600, color: TEAL, wordBreak: 'break-word' }}>
        {value}
      </Typography>
    </Box>
  );
};

const DescriptionSections: React.FC<{
  text: string;
  fallbackTitle: string;
  structured?: {
    about?: string;
    minimumQualifications?: string[];
    preferredQualifications?: string[];
    responsibilities?: string[];
    benefits?: string[];
    skills?: string[];
  };
}> = ({ text, fallbackTitle, structured }) => {
  const { t } = useTranslation();
  const asList = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((x) => String(x || '').trim()).filter(Boolean) : [];

  const structuredBlocks: { title: string; body: string }[] = [];
  if (structured) {
    if (asText(structured.about)) {
      structuredBlocks.push({ title: 'About the job', body: asText(structured.about) });
    }
    const minQ = asList(structured.minimumQualifications);
    if (minQ.length) {
      structuredBlocks.push({
        title: 'Minimum qualifications',
        body: minQ.map((b) => `• ${b}`).join('\n'),
      });
    }
    const prefQ = asList(structured.preferredQualifications);
    if (prefQ.length) {
      structuredBlocks.push({
        title: 'Preferred qualifications',
        body: prefQ.map((b) => `• ${b}`).join('\n'),
      });
    }
    const resp = asList(structured.responsibilities);
    if (resp.length) {
      structuredBlocks.push({
        title: 'Responsibilities',
        body: resp.map((b) => `• ${b}`).join('\n'),
      });
    }
    const bens = asList(structured.benefits);
    if (bens.length) {
      structuredBlocks.push({ title: 'Benefits', body: bens.map((b) => `• ${b}`).join('\n') });
    }
    const skills = asList(structured.skills);
    if (skills.length) {
      structuredBlocks.push({ title: 'Skills', body: skills.map((b) => `• ${b}`).join('\n') });
    }
  }

  const sections =
    structuredBlocks.length > 0
      ? structuredBlocks.map((s, i) => ({ id: `structured-${i}`, title: s.title, body: s.body }))
      : splitJobDescriptionSections(text, fallbackTitle);

  if (sections.length === 0) {
    return <Typography color="text.secondary">{t('jobboard.no_description')}</Typography>;
  }
  return (
    <Stack spacing={2.25}>
      {sections.map((section) => {
        const lines = sectionBodyLines(section.body);
        return (
          <Box key={section.id}>
            <Typography
              variant="caption"
              sx={{
                display: 'block',
                fontWeight: 700,
                letterSpacing: 0.8,
                color: 'text.secondary',
                mb: 1,
              }}
            >
              {section.title.toUpperCase()}
            </Typography>
            <Stack spacing={1}>
              {lines.map((line, i) =>
                line.type === 'bullet' ? (
                  <Stack key={i} direction="row" spacing={1} alignItems="flex-start">
                    <Typography component="span" sx={{ lineHeight: 1.65, color: 'text.secondary' }}>
                      •
                    </Typography>
                    <Typography sx={{ lineHeight: 1.65, fontSize: '0.95rem', flex: 1 }}>
                      {line.text}
                    </Typography>
                  </Stack>
                ) : (
                  <Typography key={i} sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.7, fontSize: '0.95rem' }}>
                    {line.text}
                  </Typography>
                )
              )}
            </Stack>
          </Box>
        );
      })}
    </Stack>
  );
};

/** HiringCafe-style portrait job card for the grid. */
const JobGridCard: React.FC<{ job: JobBoardJob; onOpen: () => void }> = ({ job, onOpen }) => {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const data = job.data || {};
  const title = asText(data.jobTitle) || 'Untitled role';
  const company = asText(data.companyName) || 'Company not listed';
  const locationFull = asText(data.location);
  const location = formatCardLocation(locationFull);
  const salary = asText(data.salaryRange);
  const category = asText(data.jobCategory);
  const employment = asText(data.employmentType);
  const remote = asText(data.remoteType);
  const fullDesc = toReadableDescription(data.jobDescription);
  const parsed = extractCardHighlights(fullDesc);
  const asList = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((x) => String(x || '').trim()).filter(Boolean) : [];
  const highlights = {
    about: asText(data.about) || parsed.about,
    minimumQualifications:
      asList(data.minimumQualifications).length > 0
        ? asList(data.minimumQualifications)
        : parsed.minimumQualifications,
    preferredQualifications:
      asList(data.preferredQualifications).length > 0
        ? asList(data.preferredQualifications)
        : parsed.preferredQualifications,
    responsibilities:
      asList(data.responsibilities).length > 0 ? asList(data.responsibilities) : parsed.responsibilities,
    benefits: asList(data.benefits).length > 0 ? asList(data.benefits) : parsed.benefits,
    skills: asList(data.skills).length > 0 ? asList(data.skills) : parsed.skills,
    experienceLabel: parsed.experienceLabel,
    employmentHint: parsed.employmentHint,
    remoteHint: parsed.remoteHint,
  };
  const posted = formatRelative(data.date || job.createdAt);
  const postedExact = formatPosted(data.date || job.createdAt);
  const logo = resolveCompanyLogo(company, asText(data.companyLogoUrl));
  const applyUrl = asText(data.applyUrl) || asText(data.jobUrl);
  const experience =
    (typeof data.jobExperience === 'number' && data.jobExperience > 0
      ? `${data.jobExperience}+ years experience`
      : '') || highlights.experienceLabel;
  const remoteLabel = remote || highlights.remoteHint;
  const employmentLabel = employment || highlights.employmentHint;

  const DetailBlock: React.FC<{
    icon: React.ReactNode;
    label: string;
    lines: string[];
  }> = ({ icon, label, lines }) => {
    if (!lines.length) return null;
    return (
      <Box sx={{ minWidth: 0, maxWidth: '100%' }}>
        <Stack direction="row" alignItems="center" spacing={0.6} mb={0.35}>
          <Box sx={{ display: 'flex', color: 'text.secondary', flexShrink: 0, lineHeight: 0 }}>{icon}</Box>
          <Typography
            variant="caption"
            sx={{
              fontWeight: 700,
              color: 'text.secondary',
              fontSize: '0.65rem',
              letterSpacing: 0.45,
              lineHeight: 1,
            }}
          >
            {label}
          </Typography>
        </Stack>
        {lines.slice(0, 2).map((line, i) => (
          <Typography
            key={i}
            variant="body2"
            sx={{
              fontSize: '0.74rem',
              color: 'text.secondary',
              lineHeight: 1.4,
              pl: 0.25,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              overflowWrap: 'anywhere',
              wordBreak: 'break-word',
              mb: 0.2,
            }}
          >
            • {line}
          </Typography>
        ))}
      </Box>
    );
  };

  return (
    <Box
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      sx={{
        width: '100%',
        maxWidth: '100%',
        minWidth: 0,
        height: '100%',
        aspectRatio: { xs: 'auto', sm: '3 / 4.1' },
        minHeight: { xs: 380, sm: 0 },
        maxHeight: { xl: 520 },
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        cursor: 'pointer',
        borderRadius: 2.5,
        border: `1px solid ${isDark ? alpha('#fff', 0.1) : alpha('#0f172a', 0.08)}`,
        bgcolor: isDark ? alpha('#fff', 0.03) : '#fff',
        p: 1.75,
        boxShadow: isDark ? 'none' : `0 1px 2px ${alpha('#0f172a', 0.04)}`,
        transition: 'border-color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease',
        '&:hover': {
          borderColor: alpha(ACCENT, 0.4),
          boxShadow: `0 10px 28px ${alpha(TEAL, 0.1)}`,
          transform: 'translateY(-2px)',
        },
      }}
    >
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" gap={0.75} mb={0.5} sx={{ minWidth: 0 }}>
        <Typography
          sx={{
            fontWeight: 750,
            fontSize: '0.92rem',
            lineHeight: 1.3,
            letterSpacing: '-0.015em',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            overflowWrap: 'anywhere',
            wordBreak: 'break-word',
            flex: 1,
            minWidth: 0,
          }}
        >
          {title}
        </Typography>
        {posted && (
          <Stack direction="row" alignItems="center" spacing={0.35} sx={{ flexShrink: 0, color: 'text.secondary' }}>
            <AccessTimeOutlined sx={{ fontSize: 13 }} />
            <Typography variant="caption" sx={{ fontWeight: 650, whiteSpace: 'nowrap', fontSize: '0.7rem' }}>
              {posted}
            </Typography>
          </Stack>
        )}
      </Stack>

      {location && (
        <Stack
          direction="row"
          alignItems="center"
          spacing={0.4}
          mb={0.75}
          sx={{ color: 'text.secondary', minWidth: 0, width: '100%' }}
          title={locationFull || location}
        >
          <LocationOnOutlined sx={{ fontSize: 14, flexShrink: 0 }} />
          <Typography
            variant="body2"
            sx={{
              fontSize: '0.75rem',
              minWidth: 0,
              flex: 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {location}
          </Typography>
        </Stack>
      )}

      <Stack direction="row" flexWrap="wrap" gap={0.5} mb={1.1} sx={{ minWidth: 0, maxWidth: '100%' }}>
        {remoteLabel && <SoftChip label={remoteLabel} tone="accent" />}
        {employmentLabel && <SoftChip label={employmentLabel} tone="teal" />}
        {category && <SoftChip label={category} />}
        {salary && <SoftChip label={salary} tone="teal" />}
        {asText(data.enrichmentMethod) === 'llm' && <SoftChip label="AI-parsed" tone="accent" />}
      </Stack>

      <Stack direction="row" spacing={1} alignItems="center" mb={1.1} sx={{ minWidth: 0 }}>
        <CompanyAvatar name={company} logoUrl={logo} size={36} />
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography sx={{ fontWeight: 700, fontSize: '0.82rem', color: TEAL }} noWrap>
            {company}
          </Typography>
          {postedExact && (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: 'block', fontSize: '0.68rem', lineHeight: 1.35 }}
              noWrap
            >
              Posted {postedExact}
            </Typography>
          )}
        </Box>
      </Stack>

      <Stack spacing={0.85} sx={{ flex: 1, minHeight: 0, minWidth: 0, overflow: 'hidden' }}>
        {experience && (
          <Stack direction="row" alignItems="center" spacing={0.6} sx={{ minWidth: 0 }}>
            <WorkOutline sx={{ fontSize: 14, color: 'text.secondary', flexShrink: 0 }} />
            <Typography
              variant="body2"
              sx={{
                fontSize: '0.75rem',
                color: 'text.secondary',
                fontWeight: 600,
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {experience}
            </Typography>
          </Stack>
        )}

        {highlights.about &&
          (highlights.minimumQualifications.length > 0 ||
            highlights.responsibilities.length > 0 ||
            highlights.preferredQualifications.length > 0) && (
            <Typography
              variant="body2"
              sx={{
                fontSize: '0.74rem',
                color: 'text.secondary',
                lineHeight: 1.45,
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
                overflowWrap: 'anywhere',
                wordBreak: 'break-word',
              }}
            >
              {highlights.about}
            </Typography>
          )}

        <DetailBlock
          icon={<SchoolOutlined sx={{ fontSize: 14 }} />}
          label="MINIMUM QUALS"
          lines={highlights.minimumQualifications}
        />
        <DetailBlock
          icon={<SchoolOutlined sx={{ fontSize: 14 }} />}
          label="PREFERRED"
          lines={highlights.preferredQualifications}
        />
        <DetailBlock
          icon={<WorkOutline sx={{ fontSize: 14 }} />}
          label="RESPONSIBILITIES"
          lines={highlights.responsibilities}
        />
        <DetailBlock
          icon={<CardGiftcardOutlined sx={{ fontSize: 14 }} />}
          label="BENEFITS"
          lines={highlights.benefits}
        />

        {!highlights.minimumQualifications.length &&
          !highlights.preferredQualifications.length &&
          !highlights.responsibilities.length &&
          !highlights.benefits.length &&
          (highlights.about || fullDesc) && (
            <Typography
              variant="body2"
              sx={{
                fontSize: '0.74rem',
                color: 'text.secondary',
                lineHeight: 1.45,
                display: '-webkit-box',
                WebkitLineClamp: 5,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
                overflowWrap: 'anywhere',
                wordBreak: 'break-word',
              }}
            >
              {highlights.about || snippet(fullDesc, 280)}
            </Typography>
          )}

        {highlights.skills.length > 0 && (
          <Stack direction="row" flexWrap="wrap" gap={0.45} sx={{ minWidth: 0, maxWidth: '100%' }}>
            {highlights.skills.slice(0, 6).map((s) => (
              <SoftChip key={s} label={s} />
            ))}
          </Stack>
        )}
      </Stack>

      <Box
        sx={{
          mt: 'auto',
          pt: 1.1,
          flexShrink: 0,
          borderTop: `1px solid ${isDark ? alpha('#fff', 0.08) : alpha('#0f172a', 0.06)}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1,
          minWidth: 0,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {applyUrl ? (
          <Button
            size="small"
            href={applyUrl}
            target="_blank"
            rel="noopener noreferrer"
            endIcon={<OpenInNew sx={{ fontSize: 13 }} />}
            sx={{
              textTransform: 'none',
              fontWeight: 700,
              color: TEAL,
              px: 0.25,
              minWidth: 0,
              fontSize: '0.78rem',
              '&:hover': { bgcolor: 'transparent', color: ACCENT },
            }}
          >
            Apply
          </Button>
        ) : (
          <span />
        )}
        <Typography
          variant="caption"
          sx={{ fontWeight: 650, color: 'text.secondary', cursor: 'pointer', fontSize: '0.75rem' }}
          onClick={onOpen}
        >
          View details →
        </Typography>
      </Box>
    </Box>
  );
};


const JobDetailModal: React.FC<{
  open: boolean;
  job: JobBoardJob | null;
  loading: boolean;
  onClose: () => void;
}> = ({ open, job, loading, onClose }) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open && scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [open, job?.id]);

  const data = job?.data || {};
  const title = asText(data.jobTitle) || 'Untitled role';
  const company = asText(data.companyName) || 'Company not listed';
  const location = asText(data.location);
  const salary = asText(data.salaryRange);
  const employment = asText(data.employmentType);
  const remote = asText(data.remoteType);
  const category = asText(data.jobCategory);
  const industry = asText(data.sectorIndustry);
  const jobId = asText(data.jobId);
  const jobUrl = asText(data.jobUrl);
  const applyUrl = asText(data.applyUrl) || jobUrl;
  const description = toReadableDescription(data.jobDescription);
  const posted = formatPosted(data.date || job?.createdAt);
  const logo = resolveCompanyLogo(company, asText(data.companyLogoUrl));
  const experience =
    typeof data.jobExperience === 'number' && data.jobExperience > 0
      ? t('jobboard.years', { count: data.jobExperience })
      : '';

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullScreen={fullScreen}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: fullScreen ? 0 : 3,
          maxHeight: fullScreen ? '100%' : '90vh',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        },
      }}
    >
      <Box
        sx={{
          flexShrink: 0,
          px: { xs: 2, sm: 3 },
          pt: 2.5,
          pb: 2,
          borderBottom: `1px solid ${isDark ? alpha('#fff', 0.08) : alpha(TEAL, 0.1)}`,
        }}
      >
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" gap={2}>
          <Stack direction="row" spacing={1.75} alignItems="flex-start" sx={{ minWidth: 0, flex: 1 }}>
            <CompanyAvatar name={company} logoUrl={logo} size={52} />
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography
                sx={{
                  fontWeight: 750,
                  fontSize: { xs: '1.15rem', sm: '1.35rem' },
                  lineHeight: 1.25,
                  letterSpacing: '-0.02em',
                  mb: 0.35,
                }}
              >
                {loading ? '…' : title}
              </Typography>
              <Typography sx={{ color: TEAL, fontWeight: 650, mb: 1 }}>{company}</Typography>
              <Stack direction="row" flexWrap="wrap" gap={0.75}>
                {location && <SoftChip label={location} />}
                {category && <SoftChip label={category} tone="teal" />}
                {salary && <SoftChip label={salary} />}
                {employment && <SoftChip label={employment} />}
                {remote && <SoftChip label={remote} tone="accent" />}
              </Stack>
            </Box>
          </Stack>

          <Stack direction="row" spacing={1} alignItems="flex-start" sx={{ flexShrink: 0 }}>
            <Button
              variant="contained"
              size="medium"
              disabled={!applyUrl || loading}
              endIcon={<OpenInNew sx={{ fontSize: 16 }} />}
              href={applyUrl || undefined}
              target="_blank"
              rel="noopener noreferrer"
              sx={{
                bgcolor: ACCENT,
                color: '#fff',
                fontWeight: 700,
                textTransform: 'none',
                px: 2.5,
                py: 1,
                borderRadius: 2,
                boxShadow: `0 4px 14px ${alpha(ACCENT, 0.3)}`,
                whiteSpace: 'nowrap',
                '&:hover': { bgcolor: '#e000ad' },
                '&.Mui-disabled': { bgcolor: alpha(ACCENT, 0.35), color: '#fff' },
              }}
            >
              {t('jobboard.apply')}
            </Button>
            <IconButton onClick={onClose} size="small" aria-label="Close" sx={{ color: 'text.secondary' }}>
              <Close fontSize="small" />
            </IconButton>
          </Stack>
        </Stack>
      </Box>

      <DialogContent
        ref={scrollRef}
        sx={{
          flex: 1,
          overflow: 'auto',
          px: { xs: 2, sm: 3 },
          py: 2.5,
        }}
      >
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
            <CircularProgress size={32} sx={{ color: ACCENT }} />
          </Box>
        ) : (
          <Stack spacing={2.5}>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(3, 1fr)' },
                gap: 1.75,
                p: 1.75,
                borderRadius: 2,
                bgcolor: isDark ? alpha('#fff', 0.04) : alpha(TEAL, 0.04),
                border: `1px solid ${isDark ? alpha('#fff', 0.06) : alpha(TEAL, 0.08)}`,
              }}
            >
              <FieldCell label={t('jobboard.company')} value={company} />
              <FieldCell label={t('jobboard.category')} value={category} />
              <FieldCell label={t('jobboard.posted')} value={posted} />
              <FieldCell label={t('jobboard.location')} value={location} />
              <FieldCell label={t('jobboard.salary')} value={salary} />
              <FieldCell label={t('jobboard.employment_type')} value={employment} />
              <FieldCell label={t('jobboard.remote_type')} value={remote} />
              <FieldCell label={t('jobboard.experience')} value={experience} />
              <FieldCell label={t('jobboard.industry')} value={industry} />
              <FieldCell
                label={t('jobboard.job_id')}
                value={
                  jobId ? (
                    <Stack direction="row" alignItems="center" spacing={0.5}>
                      <TagOutlined sx={{ fontSize: 14 }} />
                      <span>{jobId}</span>
                    </Stack>
                  ) : null
                }
              />
              <FieldCell
                label={t('jobboard.job_url')}
                value={
                  jobUrl ? (
                    <Box
                      component="a"
                      href={jobUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      sx={{
                        color: TEAL,
                        textDecoration: 'none',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 0.5,
                        '&:hover': { color: ACCENT },
                      }}
                    >
                      <LinkIcon sx={{ fontSize: 14 }} />
                      {t('jobboard.open_listing')}
                    </Box>
                  ) : null
                }
              />
            </Box>

            <DescriptionSections
              text={description}
              fallbackTitle={t('jobboard.description')}
              structured={{
                about: asText(data.about),
                minimumQualifications: Array.isArray(data.minimumQualifications)
                  ? data.minimumQualifications
                  : [],
                preferredQualifications: Array.isArray(data.preferredQualifications)
                  ? data.preferredQualifications
                  : [],
                responsibilities: Array.isArray(data.responsibilities) ? data.responsibilities : [],
                benefits: Array.isArray(data.benefits) ? data.benefits : [],
                skills: Array.isArray(data.skills) ? data.skills : [],
              }}
            />
          </Stack>
        )}
      </DialogContent>
    </Dialog>
  );
};

export const JobBoardPage: React.FC = () => {
  const { t } = useTranslation();
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  const [jobs, setJobs] = useState<JobBoardJob[]>([]);
  const [filters, setFilters] = useState<JobBoardFilters>({ companies: [], categories: [] });
  const [pagination, setPagination] = useState({ page: 1, limit: PAGE_SIZE, total: 0, totalPages: 1 });
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [qDraft, setQDraft] = useState('');
  const [company, setCompany] = useState('');
  const [category, setCategory] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<JobBoardJob | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const gridTopRef = useRef<HTMLDivElement | null>(null);

  const loadJobs = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await listJobs({
        page,
        limit: PAGE_SIZE,
        q: q || undefined,
        company: company || undefined,
        category: category || undefined,
      });
      setJobs(res.jobs);
      setPagination(res.pagination);
      setFilters(res.filters);
    } catch {
      setError(t('jobboard.load_error'));
      setJobs([]);
    } finally {
      setLoading(false);
    }
  }, [page, q, company, category, t]);

  useEffect(() => {
    void loadJobs();
  }, [page, q, company, category]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (gridTopRef.current) {
      gridTopRef.current.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  }, [page, q, company, category]);

  useEffect(() => {
    if (!selectedId || !modalOpen) {
      if (!modalOpen) setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    getJob(selectedId)
      .then((job) => {
        if (!cancelled) setDetail(job);
      })
      .catch(() => {
        if (!cancelled) setDetail(null);
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, modalOpen]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      const next = qDraft.trim();
      setQ((prev) => {
        if (prev !== next) setPage(1);
        return next;
      });
    }, 320);
    return () => window.clearTimeout(handle);
  }, [qDraft]);

  const openJob = (id: string) => {
    setSelectedId(id);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setSelectedId(null);
    setDetail(null);
  };

  const clearSearch = () => {
    setQDraft('');
    setQ('');
    setPage(1);
  };

  const panelBg = isDark ? alpha('#fff', 0.03) : '#fff';
  const limit = pagination.limit || PAGE_SIZE;
  const total = pagination.total || 0;
  const rangeFrom = total === 0 ? 0 : (page - 1) * limit + 1;
  const rangeTo = Math.min(page * limit, total);

  return (
    <Box
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        bgcolor: isDark ? 'transparent' : alpha(TEAL, 0.02),
      }}
    >
      <Box ref={gridTopRef} sx={{ flexShrink: 0, px: { xs: 2, md: 3 }, pt: 2.5, pb: 2 }}>
        <Stack direction="row" alignItems="baseline" spacing={1.5} mb={0.5}>
          <Typography
            sx={{
              fontWeight: 800,
              fontSize: { xs: '1.5rem', md: '1.75rem' },
              letterSpacing: '-0.03em',
              color: TEAL,
            }}
          >
            {t('jobboard.heading')}
          </Typography>
          {total > 0 && (
            <Chip
              size="small"
              label={total}
              sx={{ bgcolor: alpha(ACCENT, 0.12), color: '#b8008f', fontWeight: 700, height: 24 }}
            />
          )}
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {total > 0
            ? t('jobboard.heading_subtitle', { count: total })
            : t('jobboard.heading_subtitle_empty')}
        </Typography>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25} useFlexGap flexWrap="wrap">
          <TextField
            size="small"
            placeholder={t('jobboard.search')}
            value={qDraft}
            onChange={(e) => setQDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                setQ(qDraft.trim());
                setPage(1);
              }
            }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <Search sx={{ color: 'text.secondary', fontSize: 20 }} />
                </InputAdornment>
              ),
              endAdornment: qDraft ? (
                <InputAdornment position="end">
                  <IconButton size="small" aria-label="Clear search" onClick={clearSearch} edge="end">
                    <Close sx={{ fontSize: 18 }} />
                  </IconButton>
                </InputAdornment>
              ) : undefined,
            }}
            sx={{
              minWidth: { xs: '100%', sm: 240 },
              flex: { sm: '1 1 240px' },
              maxWidth: 360,
              bgcolor: panelBg,
              '& .MuiOutlinedInput-root': { borderRadius: 2 },
            }}
          />
          <FormControl size="small" sx={{ minWidth: 140, bgcolor: panelBg }}>
            <InputLabel>{t('jobboard.filter_company')}</InputLabel>
            <Select
              label={t('jobboard.filter_company')}
              value={company}
              onChange={(e) => {
                setCompany(String(e.target.value));
                setPage(1);
              }}
              sx={{ borderRadius: 2 }}
            >
              <MenuItem value="">{t('jobboard.filter_all')}</MenuItem>
              {filters.companies.map((c) => (
                <MenuItem key={c} value={c}>
                  {c}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 140, bgcolor: panelBg }}>
            <InputLabel>{t('jobboard.filter_category')}</InputLabel>
            <Select
              label={t('jobboard.filter_category')}
              value={category}
              onChange={(e) => {
                setCategory(String(e.target.value));
                setPage(1);
              }}
              sx={{ borderRadius: 2 }}
            >
              <MenuItem value="">{t('jobboard.filter_all')}</MenuItem>
              {filters.categories.map((c) => (
                <MenuItem key={c} value={c}>
                  {c}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Stack>
      </Box>

      {error && (
        <Typography color="error" sx={{ px: 3, pb: 1 }}>
          {error}
        </Typography>
      )}

      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', px: { xs: 2, md: 3 }, pb: 3 }}>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 10 }}>
            <CircularProgress size={36} sx={{ color: ACCENT }} />
          </Box>
        ) : jobs.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 10, px: 3 }}>
            <BusinessOutlined sx={{ fontSize: 48, color: alpha(TEAL, 0.3), mb: 1 }} />
            <Typography sx={{ fontWeight: 700, mb: 0.75 }}>{t('jobboard.empty_title')}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 360, mx: 'auto' }}>
              {t('jobboard.empty_body')}
            </Typography>
          </Box>
        ) : (
          <>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: {
                  xs: 'minmax(0, 1fr)',
                  sm: 'repeat(2, minmax(0, 1fr))',
                  md: 'repeat(3, minmax(0, 1fr))',
                  lg: 'repeat(4, minmax(0, 1fr))',
                  xl: 'repeat(5, minmax(0, 1fr))',
                },
                gap: 1.75,
                alignItems: 'stretch',
              }}
            >
              {jobs.map((job) => (
                <JobGridCard key={job.id} job={job} onOpen={() => openJob(job.id)} />
              ))}
            </Box>

            <Stack alignItems="center" spacing={1} sx={{ mt: 3 }}>
              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                {t('jobboard.showing_range', { from: rangeFrom, to: rangeTo, total })}
              </Typography>
              {pagination.totalPages > 1 && (
                <Pagination
                  count={pagination.totalPages}
                  page={page}
                  onChange={(_, p) => setPage(p)}
                  size="medium"
                  sx={{
                    '& .Mui-selected': {
                      bgcolor: `${alpha(ACCENT, 0.15)} !important`,
                      color: '#b8008f',
                    },
                  }}
                />
              )}
            </Stack>
          </>
        )}
      </Box>

      <JobDetailModal open={modalOpen} job={detail} loading={detailLoading} onClose={closeModal} />
    </Box>
  );
};

export default JobBoardPage;
