/**
 * ScoutText customer portal tokens — aligned to the Stitch DESIGN.md system.
 * Kept portal-local so ops FirstStep tokens stay untouched.
 */

export const STITCH = {
  // Brand / structure
  primary: '#001d29',
  primaryContainer: '#023345',
  onPrimary: '#ffffff',
  onPrimaryContainer: '#759cb1',
  primaryFixed: '#c1e8ff',
  primaryFixedDim: '#a4cce3',
  onPrimaryFixed: '#001e2b',

  // Accent / secondary
  secondary: '#006a63',
  secondaryBright: '#4fb3a9',
  secondaryDark: '#2a8e9e',
  onSecondary: '#ffffff',
  secondaryContainer: '#8ff1e5',
  onSecondaryContainer: '#006f67',
  secondaryFixed: '#92f3e8',
  secondaryFixedDim: '#75d7cc',

  // Tertiary / hero depth
  tertiary: '#001d22',
  tertiaryContainer: '#00343c',
  tertiaryFixedDim: '#7ad4e5',
  onTertiaryContainer: '#44a2b3',

  // Surfaces
  background: '#f8f9ff',
  surface: '#f8f9ff',
  surfaceBright: '#f8f9ff',
  surfaceDim: '#cbdbf5',
  surfaceLowest: '#ffffff',
  surfaceLow: '#eff4ff',
  surfaceContainer: '#e5eeff',
  surfaceHigh: '#dce9ff',
  surfaceHighest: '#d3e4fe',
  onSurface: '#0b1c30',
  onSurfaceVariant: '#41484c',
  outline: '#72787c',
  outlineVariant: '#c1c7cc',
  border: '#e2e8f0',
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
  navyInk: STITCH.primary,
  teal: STITCH.secondaryBright,
  tealDark: STITCH.secondaryDark,
  tealDeep: STITCH.secondary,
  surface: STITCH.background,
  surfaceAlt: STITCH.surfaceLow,
  white: STITCH.surfaceLowest,
  border: STITCH.border,
  textMuted: STITCH.muted,
  success: STITCH.success,
  successDeep: '#059669',
  danger: STITCH.error,
  warning: STITCH.warning,
} as const;

/** Stitch Tailwind: DEFAULT 4px · lg 8px · xl 12px · full pill */
export const RADIUS = {
  card: '12px',
  panel: '12px',
  control: '12px',
  xl: '12px',
  sm: '4px',
  md: '8px',
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

export const DISPLAY_FONT = "'Outfit', 'Geologica', system-ui, sans-serif";
export const BODY_FONT = "'Inter', system-ui, sans-serif";

export const PORTAL_NAV_WIDTH = 280;
export const PORTAL_TOPBAR_HEIGHT = 64;
export const PAGE_MAX_WIDTH = 1440;

export const SHADOW = {
  xs: '0 1px 8px rgba(0,0,0,0.04)',
  sm: `0 4px 20px -2px ${tint(STITCH.primaryContainer, 0.04)}`,
  md: `0 12px 28px -4px ${tint(STITCH.primaryContainer, 0.08)}, 0 0 0 1px ${tint(STITCH.secondaryBright, 0.3)}`,
  lg: `0 20px 40px -10px ${tint(STITCH.primary, 0.16)}`,
  teal: `0 4px 12px ${tint(STITCH.primaryContainer, 0.18)}`,
  cardHover: `0 10px 24px -4px ${tint(STITCH.secondaryBright, 0.18)}`,
} as const;

export const MOTION_SAFE = '@media (prefers-reduced-motion: no-preference)';
export const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

export const HERO_GRADIENT =
  `linear-gradient(135deg, ${STITCH.primaryContainer} 0%, ${STITCH.tertiaryContainer} 48%, ${STITCH.secondary} 128%)`;

/** Stitch cards: white + soft shadow, no hard border. */
export const panelSx = {
  bgcolor: STITCH.surfaceLowest,
  border: 'none',
  borderRadius: RADIUS.card,
  boxShadow: SHADOW.xs,
} as const;

export const interactivePanelSx = {
  ...panelSx,
  transition: `transform 220ms ${EASE}, box-shadow 220ms ${EASE}, border-color 220ms ${EASE}`,
  '&:hover': {
    borderColor: tint(STITCH.secondaryBright, 0.45),
    boxShadow: SHADOW.cardHover,
    [MOTION_SAFE]: { transform: 'translateY(-2px)' },
  },
} as const;

export const pillSx = {
  borderRadius: RADIUS.pill,
  fontWeight: 600,
} as const;

/** Deep navy primary — matches Stitch "View Live Feed" / Subscribe CTAs. */
export const primaryButtonSx = {
  borderRadius: RADIUS.control,
  fontWeight: 600,
  textTransform: 'none' as const,
  px: 2.5,
  fontFamily: BODY_FONT,
  bgcolor: STITCH.primary,
  color: STITCH.onPrimary,
  boxShadow: SHADOW.teal,
  '&:hover': { bgcolor: STITCH.primaryContainer, boxShadow: SHADOW.teal },
};

/** Stitch secondary CTA — `bg-secondary` (#006a63) + white label (Browse / Apply). */
export const accentButtonSx = {
  borderRadius: RADIUS.control,
  fontWeight: 600,
  textTransform: 'none' as const,
  px: 2.5,
  fontFamily: BODY_FONT,
  bgcolor: STITCH.secondary,
  color: STITCH.onSecondary,
  boxShadow: `0 4px 12px ${tint(STITCH.secondary, 0.28)}`,
  '&:hover': { bgcolor: STITCH.onSecondaryContainer, color: STITCH.onSecondary },
};

export const ghostButtonSx = {
  borderRadius: RADIUS.control,
  fontWeight: 600,
  textTransform: 'none' as const,
  px: 2,
  fontFamily: BODY_FONT,
  color: STITCH.primaryContainer,
  borderColor: STITCH.border,
  bgcolor: STITCH.surfaceLowest,
  '&:hover': {
    borderColor: STITCH.secondaryBright,
    bgcolor: tint(STITCH.secondaryBright, 0.08),
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
