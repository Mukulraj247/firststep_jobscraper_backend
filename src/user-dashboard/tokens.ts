/**
 * ScoutText customer portal tokens — aligned to FirstStep user dashboard.
 * Kept portal-local so ops tokens stay untouched.
 */

export const STITCH = {
  // Brand / structure — FirstStep theme.ts + #023345 lockup
  primary: '#023345',
  primaryContainer: '#1e4a5f',
  onPrimary: '#ffffff',
  onPrimaryContainer: '#5b8fa3',
  primaryFixed: '#e8f2f6',
  primaryFixedDim: '#5b8fa3',
  onPrimaryFixed: '#0f2633',
  primaryDark: '#0f2633',
  primaryLight: '#5b8fa3',

  // Accent / secondary — FirstStep teal
  secondary: '#4fb3a9',
  secondaryBright: '#4fb3a9',
  secondaryDark: '#357a7a',
  onSecondary: '#ffffff',
  secondaryContainer: '#e6f7f5',
  onSecondaryContainer: '#1e4a5f',
  secondaryFixed: '#7dd3d8',
  secondaryFixedDim: '#4fb3a9',

  // Tertiary / depth
  tertiary: '#0f2633',
  tertiaryContainer: '#034a63',
  tertiaryFixedDim: '#7dd3d8',
  onTertiaryContainer: '#1e4a5f',

  // Surfaces — cool gray, not lavender
  background: '#f8fafb',
  surface: '#f8fafc',
  surfaceBright: '#ffffff',
  surfaceDim: '#e2e8f0',
  surfaceLowest: '#ffffff',
  surfaceLow: '#f1f5f9',
  surfaceContainer: '#eef4f6',
  surfaceHigh: '#e2e8f0',
  surfaceHighest: '#dbe7ec',
  onSurface: '#1e293b',
  onSurfaceVariant: '#64748b',
  outline: '#94a3b8',
  outlineVariant: '#e2e8f0',
  border: 'rgba(226, 232, 240, 0.9)',
  muted: '#64748b',

  // Semantic
  error: '#ba1a1a',
  errorContainer: '#ffdad6',
  success: '#10b981',
  warning: '#f59e0b',
} as const;

/** Back-compat aliases so existing portal components keep compiling. */
export const FIRSTSTEP = {
  navy: STITCH.primaryContainer,
  navyDeep: STITCH.primary,
  navyInk: STITCH.primaryDark,
  teal: STITCH.secondaryBright,
  tealDark: STITCH.secondaryDark,
  tealDeep: STITCH.secondaryDark,
  surface: STITCH.background,
  surfaceAlt: STITCH.surfaceLow,
  white: STITCH.surfaceLowest,
  border: STITCH.outlineVariant,
  textMuted: STITCH.muted,
  success: STITCH.success,
  successDeep: '#059669',
  danger: STITCH.error,
  warning: STITCH.warning,
} as const;

/** FirstStep: cards 16 · controls 12 · chips pill */
export const RADIUS = {
  card: '16px',
  panel: '16px',
  control: '12px',
  xl: '16px',
  sm: '6px',
  md: '12px',
  pill: '9999px',
} as const;

export const tint = (color: string, alpha: number) => {
  const hex = color.replace('#', '');
  const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

export const DISPLAY_FONT = "'Geologica', 'Rotunda Regular', system-ui, sans-serif";
export const BODY_FONT = "'Geologica', 'Inter', system-ui, sans-serif";

export const PORTAL_NAV_WIDTH = 280;
export const PORTAL_TOPBAR_HEIGHT = 96;
export const PAGE_MAX_WIDTH = 1440;

export const SHADOW = {
  xs: '0 4px 20px rgba(0, 0, 0, 0.08)',
  sm: '0 8px 24px rgba(2, 51, 69, 0.08)',
  md: '0 12px 40px rgba(0, 0, 0, 0.12)',
  lg: '0 20px 60px rgba(0, 0, 0, 0.15)',
  teal: '0 4px 12px rgba(30, 74, 95, 0.22)',
  cardHover: '0 12px 40px rgba(0, 0, 0, 0.15)',
} as const;

export const MOTION_SAFE = '@media (prefers-reduced-motion: no-preference)';
export const EASE = 'cubic-bezier(0.4, 0, 0.2, 1)';

export const HERO_GRADIENT = 'linear-gradient(135deg, #f8fafc 0%, #ffffff 100%)';

const accentBar = {
  content: '""',
  position: 'absolute' as const,
  top: 0,
  left: 0,
  right: 0,
  height: 4,
  background: `linear-gradient(90deg, ${STITCH.primaryContainer}, ${STITCH.secondary})`,
  borderRadius: '16px 16px 0 0',
};

/** FirstStep cards: white → slate wash, hairline border. */
export const panelSx = {
  bgcolor: STITCH.surfaceLowest,
  background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)',
  border: '1px solid rgba(226, 232, 240, 0.8)',
  borderRadius: RADIUS.card,
  boxShadow: SHADOW.xs,
} as const;

