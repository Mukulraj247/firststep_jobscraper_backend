import React, { useState } from 'react';
import {
  Avatar,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  Grid,
  IconButton,
  InputLabel,
  LinearProgress,
  MenuItem,
  Select,
  Stack,
  Typography,
} from '@mui/material';
import type { SelectChangeEvent } from '@mui/material/Select';
import ArrowForward from '@mui/icons-material/ArrowForward';
import BoltOutlined from '@mui/icons-material/BoltOutlined';
import BookmarkBorder from '@mui/icons-material/BookmarkBorder';
import Close from '@mui/icons-material/Close';
import EditNoteOutlined from '@mui/icons-material/EditNoteOutlined';
import ExploreOutlined from '@mui/icons-material/ExploreOutlined';
import InfoOutlined from '@mui/icons-material/InfoOutlined';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ClusterCard } from '../components/ClusterCard';
import { EmptyState } from '../components/EmptyState';
import { JobsOverTimeChart } from '../components/JobsOverTimeChart';
import { ClusterGridSkeleton, JobListSkeleton, PanelSkeleton } from '../components/Skeletons';
import { useRequirePortalAuth } from '../hooks/usePortalAuth';
import { getEntitlements, saveJob, unsaveJob } from '../api/portalApi';
import {
  invalidatePortalShell,
  usePortalBootstrap,
  usePortalHomeAnalytics,
} from '../hooks/portalQueries';
import type {
  FeedInsightBucket,
  FeedInsights,
  HomeAnalyticsRange,
  PortalEntitlements,
} from '../types';
import { FREQUENCY_LABEL, HOME_ANALYTICS_RANGE_OPTIONS } from '../types';
import { humanLabel, shortRequestHint } from '../utils/displayLabels';
import { pluralize, timeAgo, timeUntil } from '../utils/format';
import {
  DISPLAY_FONT,
  EASE,
  MOTION_SAFE,
  RADIUS,
  STITCH,
  ghostButtonSx,
  primaryButtonSx,
  tint,
} from '../tokens';
import { useGlobalInfoStore } from '../../context/globalInfo';

const RECOMMENDED_SLUGS = [
  'google-careers',
  'meta-careers',
  'banking-nj',
  'faang-software',
  'data-science',
  'healthcare-texas',
];

type InfoDialogContent = { title: string; description: string };

/** FirstStep-style info (i) control — top-right of cards. */
function InfoTipButton({
  onClick,
  light,
}: {
  onClick: () => void;
  /** White icon for dark/gradient cards */
  light?: boolean;
}) {
  return (
    <IconButton
      size="small"
      aria-label="More information"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      sx={{
        position: 'absolute',
        top: 8,
        right: 8,
        zIndex: 30,
        color: light ? 'white' : STITCH.primary,
        opacity: light ? 0.85 : 0.7,
        pointerEvents: 'auto',
        '&:hover': {
          opacity: 1,
          backgroundColor: light ? 'rgba(255, 255, 255, 0.12)' : 'rgba(2, 51, 69, 0.08)',
        },
      }}
    >
      <InfoOutlined sx={{ fontSize: 18 }} />
    </IconButton>
  );
}

const fadeUpKeyframes = {
  from: { opacity: 0, transform: 'translateY(12px)' },
  to: { opacity: 1, transform: 'translateY(0)' },
};

/** Same float as FirstStep Dashboard `float` keyframes. */
const floatKeyframes = {
  '0%, 100%': { transform: 'translateY(0px)' },
  '50%': { transform: 'translateY(-20px)' },
};

function fadeUpSx(delayMs = 0) {
  return {
    [MOTION_SAFE]: {
      animation: `scoutFadeUp 420ms ${EASE} both`,
      animationDelay: `${delayMs}ms`,
      '@keyframes scoutFadeUp': fadeUpKeyframes,
    },
  };
}

/** Soft background blobs — FirstStep Dashboard GradientBlob. */
function GradientBlob({ index }: { index: 1 | 2 | 3 }) {
  const specs: Record<
    1 | 2 | 3,
    {
      width: { xs: number; sm: number; md: number };
      height: { xs: number; sm: number; md: number };
      top?: number | { xs: number | string; sm: number | string; md: number | string };
      bottom?: { xs: number; sm: number; md: number };
      right: number | { xs: number | string; sm: number | string; md: number | string };
      background: string;
      delay: string;
    }
  > = {
    1: {
      width: { xs: 200, sm: 300, md: 400 },
      height: { xs: 200, sm: 300, md: 400 },
      top: { xs: -30, sm: -50, md: -100 },
      right: { xs: -30, sm: -50, md: -100 },
      background: `linear-gradient(135deg, ${STITCH.primary}, ${STITCH.primaryDark})`,
      delay: '0s',
    },
    2: {
      width: { xs: 150, sm: 200, md: 300 },
      height: { xs: 150, sm: 200, md: 300 },
      bottom: { xs: -20, sm: -30, md: -50 },
      right: { xs: 20, sm: 50, md: 100 },
      background: `linear-gradient(135deg, ${STITCH.secondary}, ${STITCH.secondaryDark})`,
      delay: '2s',
    },
    3: {
      width: { xs: 120, sm: 180, md: 250 },
      height: { xs: 120, sm: 180, md: 250 },
      top: { xs: '30%', sm: '40%', md: '50%' },
      right: { xs: '5%', sm: '5%', md: '10%' },
      background: `linear-gradient(135deg, #4fb3a9, #357a7a)`,
      delay: '4s',
    },
  };
  const s = specs[index];

  return (
    <Box
      aria-hidden
      sx={{
        position: 'absolute',
        borderRadius: '50%',
        filter: { xs: 'blur(60px)', sm: 'blur(80px)' },
        opacity: { xs: 0.3, sm: 0.4 },
        zIndex: 0,
        width: s.width,
        height: s.height,
        top: s.top,
        bottom: s.bottom,
        right: s.right,
        background: s.background,
        [MOTION_SAFE]: {
          animation: `scoutHeroFloat 6s ease-in-out ${s.delay} infinite`,
          '@keyframes scoutHeroFloat': floatKeyframes,
        },
      }}
    />
  );
}

type BlobShapeSpec = {
  width: { xs: number; sm: number; md: number };
  height: { xs: number; sm: number; md: number };
  top?: string | { xs: string; sm: string; md: string };
  left?: string | { xs: string; sm: string; md: string };
  right?: { xs: string; sm: string; md: string };
  bottom?: { xs: string; sm: string; md: string };
  transform?: string;
  background: string;
  delay: string;
};

