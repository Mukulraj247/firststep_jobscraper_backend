import type { Theme } from '@mui/material';
import type { SystemStyleObject } from '@mui/system';

/**
 * Ported from the FirstStep marketing/product design system so the ops console
 * reads as the same product. Sources: FIRSTSTEP/front/src/index.css,
 * tailwind.config.js and the dashboard `StyledCard` primitive.
 */
export const FIRSTSTEP = {
  navy: '#023345',
  navyDeep: '#002941',
  navyInk: '#001d29',
  teal: '#4fb3a9',
  tealDark: '#2a8e9e',
  tealDeep: '#357a7a',
  surface: '#f8f9fa',
  surfaceAlt: '#f8fafc',
  white: '#ffffff',
  border: '#e2e8f0',
  textMuted: '#64748b',
  success: '#10b981',
  successDeep: '#059669',
  danger: '#d32f2f',
  warning: '#f59e0b',
} as const;

export const METRIC_COLORS = {
  runs: FIRSTSTEP.navy,
  passed: FIRSTSTEP.success,
  failed: FIRSTSTEP.danger,
  jobs: FIRSTSTEP.tealDark,
  rows: FIRSTSTEP.tealDeep,
  active: FIRSTSTEP.teal,
  cpu: '#c45c26',
  memory: FIRSTSTEP.tealDark,
  load: FIRSTSTEP.navy,
} as const;

export const RADIUS = {
  card: '16px',
  panel: '20px',
  control: '12px',
  pill: '9999px',
} as const;