/** Major dashboard cards — FirstStep 4px navy→teal bar. */
export const featuredPanelSx = {
  ...panelSx,
  position: 'relative' as const,
  overflow: 'hidden' as const,
  '&::before': accentBar,
} as const;

export const interactivePanelSx = {
  ...featuredPanelSx,
  transition: `transform 300ms ${EASE}, box-shadow 300ms ${EASE}`,
  '&:hover': {
    boxShadow: SHADOW.cardHover,
    [MOTION_SAFE]: { transform: 'translateY(-4px)' },
  },
} as const;

export const pillSx = {
  borderRadius: RADIUS.pill,
  fontWeight: 600,
} as const;

/** FirstStep primary CTA — navy gradient. */
export const primaryButtonSx = {
  borderRadius: RADIUS.control,
  fontWeight: 600,
  textTransform: 'none' as const,
  px: 2.5,
  fontFamily: BODY_FONT,
  background: `linear-gradient(135deg, ${STITCH.primaryContainer}, ${STITCH.primaryDark})`,
  color: STITCH.onPrimary,
  boxShadow: SHADOW.teal,
  '&:hover': {
    background: `linear-gradient(135deg, ${STITCH.primaryDark}, ${STITCH.primaryContainer})`,
    boxShadow: '0 8px 20px rgba(0, 0, 0, 0.15)',
    [MOTION_SAFE]: { transform: 'translateY(-2px)' },
  },
};

/** FirstStep secondary CTA — teal. */
export const accentButtonSx = {
  borderRadius: RADIUS.control,
  fontWeight: 600,
  textTransform: 'none' as const,
  px: 2.5,
  fontFamily: BODY_FONT,
  bgcolor: STITCH.secondary,
  color: STITCH.onSecondary,
  boxShadow: `0 4px 12px ${tint(STITCH.secondary, 0.32)}`,
  '&:hover': { bgcolor: STITCH.secondaryDark, color: STITCH.onSecondary },
};

export const ghostButtonSx = {
  borderRadius: RADIUS.control,
  fontWeight: 600,
  textTransform: 'none' as const,
  px: 2,
  fontFamily: BODY_FONT,
  color: STITCH.primary,
  borderColor: STITCH.primary,
  bgcolor: STITCH.surfaceLowest,
  borderWidth: 1,
  '&:hover': {
    borderColor: STITCH.primary,
    bgcolor: tint(STITCH.primary, 0.04),
    borderWidth: 1,
  },
};

export const ACCENTS = {
  teal: STITCH.secondaryBright,
  tealDark: STITCH.secondaryDark,
  navy: STITCH.primaryContainer,
  amber: STITCH.warning,
  green: STITCH.success,
  red: STITCH.error,
} as const;

export type AccentKey = keyof typeof ACCENTS;

/** Re-exports used by older portal files that imported ops helpers. */
export {
  HERO_GLASS_GRADIENT,
  heroGlassPanelSx,
  heroGlassOverlineSx,
  heroGlassTitleSx,
  heroGlassSubtitleSx,
  heroGlassPillSx,
  heroGlassPillTextSx,
  heroGlassPrimaryButtonSx,
  heroGlassGhostButtonSx,
  cardSx,
  hiddenScrollbarSx,
  fadeUpSx,
} from '../components/dashboard/ops/dashboardTokens';
