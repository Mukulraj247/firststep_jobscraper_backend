import type { CSSProperties } from 'react';

export const DESKTOP_BREAKPOINT_PX = 900;
export const SIDEBAR_WIDTH_EXPANDED = 240;
export const SIDEBAR_WIDTH_COLLAPSED = 76;
export const SIDEBAR_STORAGE_KEY = 'scoutx.sidebarCollapsed';
export const MAIN_CONTENT_ID = 'main-content';
export const SKIP_LINK_CLASS = 'skip-link';
export const SKIP_LINK_HREF = '#main-content';
export const SKIP_LINK_LABEL = 'Skip to main content';
export const NAVBAR_MIN_HEIGHT_PX = 56;
export const NAVBAR_LOGO_MAX_HEIGHT_PX = 44;

export function navbarLogoImgStyle(): CSSProperties {
  return {
    height: NAVBAR_LOGO_MAX_HEIGHT_PX,
    width: 'auto',
    maxHeight: NAVBAR_LOGO_MAX_HEIGHT_PX,
    objectFit: 'contain',
    display: 'block',
    pointerEvents: 'none',
  };
}
/** Skip link is rendered in PageWrapper before the navbar so it is the first tab stop. */
export const skipLinkIsFirstTabStop = true;
export const DRAWER_ARIA_LABEL = 'Main navigation';
export const NAVBAR_LANDMARK_TAG = 'header';
export const sidebarIconAriaHidden = true;
export const sidebarTooltipTarget = 'buttonBase' as const;

/**
 * Skip link is shown only when a #main-content landmark exists.
 * AppShell provides the landmark on MainPage routes; PageMain wraps
 * create/data/config/run/404. Bootstrap `/`, auth, recording, and admin have none.
 */
export function shouldRenderSkipLink(pathname: string): boolean {
  if (pathname === '/') return false;
  if (pathname === '/login' || pathname === '/register') return false;
  if (pathname === '/recording' || pathname === '/recording-setup') return false;
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return false;
  return true;
}

/** PageWrapper skip: route allows a landmark AND AppShell/PageMain has mounted one. */
export function shouldShowSkipLink(pathname: string, landmarkMounted: boolean): boolean {
  return shouldRenderSkipLink(pathname) && landmarkMounted;
}

/** Documents PageWrapper DOM order: skip-link, then navbar. */
export function skipLinkComesBeforeNavbar(order: string[]): boolean {
  const skipIndex = order.indexOf('skip-link');
  const navIndex = order.indexOf('navbar');
  return skipIndex !== -1 && navIndex !== -1 && skipIndex < navIndex;
}

/**
 * UserRoute must not render a disposable #main-content while checking auth.
 * Skip waits for AppShell/PageMain to register landmarkMounted.
 */
export function authCheckMainLandmark(_isCheckingAuth: boolean): null {
  return null;
}

export function sidebarNavButtonA11y(label: string): { 'aria-label': string } {
  return { 'aria-label': label };
}

export function shouldUseMobileDrawer(width: number): boolean {
  return width < DESKTOP_BREAKPOINT_PX;
}

export function sidebarPixelWidth(collapsed: boolean): number {
  return collapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH_EXPANDED;
}

export function reservedSidebarWidth(viewportWidth: number, collapsed: boolean): number {
  if (shouldUseMobileDrawer(viewportWidth)) return 0;
  return sidebarPixelWidth(collapsed);
}

export function sidebarWidthTransition(prefersReducedMotion: boolean): string {
  return prefersReducedMotion ? 'none' : 'width 220ms cubic-bezier(0.4, 0, 0.2, 1)';
}

/** MUI Drawer default duration when motion is allowed; 0 when reduced. */
export function drawerTransitionDuration(prefersReducedMotion: boolean): number | undefined {
  return prefersReducedMotion ? 0 : undefined;
}

export function nextDrawerOpenAfterRouteChange(
  previousPath: string | null,
  nextPath: string,
  wasOpen: boolean
): boolean {
  if (previousPath !== nextPath) return false;
  return wasOpen;
}

export const HAMBURGER_BUTTON_ID = 'app-shell-hamburger';

/**
 * MUI FocusTrap snapshots disableRestoreFocus when the trap opens.
 * Always disable MUI restore; restore the hamburger ourselves on user close.
 */
export function drawerDisableRestoreFocus(): boolean {
  return true;
}

/** Escape/backdrop should return focus to the hamburger; navigation close should not. */
export function shouldRestoreHamburgerOnDrawerClose(closedByNavigation: boolean): boolean {
  return !closedByNavigation;
}

/**
 * Provider navigation commit: first mount stores nextPath without focusing
 * (`storedPrevious === null`). Later client-side changes use the real previous
 * path, including across AppShell remounts.
 */
export function providerPathAfterNavigation(
  storedPrevious: string | null,
  nextPath: string
): {
  previousPath: string | null;
  nextPath: string;
  nextStoredPrevious: string;
  shouldFocus: boolean;
} {
  return {
    previousPath: storedPrevious,
    nextPath,
    nextStoredPrevious: nextPath,
    shouldFocus: shouldMoveFocusToMain(storedPrevious, nextPath),
  };
}

/**
 * previousPath is null on first AppShellNavProvider mount (first app load).
 * Bootstrap `/` → `/dashboard` and logo bounce through `/` must not steal focus.
 */
export function shouldMoveFocusToMain(
  previousPath: string | null,
  nextPath: string
): boolean {
  if (previousPath === null || previousPath === '/' || nextPath === '/') return false;
  return previousPath !== nextPath;
}

export function readSidebarCollapsed(getItem: (key: string) => string | null): boolean {
  try {
    return getItem(SIDEBAR_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function persistSidebarCollapsed(
  setItem: (key: string, value: string) => void,
  collapsed: boolean
): void {
  try {
    setItem(SIDEBAR_STORAGE_KEY, String(collapsed));
  } catch {
    /* storage unavailable — collapse still applies for this session */
  }
}

export function shouldShowHamburger(isMobile: boolean, shellMounted: boolean): boolean {
  return isMobile && shellMounted;
}

export function appShellRootSx() {
  return {
    height: '100%' as const,
    overflow: 'hidden' as const,
  };
}

export function desktopSidebarPinSx() {
  return {
    position: 'sticky' as const,
    top: 0,
    height: '100%' as const,
    overflow: 'hidden' as const,
  };
}

export function appShellMainSx() {
  return {
    overflow: 'hidden' as const,
    minHeight: 0 as const,
  };
}