/** Translucent tint of a metric colour, for icon chips and pill backgrounds. */
export const tint = (color: string, alpha: number) => {
  const hex = color.replace('#', '');
  const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

/** Navy → teal band used for page headers, mirroring the FirstStep hero. */
export const HERO_GRADIENT =
  `linear-gradient(135deg, ${FIRSTSTEP.navyInk} 0%, ${FIRSTSTEP.navy} 48%, ${FIRSTSTEP.tealDeep} 128%)`;

/** Frosted glass panel fill for ops page heroes. */
export const HERO_GLASS_GRADIENT =
  `linear-gradient(135deg, rgba(255, 255, 255, 0.94) 0%, rgba(232, 248, 246, 0.82) 42%, rgba(255, 255, 255, 0.9) 100%)`;

/** Shared glass hero shell used on dashboard, automations, and failures pages. */
export const heroGlassPanelSx = (
  options: { mb?: number | SystemStyleObject<Theme>['mb']; shadow?: 'soft' | 'lifted' } = {},
): SystemStyleObject<Theme> => ({
  position: 'relative',
  overflow: 'hidden',
  isolation: 'isolate',
  borderRadius: RADIUS.panel,
  background: HERO_GLASS_GRADIENT,
  backdropFilter: 'blur(22px) saturate(165%)',
  WebkitBackdropFilter: 'blur(22px) saturate(165%)',
  border: '1px solid rgba(255, 255, 255, 0.82)',
  boxShadow:
    options.shadow === 'lifted'
      ? `
        inset 0 1px 0 rgba(255, 255, 255, 0.95),
        0 10px 28px ${tint(FIRSTSTEP.teal, 0.14)},
        0 28px 56px ${tint(FIRSTSTEP.navy, 0.08)}
      `
      : `
        inset 0 1px 0 rgba(255, 255, 255, 0.95),
        0 8px 24px ${tint(FIRSTSTEP.teal, 0.1)},
        0 20px 40px ${tint(FIRSTSTEP.navy, 0.05)}
      `,
  color: FIRSTSTEP.navy,
  ...(options.mb !== undefined ? { mb: options.mb } : {}),
  '&::after': {
    content: '""',
    position: 'absolute',
    inset: 0,
    borderRadius: 'inherit',
    pointerEvents: 'none',
    background:
      'radial-gradient(circle at 12% 18%, rgba(255, 255, 255, 0.75) 0%, transparent 42%), radial-gradient(circle at 88% 0%, rgba(79, 179, 169, 0.16) 0%, transparent 36%)',
  },
});

export const heroGlassOverlineSx: SystemStyleObject<Theme> = {
  color: FIRSTSTEP.tealDark,
  fontWeight: 700,
  letterSpacing: '0.18em',
  fontSize: '0.68rem',
};

export const heroGlassTitleSx = (
  size: 'lg' | 'md' = 'lg',
): SystemStyleObject<Theme> => ({
  fontSize: size === 'lg' ? { xs: '1.9rem', md: '2.4rem' } : { xs: '1.65rem', md: '2rem' },
  fontWeight: 700,
  lineHeight: size === 'lg' ? 1.12 : 1.15,
  letterSpacing: '-0.03em',
  color: FIRSTSTEP.navyDeep,
});

export const heroGlassSubtitleSx: SystemStyleObject<Theme> = {
  color: FIRSTSTEP.textMuted,
  mt: 0.75,
};

export const heroGlassPillSx: SystemStyleObject<Theme> = {
  mt: 2,
  py: 0.75,
  px: 1.75,
  borderRadius: RADIUS.pill,
  width: 'fit-content',
  bgcolor: 'rgba(255, 255, 255, 0.62)',
  border: `1px solid ${tint(FIRSTSTEP.teal, 0.28)}`,
  backdropFilter: 'blur(12px)',
  WebkitBackdropFilter: 'blur(12px)',
  boxShadow: `0 2px 10px ${tint(FIRSTSTEP.teal, 0.08)}`,
};

export const heroGlassPillTextSx: SystemStyleObject<Theme> = {
  color: FIRSTSTEP.navy,
  fontWeight: 600,
};

export const heroGlassPillMutedTextSx: SystemStyleObject<Theme> = {
  color: FIRSTSTEP.textMuted,
};

export const heroGlassGhostButtonSx: SystemStyleObject<Theme> = {
  borderRadius: RADIUS.pill,
  px: 2,
  py: 0.85,
  fontWeight: 600,
  color: FIRSTSTEP.navy,
  borderColor: tint(FIRSTSTEP.teal, 0.42),
  bgcolor: 'rgba(255, 255, 255, 0.58)',
  backdropFilter: 'blur(10px)',
  WebkitBackdropFilter: 'blur(10px)',
  boxShadow: `0 2px 8px ${tint(FIRSTSTEP.teal, 0.08)}`,
  '&:hover': {
    borderColor: FIRSTSTEP.teal,
    bgcolor: 'rgba(255, 255, 255, 0.88)',
    boxShadow: `0 6px 16px ${tint(FIRSTSTEP.teal, 0.14)}`,
  },
  '&.Mui-disabled': {
    color: tint(FIRSTSTEP.navy, 0.45),
    borderColor: tint(FIRSTSTEP.teal, 0.18),
    bgcolor: 'rgba(255, 255, 255, 0.35)',
  },
};

export const heroGlassPrimaryButtonSx: SystemStyleObject<Theme> = {
  borderRadius: RADIUS.pill,
  px: 2.5,
  py: 1,
  fontWeight: 700,
  bgcolor: FIRSTSTEP.teal,
  color: FIRSTSTEP.navyDeep,
  boxShadow: `0 4px 14px ${tint(FIRSTSTEP.teal, 0.34)}`,
  '&:hover': { bgcolor: '#5fc4b9' },
  '&.Mui-disabled': {
    bgcolor: tint(FIRSTSTEP.teal, 0.28),
    color: tint(FIRSTSTEP.navyDeep, 0.55),
  },
};

export const heroGlassFormControlSx = (
  minHeight?: number | string,
): SystemStyleObject<Theme> => ({
  minWidth: 150,
  '& .MuiInputLabel-root': { color: FIRSTSTEP.textMuted },
  '& .MuiInputLabel-root.Mui-focused': { color: FIRSTSTEP.tealDark },
  '& .MuiOutlinedInput-root': {
    color: FIRSTSTEP.navy,
    bgcolor: 'rgba(255, 255, 255, 0.62)',
    backdropFilter: 'blur(10px)',
    WebkitBackdropFilter: 'blur(10px)',
    borderRadius: RADIUS.control,
    ...(minHeight ? { minHeight } : {}),
    outline: 'none',
    '&:focus, &:focus-visible, &:focus-within': { outline: 'none' },
    '& fieldset': { borderColor: tint(FIRSTSTEP.teal, 0.34) },
    '&:hover fieldset': { borderColor: tint(FIRSTSTEP.teal, 0.52) },
    '&.Mui-focused fieldset': { borderColor: FIRSTSTEP.teal, borderWidth: 1 },
    '&:before, &:after': { display: 'none' },
    '& .MuiInputBase-input:focus, & .MuiInputBase-input:focus-visible': {
      outline: 'none',
    },
    '& input[type="date"]::-webkit-calendar-picker-indicator': {
      border: 'none',
      outline: 'none',
      marginLeft: '4px',
      padding: 0,
      cursor: 'pointer',
    },
    '& input[type="date"]::-webkit-inner-spin-button': { display: 'none' },
    '& input[type="date"]::-webkit-datetime-edit': { padding: 0 },
  },
  '& .MuiInput-underline:before, & .MuiInput-underline:after': { display: 'none' },
  '& .MuiInput-underline:hover:not(.Mui-disabled):before': { display: 'none' },
  '& .MuiSelect-icon': { color: FIRSTSTEP.tealDark },
});

/** Blurred colour blobs layered behind the hero band. */
export const heroBlobSx = (
  color: string,
  size: number,
  position: { top?: number | string; left?: number | string; right?: number | string; bottom?: number | string },
  options: { opacity?: number; blur?: number } = {},
): SystemStyleObject<Theme> => ({
  position: 'absolute',
  width: size,
  height: size,
  borderRadius: '50%',
  background: color,
  filter: `blur(${options.blur ?? 80}px)`,
  opacity: options.opacity ?? 0.42,
  pointerEvents: 'none',
  ...position,
});

/** Small glass bubble accents for hero backgrounds. */
export const heroBubbleAccentSx = (
  size: number,
  position: { top?: number | string; left?: number | string; right?: number | string; bottom?: number | string },
  options: { filled?: boolean; opacity?: number } = {},
): SystemStyleObject<Theme> => ({
  position: 'absolute',
  width: size,
  height: size,
  borderRadius: '50%',
  pointerEvents: 'none',
  border: `1px solid ${tint(FIRSTSTEP.teal, options.filled ? 0.18 : 0.24)}`,
  bgcolor: options.filled ? 'rgba(255, 255, 255, 0.48)' : 'rgba(255, 255, 255, 0.22)',
  backdropFilter: 'blur(8px)',
  WebkitBackdropFilter: 'blur(8px)',
  boxShadow: options.filled
    ? `inset 0 1px 0 rgba(255, 255, 255, 0.85), 0 8px 18px ${tint(FIRSTSTEP.teal, 0.1)}`
    : `inset 0 1px 0 rgba(255, 255, 255, 0.65)`,
  opacity: options.opacity ?? 1,
  ...position,
});

export const hiddenScrollbarSx: SystemStyleObject<Theme> = {
  scrollbarWidth: 'none',
  msOverflowStyle: 'none',
  '&::-webkit-scrollbar': {
    display: 'none',
    width: 0,
    height: 0,
  },
};
export const cardSx = (accent?: string): SystemStyleObject<Theme> => ({
  position: 'relative',
  overflow: 'hidden',
  borderRadius: RADIUS.card,
  border: '1px solid',
  borderColor: (theme) =>
    theme.palette.mode === 'dark' ? 'rgba(79, 179, 169, 0.16)' : 'rgba(226, 232, 240, 0.9)',
  background: (theme) =>
    theme.palette.mode === 'dark'
      ? 'linear-gradient(135deg, rgba(255,255,255,0.045) 0%, rgba(255,255,255,0.015) 100%)'
      : `linear-gradient(135deg, ${FIRSTSTEP.white} 0%, ${FIRSTSTEP.surfaceAlt} 100%)`,
  boxShadow: (theme) =>
    theme.palette.mode === 'dark' ? 'none' : '0 1px 2px rgba(2, 51, 69, 0.04)',
  transition: 'transform 280ms cubic-bezier(0.4, 0, 0.2, 1), box-shadow 280ms cubic-bezier(0.4, 0, 0.2, 1)',
  ...(accent
    ? {
        '&::before': {
          content: '""',
          position: 'absolute',
          insetInline: 0,
          top: 0,
          height: 4,
          background: `linear-gradient(90deg, ${accent} 0%, ${FIRSTSTEP.teal} 100%)`,
        },
      }
    : {}),
  '&:hover': {
    transform: 'translateY(-4px)',
    boxShadow: (theme) =>
      theme.palette.mode === 'dark'
        ? '0 18px 46px rgba(0, 0, 0, 0.55)'
        : '0 18px 46px rgba(2, 51, 69, 0.13)',
  },
  '@media (prefers-reduced-motion: reduce)': {
    transition: 'none',
    '&:hover': { transform: 'none' },
  },
});

/** Staggered entrance used across the KPI grid and chart row. */
export const fadeUpSx = (delay = 0): SystemStyleObject<Theme> => ({
  animation: 'opsFadeUp 460ms cubic-bezier(0.4, 0, 0.2, 1) both',
  animationDelay: `${delay}ms`,
  '@keyframes opsFadeUp': {
    from: { opacity: 0, transform: 'translateY(10px)' },
    to: { opacity: 1, transform: 'translateY(0)' },
  },
  '@media (prefers-reduced-motion: reduce)': {
    animation: 'none',
  },
});

/** Shared 2px high-contrast keyboard ring; color is applied per theme. */
export const FOCUS_VISIBLE_RING = {
  outline: '2px solid',
  outlineOffset: '2px',
} as const;

/**
 * Keyboard rings for buttons/links only.
 * Do not include `.MuiOutlinedInput-root:focus-within` — MUI already draws a
 * fieldset border, so an extra outline reads as a double line on every text field.
 */
export const FOCUS_VISIBLE_INTERACTIVE_SELECTORS = [
  'button:focus-visible',
  'a:focus-visible',
  '[role="button"]:focus-visible',
  'select:focus-visible',
  'textarea:focus-visible',
  '.MuiButtonBase-root:focus-visible',
  '.MuiChip-root:focus-visible',
  '.MuiPaginationItem-root:focus-visible',
  '.MuiIconButton-root:focus-visible',
  '.MuiMenuItem-root:focus-visible',
] as const;

/** Skip-to-main focus is otherwise invisible; theme baseline applies a 2px ring. */
export const MAIN_CONTENT_FOCUS_SELECTORS = [
  '[id="main-content"]:focus',
  '[id="main-content"]:focus-visible',
] as const;