/** Blob positions/sizes copied from FirstStep Dashboard BlobShape. */
const BLOB_SHAPES: BlobShapeSpec[] = [
  {
    width: { xs: 100, sm: 150, md: 200 },
    height: { xs: 100, sm: 150, md: 200 },
    top: { xs: '5%', sm: '8%', md: '10%' },
    left: { xs: '5%', sm: '8%', md: '10%' },
    background: `linear-gradient(135deg, ${STITCH.primary}, ${STITCH.primaryDark})`,
    delay: '0s',
  },
  {
    width: { xs: 80, sm: 120, md: 150 },
    height: { xs: 80, sm: 120, md: 150 },
    bottom: { xs: '15%', sm: '18%', md: '20%' },
    right: { xs: '10%', sm: '12%', md: '15%' },
    background: `linear-gradient(135deg, ${STITCH.secondary}, ${STITCH.secondaryDark})`,
    delay: '2s',
  },
  {
    width: { xs: 90, sm: 140, md: 180 },
    height: { xs: 90, sm: 140, md: 180 },
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    background: 'linear-gradient(135deg, #4fb3a9, #357a7a)',
    delay: '4s',
  },
  {
    width: { xs: 60, sm: 90, md: 120 },
    height: { xs: 60, sm: 90, md: 120 },
    top: { xs: '65%', sm: '68%', md: '70%' },
    left: { xs: '15%', sm: '18%', md: '20%' },
    background: `linear-gradient(135deg, ${STITCH.primaryLight}, ${STITCH.primary})`,
    delay: '6s',
  },
  {
    width: { xs: 50, sm: 75, md: 100 },
    height: { xs: 50, sm: 75, md: 100 },
    bottom: { xs: '5%', sm: '8%', md: '10%' },
    left: { xs: '55%', sm: '58%', md: '60%' },
    background: `linear-gradient(135deg, ${tint(STITCH.secondary, 0.85)}, ${STITCH.secondary})`,
    delay: '8s',
  },
];

/**
 * Right-column visual — FirstStep VisualCard + BlobShape + floating circle.
 * Keep this column's layout independent of text nudges.
 */
function HeroVisual() {
  return (
    <Box
      sx={{
        width: '100%',
        height: '100%',
        minHeight: { xs: 250, sm: 350, md: 400 },
        maxHeight: { xs: 300, sm: 450, md: 600 },
        borderRadius: { xs: 3, sm: 3.5, md: 4 },
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {BLOB_SHAPES.map((b, i) => (
        <Box
          key={i}
          aria-hidden
          sx={{
            position: 'absolute',
            borderRadius: '30% 70% 70% 30% / 30% 30% 70% 70%',
            opacity: 0.3,
            width: b.width,
            height: b.height,
            top: b.top,
            left: b.left,
            right: b.right,
            bottom: b.bottom,
            transform: b.transform,
            background: b.background,
            [MOTION_SAFE]: {
              animation: `scoutBlobFloat 8s ease-in-out ${b.delay} infinite`,
              '@keyframes scoutBlobFloat': floatKeyframes,
            },
          }}
        />
      ))}
      <Box
        sx={{
          position: 'relative',
          zIndex: 2,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Box
          aria-hidden
          sx={{
            width: { xs: 60, sm: 80, md: 120 },
            height: { xs: 60, sm: 80, md: 120 },
            borderRadius: '50%',
            opacity: 0.6,
            border: `2px solid ${STITCH.primaryLight}`,
            [MOTION_SAFE]: {
              animation: 'scoutCircleFloat 8s ease-in-out infinite',
              '@keyframes scoutCircleFloat': floatKeyframes,
            },
          }}
        />
      </Box>
    </Box>
  );
}

/** Plan ribbon — FirstStep Premium Plus notch badge. */
function PlanRibbon({ label }: { label: string }) {
  const ribbon = STITCH.primary;
  return (
    <Box
      sx={{
        position: 'relative',
        background: ribbon,
        color: 'white',
        px: { xs: 1.5, sm: 2, md: 2.5 },
        py: { xs: 0.5, sm: 0.6, md: 0.65 },
        fontSize: { xs: '0.7rem', sm: '0.8rem', md: '0.95rem' },
        fontWeight: 500,
        display: 'inline-block',
        borderRadius: '2px',
        whiteSpace: 'nowrap',
        '&::before': {
          content: '""',
          position: 'absolute',
          left: '100%',
          top: { xs: '0.5px', sm: '1px', md: '1.5px' },
          width: 0,
          height: 0,
          borderTop: { xs: `12px solid ${ribbon}`, sm: `13px solid ${ribbon}`, md: `15px solid ${ribbon}` },
          borderBottom: { xs: `12px solid ${ribbon}`, sm: `13px solid ${ribbon}`, md: `15px solid ${ribbon}` },
          borderRight: { xs: '15px solid transparent', sm: '18px solid transparent', md: '20px solid transparent' },
        },
        '&::after': {
          content: '""',
          position: 'absolute',
          right: '100%',
          top: { xs: '0.5px', sm: '1px', md: '1.5px' },
          width: 0,
          height: 0,
          borderTop: { xs: `12px solid ${ribbon}`, sm: `13px solid ${ribbon}`, md: `15px solid ${ribbon}` },
          borderBottom: { xs: `12px solid ${ribbon}`, sm: `13px solid ${ribbon}`, md: `15px solid ${ribbon}` },
          borderLeft: { xs: '15px solid transparent', sm: '18px solid transparent', md: '20px solid transparent' },
        },
      }}
    >
      {label}
    </Box>
  );
}

function SectionShell({
  title,
  actionLabel,
  actionTo,
  children,
  delay = 0,
  tall,
  infoTitle,
  infoDescription,
  onInfoClick,
}: {
  title: string;
  actionLabel?: string;
  actionTo?: string;
  children: React.ReactNode;
  delay?: number;
  /** Only activity cards — do not stretch requests / feed insights. */
  tall?: boolean;
  infoTitle?: string;
  infoDescription?: string;
  onInfoClick?: (title: string, description: string) => void;
}) {
  return (
    <Box
      sx={{
        // FirstStep StyledCard
        borderRadius: '6px',
        background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)',
        border: '1px solid rgba(226, 232, 240, 0.8)',
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.06)',
        position: 'relative',
        overflow: 'hidden',
        p: { xs: 2, sm: 3, md: 4 },
        height: '100%',
        transition: `transform 0.4s ${EASE}, box-shadow 0.4s ${EASE}`,
        '&::before': {
          content: '""',
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: '4px',
          background: `linear-gradient(90deg, ${STITCH.primary}, ${STITCH.secondary})`,
          borderRadius: '50px 50px 0 0',
        },
        '&:hover': {
          [MOTION_SAFE]: {
            transform: 'translateY(-6px) scale(1.01)',
            boxShadow: '0 20px 60px rgba(0, 0, 0, 0.12)',
          },
        },
        ...(tall ? { minHeight: { md: 320 } } : null),
        ...fadeUpSx(delay),
      }}
    >
      {infoTitle && infoDescription && onInfoClick && (
        <InfoTipButton onClick={() => onInfoClick(infoTitle, infoDescription)} />
      )}
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        spacing={1}
        sx={{ mb: { xs: 2, md: 3 }, pr: infoTitle ? 4 : 0 }}
      >
        <Typography
          sx={{
            fontFamily: DISPLAY_FONT,
            fontWeight: 700,
            fontSize: { xs: '1.15rem', sm: '1.35rem', md: '1.5rem' },
            color: STITCH.primary,
          }}
        >
          {title}
        </Typography>
        {actionLabel && actionTo && (
          <Button
            component={Link}
            to={actionTo}
            size="small"
            endIcon={<ArrowForward sx={{ fontSize: 14 }} />}
            sx={{
              textTransform: 'none',
              fontWeight: 600,
              color: STITCH.secondaryDark,
              '& .MuiButton-endIcon': { transition: `transform 160ms ${EASE}` },
              '&:hover .MuiButton-endIcon': {
                [MOTION_SAFE]: { transform: 'translateX(3px)' },
              },
            }}
          >
            {actionLabel}
          </Button>
        )}
      </Stack>
      {children}
    </Box>
  );
}

function InsightBucketColumn({
  heading,
  rows,
  compact,
}: {
  heading: string;
  rows: FeedInsightBucket[];
  compact?: boolean;
}) {
  return (
    <Box sx={{ flex: 1, minWidth: 0, height: '100%' }}>
      <Typography
        sx={{
          fontWeight: 700,
          fontSize: compact ? '0.7rem' : '0.8rem',
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          color: STITCH.muted,
          mb: 1,
        }}
      >
        {heading}
      </Typography>
      {rows.length === 0 ? (
        <Typography sx={{ fontSize: '0.85rem', color: STITCH.muted }}>No data yet</Typography>
      ) : (
        <Stack spacing={compact ? 0.75 : 1}>
          {rows.slice(0, compact ? 4 : 5).map((row) => (
            <Stack
              key={`${heading}-${row.label}`}
              direction="row"
              justifyContent="space-between"
              alignItems="baseline"
              spacing={1}
              sx={{
                py: compact ? 0.5 : 0.75,
                px: compact ? 1 : 1.25,
                borderRadius: '10px',
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
              }}
            >
              <Typography
                sx={{
                  fontWeight: 600,
                  fontSize: compact ? '0.8rem' : '0.9rem',
                  color: STITCH.onSurface,
                  minWidth: 0,
                }}
                noWrap
                title={row.label}
              >
                {row.label}
              </Typography>
              <Typography
                sx={{
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  color: STITCH.secondaryDark,
                  flexShrink: 0,
                }}
              >
                {row.count}
              </Typography>
            </Stack>
          ))}
        </Stack>
      )}
    </Box>
  );
}

export function HomePage() {
  const { user, loading } = useRequirePortalAuth();
  const navigate = useNavigate();
  const { notify } = useGlobalInfoStore();
  const queryClient = useQueryClient();
  const { data: bootstrap, isLoading: bootLoading, refetch } = usePortalBootstrap(
    Boolean(user) && !loading,
  );
  const [analyticsRange, setAnalyticsRange] = useState<HomeAnalyticsRange>('7d');
  const {
    data: homeAnalytics,
    isLoading: analyticsLoading,
    isFetching: analyticsFetching,
  } = usePortalHomeAnalytics(Boolean(user) && !loading, analyticsRange);
  const [starting, setStarting] = useState(false);
  const [entitlementsOverride, setEntitlementsOverride] = useState<PortalEntitlements | null>(null);
  const [infoDialogOpen, setInfoDialogOpen] = useState(false);
  const [infoDialogContent, setInfoDialogContent] = useState<InfoDialogContent | null>(null);

  const handleInfoClick = (title: string, description: string) => {
    setInfoDialogContent({ title, description });
    setInfoDialogOpen(true);
  };

  const handleInfoClose = () => {
    setInfoDialogOpen(false);
    setInfoDialogContent(null);
  };

  const handleRangeChange = (event: SelectChangeEvent) => {
    setAnalyticsRange(event.target.value as HomeAnalyticsRange);
  };

  const ready = Boolean(bootstrap) || (!bootLoading && !loading);
  const entitlements = entitlementsOverride || bootstrap?.entitlements || null;
  const subs = (bootstrap?.subscriptions || []).filter((x) => x.status === 'active');
  const savedCount = bootstrap?.savedCount ?? 0;
  const feedCount = bootstrap?.feedPreview?.total ?? 0;
  const latestJobs = (bootstrap?.feedPreview?.jobs ?? []).slice(0, 5);
  const emptyInsights: FeedInsights = {
    asOf: new Date().toISOString(),
    sampleSize: 0,
    companies: [],
    categories: [],
    skills: [],
  };
  const feedInsights = homeAnalytics?.feedInsights ?? bootstrap?.feedInsights ?? emptyInsights;
  const jobSeries = homeAnalytics?.jobSeries;
  const analyticsBusy = analyticsLoading || analyticsFetching;
  const openRequests = (bootstrap?.requests || []).filter(
    (r) => r.status !== 'published' && r.status !== 'rejected',
  );
  const allRequests = bootstrap?.requests || [];
  const allClusters = bootstrap?.clusters || [];
  const recommended =
    allClusters.filter((c) => RECOMMENDED_SLUGS.includes(c.slug)).slice(0, 3).length > 0
      ? allClusters.filter((c) => RECOMMENDED_SLUGS.includes(c.slug)).slice(0, 3)
      : allClusters.slice(0, 3);

  if (loading || !user) return null;

  const subscribedIds = new Set(subs.map((s) => s.clusterId));
  const firstName = user.name.split(' ')[0];
  const planUnresolved =
    Boolean(entitlements) &&
    (entitlements?.source === 'unknown' ||
      String(entitlements?.subscriptionType || '').toLowerCase() === 'unknown') &&
    // Soft API errors must not hide a known plan (sidebar already shows it).
    !entitlements?.subscriptionTypeDisplay &&
    !entitlements?.subscriptionType;
  const planLabel =
    entitlements?.subscriptionTypeDisplay ||
    entitlements?.subscriptionType ||
    user?.firstStepPlan?.subscriptionType ||
    'Free';
  const normalizedPlanLabel = String(planLabel)
    .replace(/PremiumPlus/i, 'Premium Plus')
    .replace(/Normal Plan/i, 'Standard')
    .replace(/FalconLite/i, 'Falcon Lite');
  const showPlanRibbon =
    Boolean(normalizedPlanLabel) &&
    normalizedPlanLabel.toLowerCase() !== 'free' &&
    normalizedPlanLabel.toLowerCase() !== 'unknown' &&
    !planUnresolved;
  const subscribedSlots =
    entitlements?.subscribedSlots ??
    entitlements?.includedSlots ??
    entitlements?.maxActiveClusters ??
    0;
  const activeCount = entitlements?.activeClusterCount ?? subs.length;
  const subscriptionOn = Boolean(entitlements?.clusterServiceStarted);
  const showEmptyPremiumHome = subscriptionOn && subscribedSlots > 0 && subs.length === 0;
  const freeSlots = Math.max(0, subscribedSlots - activeCount);
  const showRecommended = showEmptyPremiumHome || subs.length === 0;
  const slotProgress =
    subscribedSlots > 0 ? Math.min(100, Math.round((activeCount / subscribedSlots) * 100)) : 0;

  const handleRefreshPlan = async () => {
    setStarting(true);
    try {
      const ents = await getEntitlements({ refresh: true });
      setEntitlementsOverride(ents);
      await invalidatePortalShell(queryClient);
      if ((ents.subscribedSlots ?? ents.maxActiveClusters ?? 0) > 0 || ents.clusterServiceStarted) {
        notify('success', `Plan loaded: ${ents.subscriptionTypeDisplay || ents.subscriptionType}`);
      } else {
        notify(
          'error',
          ents.planError
            ? `Plan still unavailable (${ents.planError}).`
            : 'No cluster entitlement on your plan yet.',
        );
      }
    } catch (err: any) {
      notify('error', err?.response?.data?.error || err?.message || 'Could not refresh plan');
    } finally {
      setStarting(false);
    }
  };

  const load = () => {
    void refetch();
  };

  const metrics = [
    {
      label: 'Active clusters',
      value: subscribedSlots > 0 ? `${activeCount}/${subscribedSlots}` : String(activeCount),
      hint: freeSlots > 0 ? `${freeSlots} free` : 'All slots used',
      to: '/user/subscriptions',
      background: `linear-gradient(135deg, ${STITCH.primary}, ${STITCH.primaryDark})`,
      infoTitle: 'Active clusters',
      infoDescription:
        'Clusters you are currently monitoring. Each active cluster streams fresh openings into your merged ScoutX feed.',
    },
    {
      label: 'Jobs in feed',
      value: String(feedCount),
      hint: subs[0] ? FREQUENCY_LABEL[subs[0].frequency] : 'No window',
      to: '/user/feed',
      background: `linear-gradient(135deg, ${STITCH.secondary}, ${STITCH.secondaryDark})`,
      infoTitle: 'Jobs in feed',
      infoDescription:
        'Fresh roles from your active clusters, merged into one feed with search and filters.',
    },
    {
      label: 'Saved',
      value: String(savedCount),
      hint: savedCount ? pluralize(savedCount, 'role') : 'Empty',
      to: '/user/saved',
      background: 'linear-gradient(135deg, #10b981, #059669)',
      infoTitle: 'Saved jobs',
      infoDescription:
        'Roles you bookmarked for later. Open Saved Jobs anytime to revisit or apply.',
    },
    {
      label: 'Requests',
      value: String(openRequests.length),
      hint: openRequests[0] ? shortRequestHint(openRequests[0].title) : 'None open',
      to: '/user/requests',
      background: `linear-gradient(135deg, ${STITCH.primaryContainer}, ${STITCH.primary})`,
      infoTitle: 'Custom requests',
      infoDescription:
        'Custom cluster requests you submitted. Track review status and go live when published.',
    },
  ];

  const heroSub =
    subs.length > 0
      ? `Your ${subs.length} subscribed company cluster${subs.length === 1 ? '' : 's'} ${
          subs.length === 1 ? 'is' : 'are'
        } actively monitored. Fresh openings arrive straight to your feed.`
      : 'Your personalized ScoutX dashboard to track clusters, catch fresh openings, and stay ahead — all in one place.';

  const scrollToDashboard = () => {
    const section = document.getElementById('dashboard-metrics-section');
    if (!section) return;
    const offset = 80;
    const top = section.getBoundingClientRect().top + window.pageYOffset - offset;
    window.scrollTo({ top, behavior: 'smooth' });
  };

  return (
    <Box sx={{ width: '100%' }}>
      {/* ── First fold: FirstStep-style welcome hero ── */}
      <Box
        data-tour="scoutx-welcome"
        sx={{
          position: 'relative',
          mb: { xs: 3, md: 4 },
          minHeight: { xs: 'auto', md: 500 },
          overflow: 'visible',
          background: 'linear-gradient(135deg, #f8fafc 0%, #ffffff 100%)',
          // Match stats cards below — no extra inset / no centered max-width
          p: { xs: 2, sm: 2.5, md: 3 },
          pl: { xs: 0, sm: 0, md: 0 },
          pr: { xs: 2, sm: 2.5, md: 3 },
          pb: { xs: 3, sm: 4, md: 6 },
          pt: { xs: 2, sm: 3, md: 4 },
          borderBottom: `2px solid ${STITCH.secondary}`,
          ...fadeUpSx(0),
        }}
      >
        {/* Clip blobs only — ribbon must stay visible (overflow visible on parent). */}
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            inset: 0,
            overflow: 'hidden',
            pointerEvents: 'none',
            zIndex: 0,
          }}
        >
          <GradientBlob index={1} />
          <GradientBlob index={2} />
          <GradientBlob index={3} />
        </Box>

        {showPlanRibbon && (
          <Box
            sx={{
              position: 'absolute',
              top: { xs: 8, sm: 12, md: 20 },
              right: { xs: 8, sm: 12, md: 28 },
              zIndex: 10,
              // Always show — sidebar plan badge is not a substitute for the hero ribbon.
              display: 'block',
              // Keep notch triangles inside the hero (parent uses overflow:hidden).
              maxWidth: 'calc(100% - 24px)',
            }}
          >
            <PlanRibbon label={normalizedPlanLabel} />
          </Box>
        )}

        {/* Animation pinned to the right — independent of text position */}
        <Box
          sx={{
            display: { xs: 'none', md: 'block' },
            position: 'absolute',
            top: '50%',
            right: { md: 24, lg: 48 },
            width: { md: '42%', lg: '46%' },
            maxWidth: 560,
            transform: 'translateY(-50%)',
            zIndex: 1,
            pointerEvents: 'none',
          }}
        >
          <HeroVisual />
        </Box>

        {/* Copy only — left-aligned with cards below */}
        <Box
          sx={{
            position: 'relative',
            zIndex: 3,
            width: { xs: '100%', md: '48%' },
            maxWidth: { md: 520 },
            mt: { xs: 4, sm: 5, md: 13 },
            ...fadeUpSx(60),
          }}
        >
          <Typography
            component="h1"
            sx={{
              fontFamily: DISPLAY_FONT,
              fontWeight: 700,
              fontSize: { xs: '1.5rem', sm: '2rem', md: '2.75rem', lg: '3.25rem' },
              lineHeight: { xs: 1.3, md: 1.2 },
              color: STITCH.onSurface,
              mb: { xs: 1.5, sm: 2, md: 2.5 },
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
            }}
          >
            <Box component="span" sx={{ whiteSpace: { xs: 'normal', sm: 'nowrap' } }}>
              Welcome,
            </Box>
            <Box
              component="span"
              sx={{
                color: STITCH.primary,
                whiteSpace: { xs: 'normal', sm: 'nowrap' },
              }}
            >
              {firstName}!
            </Box>
          </Typography>

          <Typography
            sx={{
              color: STITCH.muted,
              fontSize: { xs: '0.8rem', sm: '0.95rem', md: '1.125rem' },
              lineHeight: { xs: 1.5, md: 1.6 },
              mb: { xs: 2, sm: 2.5, md: 3.5 },
              fontWeight: 400,
              pr: { xs: 0, md: 2 },
            }}
          >
            {heroSub}
          </Typography>

          <Box sx={{ display: 'flex', gap: { xs: 1.5, sm: 2 }, flexWrap: 'wrap' }}>
            {planUnresolved ? (
              <Button
                variant="contained"
                size="large"
                disableElevation
                disabled={starting}
                onClick={handleRefreshPlan}
                startIcon={<BoltOutlined sx={{ fontSize: 18 }} />}
                sx={{
                  ...primaryButtonSx,
                  background: `linear-gradient(135deg, ${STITCH.primary}, ${STITCH.primaryDark})`,
                  fontSize: { xs: '0.8rem', sm: '0.875rem', md: '1rem' },
                  py: { xs: 1.25, sm: 1.5 },
                  px: { xs: 2.5, sm: 3, md: 3.5 },
                  borderRadius: '24px',
                  width: { xs: '100%', sm: 'auto' },
                }}
              >
                {starting ? 'Refreshing…' : 'Refresh plan'}
              </Button>
            ) : (
              <Button
                variant="contained"
                size="large"
                disableElevation
                endIcon={<ArrowForward sx={{ fontSize: 18 }} />}
                onClick={scrollToDashboard}
                sx={{
                  // FirstStep Explore Dashboard — theme borderRadius:2 ≈ 24px pill
                  background: `linear-gradient(135deg, ${STITCH.primary}, ${STITCH.primaryDark})`,
                  color: 'white',
                  fontSize: { xs: '0.8rem', sm: '0.875rem', md: '1rem' },
                  py: { xs: 1.25, sm: 1.5 },
                  px: { xs: 2.5, sm: 3, md: 3.5 },
                  borderRadius: '24px',
                  textTransform: 'none',
                  fontWeight: 600,
                  width: { xs: '100%', sm: 'auto' },
                  boxShadow: '0 4px 14px rgba(2, 51, 69, 0.22)',
                  '&:hover': {
                    background: `linear-gradient(135deg, ${STITCH.primaryDark}, ${STITCH.primary})`,
                    transform: 'translateY(-2px)',
                    boxShadow: '0 8px 20px rgba(0, 0, 0, 0.15)',
                  },
                }}
              >
                Explore Dashboard
              </Button>
            )}
            <Button
              component={Link}
              to="/user/clusters"
              variant="outlined"
              size="large"
              startIcon={<ExploreOutlined sx={{ fontSize: 18 }} />}
              sx={{
                ...ghostButtonSx,
                py: { xs: 1.25, sm: 1.5 },
                px: { xs: 2.5, sm: 3, md: 3.5 },
                borderRadius: '24px',
                width: { xs: '100%', sm: 'auto' },
              }}
            >
              Browse clusters
            </Button>
          </Box>
        </Box>

        {/* Mobile visual — below copy only */}
        <Box sx={{ display: { xs: 'block', md: 'none' }, mt: 2, position: 'relative', zIndex: 1 }}>
          <HeroVisual />
        </Box>
      </Box>

      {/* ── Scroll: four metrics, then slots + date range, then insight KPIs ── */}
      <Box id="dashboard-metrics-section" sx={{ mt: { xs: 1, md: -1 } }}>
        {!ready ? (
          <PanelSkeleton height={140} />
        ) : (
          <Box
            data-tour="scoutx-metrics"
            sx={{
              display: 'grid',
              gridTemplateColumns: {
                xs: '1fr',
                sm: '1fr 1fr',
                md: 'repeat(4, 1fr)',
              },
              gap: { xs: 2, sm: 2.5, md: 2.5 },
              mb: { xs: 2.5, md: 3 },
              ...fadeUpSx(20),
            }}
          >
            {metrics.map((m) => (
              <Box key={m.label} sx={{ position: 'relative' }}>
                <InfoTipButton
                  light
                  onClick={() => handleInfoClick(m.infoTitle, m.infoDescription)}
                />
                <Box
                  component={Link}
                  to={m.to}
                  sx={{
                    display: 'block',
                    textDecoration: 'none',
                    color: 'white',
                    borderRadius: '6px',
                    background: m.background,
                    p: { xs: 2, sm: 2.25, md: 2.5 },
                    textAlign: 'center',
                    position: 'relative',
                    overflow: 'hidden',
                    height: '100%',
                    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.12)',
                    transition: `transform 0.35s ${EASE}, box-shadow 0.35s ${EASE}`,
                    '&::before': {
                      content: '""',
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      height: '4px',
                      background: 'rgba(255,255,255,0.35)',
                      borderRadius: '50px 50px 0 0',
                    },
                    '&:hover': {
                      [MOTION_SAFE]: {
                        transform: 'translateY(-6px) scale(1.02)',
                        boxShadow: '0 16px 40px rgba(0, 0, 0, 0.18)',
                      },
                    },
                  }}
                >
                  <Typography
                    sx={{
                      fontFamily: DISPLAY_FONT,
                      fontWeight: 700,
                      mb: 1,
                      fontSize: { xs: '1.5rem', sm: '1.75rem', md: '2rem' },
                      lineHeight: 1.1,
                      color: 'white',
                    }}
                  >
                    {m.value}
                  </Typography>
                  <Typography
                    sx={{
                      fontWeight: 600,
                      fontSize: { xs: '0.85rem', sm: '0.95rem' },
                      color: 'rgba(255,255,255,0.95)',
                      mb: 0.35,
                    }}
                  >
                    {m.label}
                  </Typography>
                  <Typography
                    sx={{
                      fontSize: { xs: '0.65rem', sm: '0.7rem' },
                      color: 'rgba(255,255,255,0.75)',
                    }}
                    noWrap
                  >
                    {m.hint}
                  </Typography>
                </Box>
              </Box>
            ))}
          </Box>
        )}

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: {
              xs: '1fr',
              md: subscribedSlots > 0 && ready ? '1fr 1fr' : '1fr',
            },
            gap: { xs: 2, md: 2.5 },
            mb: { xs: 2.5, md: 3 },
            ...fadeUpSx(30),
          }}
        >
          {subscribedSlots > 0 && ready && (
            <Box
              sx={{
                p: { xs: 2, sm: 2.5, md: 3 },
                borderRadius: '6px',
                bgcolor: STITCH.surfaceLowest,
                border: '1px solid rgba(226, 232, 240, 0.8)',
                background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)',
                position: 'relative',
                overflow: 'hidden',
                boxShadow: '0 4px 20px rgba(0, 0, 0, 0.06)',
                '&::before': {
                  content: '""',
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  height: '4px',
                  background: `linear-gradient(90deg, ${STITCH.primary}, ${STITCH.secondary})`,
                  borderRadius: '50px 50px 0 0',
                },
              }}
            >
              <InfoTipButton
                onClick={() =>
                  handleInfoClick(
                    'Cluster slots used',
                    'Only Premium Plus includes 2 clusters in the plan. Other plans get slots when ops starts subscription and assigns an allotment. Active clusters count against that limit.',
                  )
                }
              />
              <Typography
                sx={{
                  fontFamily: DISPLAY_FONT,
                  color: STITCH.primary,
                  fontWeight: 700,
                  mb: 1.5,
                  fontSize: { xs: '1.1rem', sm: '1.25rem', md: '1.35rem' },
                  pr: 4,
                }}
              >
                Cluster slots used
              </Typography>
              <Stack direction="row" justifyContent="space-between" sx={{ mb: 1 }}>
                <Typography sx={{ fontSize: '0.85rem', color: STITCH.muted }}>
                  {activeCount} of {subscribedSlots} slots in use
                </Typography>
                <Typography sx={{ fontSize: '0.85rem', fontWeight: 600, color: STITCH.onSurface }}>
                  {slotProgress}%
                </Typography>
              </Stack>
              <LinearProgress
                variant="determinate"
                value={slotProgress}
                sx={{
                  height: 12,
                  borderRadius: 8,
                  bgcolor: '#e2e8f0',
                  '& .MuiLinearProgress-bar': {
                    borderRadius: 8,
                    background: `linear-gradient(90deg, #10b981, ${STITCH.secondary})`,
                  },
                }}
              />
            </Box>
          )}

          <Box
            data-tour="scoutx-date-range"
            sx={{
              p: { xs: 2, sm: 2.5, md: 3 },
              borderRadius: '6px',
              bgcolor: STITCH.surfaceLowest,
              border: '1px solid rgba(226, 232, 240, 0.8)',
              background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)',
              position: 'relative',
              overflow: 'hidden',
              boxShadow: '0 4px 20px rgba(0, 0, 0, 0.06)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              '&::before': {
                content: '""',
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: '4px',
                background: `linear-gradient(90deg, ${STITCH.secondary}, ${STITCH.primary})`,
                borderRadius: '50px 50px 0 0',
              },
            }}
          >
            <InfoTipButton
              onClick={() =>
                handleInfoClick(
                  'Date range',
                  'Filters top companies, top roles, and the jobs-over-time chart to the selected window. Default is the last 7 days.',
                )
              }
            />
            <Typography
              sx={{
                fontFamily: DISPLAY_FONT,
                color: STITCH.primary,
                fontWeight: 700,
                mb: 1.5,
                fontSize: { xs: '1.1rem', sm: '1.25rem', md: '1.35rem' },
                pr: 4,
              }}
            >
              Date range
            </Typography>
            <FormControl fullWidth size="small">
              <InputLabel id="home-analytics-range-label">Show data for</InputLabel>
              <Select
                labelId="home-analytics-range-label"
                value={analyticsRange}
                label="Show data for"
                onChange={handleRangeChange}
                sx={{
                  borderRadius: '10px',
                  bgcolor: '#fff',
                  '& .MuiOutlinedInput-notchedOutline': { borderColor: '#e2e8f0' },
                }}
              >
                {HOME_ANALYTICS_RANGE_OPTIONS.map((opt) => (
                  <MenuItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>
        </Box>

        {ready && (
          <Box
            data-tour="scoutx-insights"
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
              gap: { xs: 2, sm: 2.5, md: 2.5 },
              mb: { xs: 4, md: 5 },
              ...fadeUpSx(40),
            }}
          >
            <Box
              sx={{
                position: 'relative',
                p: { xs: 2, sm: 2.25 },
                borderRadius: '6px',
                bgcolor: '#fff',
                border: '1px solid #e2e8f0',
                boxShadow: '0 4px 16px rgba(0,0,0,0.06)',
                minHeight: 140,
              }}
            >
              <InfoTipButton
                onClick={() =>
                  handleInfoClick(
                    'Top companies',
                    'Companies appearing most often in your active cluster feeds for the selected date range.',
                  )
                }
              />
              {analyticsBusy && !homeAnalytics ? (
                <PanelSkeleton height={100} />
              ) : (
                <InsightBucketColumn heading="Top companies" rows={feedInsights.companies} compact />
              )}
            </Box>

            <Box
              sx={{
                position: 'relative',
                p: { xs: 2, sm: 2.25 },
                borderRadius: '6px',
                bgcolor: '#fff',
                border: '1px solid #e2e8f0',
                boxShadow: '0 4px 16px rgba(0,0,0,0.06)',
                minHeight: 140,
              }}
            >
              <InfoTipButton
                onClick={() =>
                  handleInfoClick(
                    'Top roles',
                    'Role categories appearing most often in your feeds for the selected date range.',
                  )
                }
              />
              {analyticsBusy && !homeAnalytics ? (
                <PanelSkeleton height={100} />
              ) : (
                <InsightBucketColumn heading="Top roles" rows={feedInsights.categories} compact />
              )}
            </Box>
          </Box>
        )}
      </Box>

      {(planUnresolved || showEmptyPremiumHome) && (
        <Box sx={{ mb: 4 }}>
          {planUnresolved && (
            <EmptyState
              icon={BoltOutlined}
              title="Plan not synced"
              description="ScoutX needs your plan entitlements. Refresh after the plan service is running."
              actionLabel={starting ? 'Refreshing…' : 'Refresh plan'}
              onAction={starting ? undefined : handleRefreshPlan}
            />
          )}
          {showEmptyPremiumHome && (
            <EmptyState
              icon={ExploreOutlined}
              title="Pick your first cluster"
              description={`You have ${subscribedSlots} included slot${subscribedSlots === 1 ? '' : 's'} on ${normalizedPlanLabel}.`}
              actionLabel="Browse clusters"
              actionTo="/user/clusters"
            />
          )}
        </Box>
      )}

      {/* ── Your activity: two large side-by-side cards ── */}
      <Box data-tour="scoutx-activity">
      <Typography
        sx={{
          fontFamily: DISPLAY_FONT,
          fontWeight: 700,
          fontSize: { xs: '1.2rem', md: '1.35rem' },
          color: STITCH.primary,
          letterSpacing: '-0.02em',
          mb: 2,
          ...fadeUpSx(80),
        }}
      >
        Your activity
      </Typography>

      <Grid container spacing={2.5} sx={{ mb: 4 }}>
        <Grid item xs={12} lg={6}>
          <SectionShell
            title="Your clusters"
            actionLabel="Manage"
            actionTo="/user/subscriptions"
            delay={100}
            tall
            infoTitle="Your clusters"
            infoDescription="Active company clusters you monitor. Open each feed or manage delivery windows from Subscriptions."
            onInfoClick={handleInfoClick}
          >
            {!ready ? (
              <JobListSkeleton count={3} />
            ) : subs.length === 0 ? (
              <Stack spacing={2} alignItems="flex-start">
                <Typography sx={{ color: STITCH.muted, fontSize: '0.95rem', lineHeight: 1.55 }}>
                  No active clusters yet. Browse the catalog to start monitoring roles.
                </Typography>
                <Button
                  component={Link}
                  to="/user/clusters"
                  variant="contained"
                  disableElevation
                  sx={primaryButtonSx}
                >
                  Browse clusters
                </Button>
              </Stack>
            ) : (
              <Stack spacing={{ xs: 1, sm: 1.5 }}>
                {subs.map((sub) => {
                  const cluster = allClusters.find((c) => c.id === sub.clusterId);
                  const name = humanLabel(sub.clusterName, 'Custom cluster');
                  return (
                    <Box
                      key={sub.id}
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1.5,
                        p: { xs: 1, sm: 1.5 },
                        borderRadius: '12px',
                        background: '#f8fafc',
                        border: '1px solid #e2e8f0',
                        transition: 'all 0.2s ease',
                        '&:hover': {
                          background: '#f1f5f9',
                          [MOTION_SAFE]: { transform: 'translateX(4px)' },
                        },
                      }}
                    >
                      <Box
                        sx={{
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          bgcolor: STITCH.secondary,
                          flexShrink: 0,
                        }}
                      />
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap>
                          <Typography sx={{ fontWeight: 600, fontSize: { xs: '0.85rem', sm: '0.95rem' }, color: STITCH.onSurface }} noWrap>
                            {name}
                          </Typography>
                          <Chip
                            size="small"
                            label={FREQUENCY_LABEL[sub.frequency]}
                            sx={{
                              height: 22,
                              borderRadius: RADIUS.pill,
                              fontWeight: 700,
                              fontSize: '0.68rem',
                              bgcolor: STITCH.secondaryContainer,
                              color: STITCH.onSecondaryContainer,
                            }}
                          />
                        </Stack>
                        <Typography sx={{ mt: 0.25, fontSize: '0.75rem', color: STITCH.muted }}>
                          {cluster?.jobCountPreview ?? '—'} roles · next {timeUntil(sub.nextRefreshAt)}
                        </Typography>
                      </Box>
                      <Button
                        component={Link}
                        to={`/user/feed/${sub.id}`}
                        size="small"
                        variant="contained"
                        disableElevation
                        sx={{
                          ...primaryButtonSx,
                          py: 0.75,
                          px: 1.75,
                          flexShrink: 0,
                          borderRadius: '24px',
                        }}
                      >
                        Feed
                      </Button>
                    </Box>
                  );
                })}
              </Stack>
            )}
          </SectionShell>
        </Grid>

        <Grid item xs={12} lg={6}>
          <SectionShell
            title="Recent jobs"
            actionLabel={`Full feed (${feedCount})`}
            actionTo="/user/feed"
            delay={140}
            tall
            infoTitle="Recent jobs"
            infoDescription="The latest openings from your active clusters. Save roles or open the full feed for search and filters."
            onInfoClick={handleInfoClick}
          >
            {!ready ? (
              <JobListSkeleton count={4} />
            ) : latestJobs.length === 0 ? (
              <Typography sx={{ color: STITCH.muted, fontSize: '0.95rem', lineHeight: 1.55 }}>
                {subs.length === 0
                  ? 'Activate a cluster to see fresh roles here.'
                  : 'Nothing new since the last refresh.'}
              </Typography>
            ) : (
              <Stack spacing={{ xs: 1, sm: 1.5 }}>
                {latestJobs.map((job) => (
                  <Box
                    key={job.id}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: { xs: 1, sm: 1.5 },
                      p: { xs: 1, sm: 1.5 },
                      borderRadius: '12px',
                      background: '#f8fafc',
                      border: '1px solid #e2e8f0',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      '&:hover': {
                        background: '#f1f5f9',
                        [MOTION_SAFE]: { transform: 'translateX(4px)' },
                      },
                    }}
                    onClick={() => navigate(`/user/jobs/${job.id}`)}
                  >
                    <Avatar
                      src={job.logoUrl}
                      alt=""
                      sx={{
                        width: { xs: 36, sm: 40 },
                        height: { xs: 36, sm: 40 },
                        fontSize: '0.8rem',
                        fontWeight: 700,
                        bgcolor: STITCH.surfaceLowest,
                        color: STITCH.primary,
                        border: '1px solid #e2e8f0',
                      }}
                    >
                      {job.company.charAt(0)}
                    </Avatar>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography
                        sx={{
                          fontWeight: 600,
                          fontSize: { xs: '0.8rem', sm: '0.875rem' },
                          color: STITCH.onSurface,
                          mb: 0.25,
                        }}
                        noWrap
                      >
                        {job.title}
                      </Typography>
                      <Typography sx={{ fontSize: { xs: '0.7rem', sm: '0.75rem' }, color: STITCH.muted }} noWrap>
                        {job.company}
                        {job.location ? ` · ${job.location}` : ''}
                        {' · '}
                        {timeAgo(job.postedAt)}
                      </Typography>
                    </Box>
                    <Button
                      size="small"
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (job.saved) await unsaveJob(job.id);
                        else await saveJob(job.id);
                        load();
                      }}
                      sx={{ minWidth: 0, px: 0.75, color: job.saved ? STITCH.secondaryDark : STITCH.muted }}
                    >
                      <BookmarkBorder sx={{ fontSize: 20 }} />
                    </Button>
                  </Box>
                ))}
              </Stack>
            )}
          </SectionShell>
        </Grid>
      </Grid>
      </Box>

      {/* ── Jobs over time (follows date range) ── */}
      <Box data-tour="scoutx-jobs-chart" sx={{ mb: 4, ...fadeUpSx(160) }}>
        <SectionShell
          title="Jobs over time"
          actionLabel="Open feed"
          actionTo="/user/feed"
          delay={160}
          infoTitle="Jobs over time"
          infoDescription="Total jobs in your feeds for the selected date range. Use the cluster chips on the chart to show all clusters or focus on one."
          onInfoClick={handleInfoClick}
        >
          <Typography sx={{ fontSize: '0.8rem', color: STITCH.muted, mb: 2, mt: -1 }}>
            {HOME_ANALYTICS_RANGE_OPTIONS.find((o) => o.value === analyticsRange)?.label ||
              'Selected range'}
            {feedInsights.sampleSize > 0
              ? ` · sample of ${feedInsights.sampleSize} ${
                  feedInsights.sampleSize === 1 ? 'role' : 'roles'
                }`
              : ''}
          </Typography>
          <JobsOverTimeChart series={jobSeries} loading={analyticsBusy && !jobSeries} />
        </SectionShell>
      </Box>

      {/* ── My requests (when any) ── */}
      {allRequests.length > 0 && (
        <Box sx={{ mb: 4 }}>
          <SectionShell
            title="My requests"
            actionLabel="View all"
            actionTo="/user/requests"
            delay={160}
            infoTitle="My requests"
            infoDescription="Custom cluster requests you submitted. Track review status and see when a request goes live."
            onInfoClick={handleInfoClick}
          >
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} useFlexGap flexWrap="wrap">
              {allRequests.slice(0, 3).map((req) => {
                const title = humanLabel(req.title, 'Custom cluster request');
                const statusLabel =
                  req.status === 'published'
                    ? 'Live'
                    : req.status === 'in_review'
                      ? 'In review'
                      : req.status === 'rejected'
                        ? 'Rejected'
                        : 'Submitted';
                return (
                  <Box
                    key={req.id}
                    sx={{
                      flex: { md: '1 1 240px' },
                      p: { xs: 1.5, sm: 2 },
                      borderRadius: '12px',
                      background: '#f8fafc',
                      border: '1px solid #e2e8f0',
                      minWidth: 0,
                      transition: 'all 0.2s ease',
                      '&:hover': {
                        background: '#f1f5f9',
                        [MOTION_SAFE]: { transform: 'translateX(4px)' },
                      },
                    }}
                  >
                    <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography sx={{ fontWeight: 600, color: STITCH.onSurface, fontSize: '0.9rem' }} noWrap>
                          {title}
                        </Typography>
                        <Typography sx={{ fontSize: '0.75rem', color: STITCH.muted, mt: 0.5 }}>
                          {new Date(req.submittedAt).toLocaleDateString()}
                        </Typography>
                      </Box>
                      <Chip
                        size="small"
                        label={statusLabel}
                        sx={{
                          height: 22,
                          borderRadius: RADIUS.pill,
                          fontWeight: 700,
                          fontSize: '0.68rem',
                          bgcolor:
                            req.status === 'published'
                              ? tint(STITCH.success, 0.16)
                              : tint(STITCH.warning, 0.18),
                          color: req.status === 'published' ? STITCH.success : '#8a5a00',
                        }}
                      />
                    </Stack>
                  </Box>
                );
              })}
              <Button
                component={Link}
                to="/user/requests/new"
                startIcon={<EditNoteOutlined sx={{ fontSize: 18 }} />}
                sx={{ ...ghostButtonSx, borderRadius: '24px', alignSelf: { md: 'center' } }}
              >
                New request
              </Button>
            </Stack>
          </SectionShell>
        </Box>
      )}

      {/* ── Recommended (when relevant) ── */}
      {showRecommended && (
        <Box sx={{ mb: 5, ...fadeUpSx(180) }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
            <Typography
              sx={{
                fontFamily: DISPLAY_FONT,
                fontWeight: 700,
                fontSize: { xs: '1.15rem', md: '1.3rem' },
                color: STITCH.primary,
                letterSpacing: '-0.02em',
              }}
            >
              Recommended clusters
            </Typography>
            <Button
              component={Link}
              to="/user/clusters"
              size="small"
              endIcon={<ArrowForward sx={{ fontSize: 14 }} />}
              sx={{ textTransform: 'none', fontWeight: 600, color: STITCH.secondaryDark }}
            >
              See all
            </Button>
          </Stack>
          {!ready ? (
            <ClusterGridSkeleton count={3} />
          ) : (
            <Grid container spacing={2}>
              {recommended.map((c) => (
                <Grid item xs={12} sm={6} lg={4} key={c.id}>
                  <ClusterCard
                    cluster={{ ...c, name: humanLabel(c.name, c.name) }}
                    subscribed={subscribedIds.has(c.id)}
                  />
                </Grid>
              ))}
            </Grid>
          )}
        </Box>
      )}

      {/* FirstStep-style info dialog */}
      <Dialog
        open={infoDialogOpen}
        onClose={handleInfoClose}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: '16px',
            m: { xs: 2, sm: 3 },
          },
        }}
      >
        <DialogTitle
          sx={{
            fontFamily: DISPLAY_FONT,
            fontWeight: 600,
            color: STITCH.primary,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 1,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <InfoOutlined sx={{ fontSize: 22 }} />
            {infoDialogContent?.title}
          </Box>
          <IconButton
            onClick={handleInfoClose}
            size="small"
            sx={{
              color: STITCH.muted,
              '&:hover': { backgroundColor: 'rgba(0, 0, 0, 0.04)' },
            }}
          >
            <Close sx={{ fontSize: 20 }} />
          </IconButton>
        </DialogTitle>
        <DialogContent>
          <Typography
            sx={{
              color: STITCH.onSurface,
              lineHeight: 1.6,
              mt: 0.5,
              fontSize: '1rem',
            }}
          >
            {infoDialogContent?.description}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ p: 2, pt: 0 }}>
          <Button
            onClick={handleInfoClose}
            variant="contained"
            disableElevation
            sx={{
              borderRadius: '24px',
              textTransform: 'none',
              fontWeight: 600,
              px: 3,
              background: STITCH.primary,
              '&:hover': { background: STITCH.primaryDark },
            }}
          >
            Got it
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
