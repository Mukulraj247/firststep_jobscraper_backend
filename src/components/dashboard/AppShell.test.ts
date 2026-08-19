import { describe, expect, it } from 'vitest';
import {
  DESKTOP_BREAKPOINT_PX,
  DRAWER_ARIA_LABEL,
  HAMBURGER_BUTTON_ID,
  MAIN_CONTENT_ID,
  NAVBAR_LANDMARK_TAG,
  NAVBAR_LOGO_MAX_HEIGHT_PX,
  NAVBAR_MIN_HEIGHT_PX,
  SIDEBAR_STORAGE_KEY,
  SIDEBAR_WIDTH_COLLAPSED,
  SIDEBAR_WIDTH_EXPANDED,
  SKIP_LINK_CLASS,
  SKIP_LINK_HREF,
  SKIP_LINK_LABEL,
  authCheckMainLandmark,
  drawerDisableRestoreFocus,
  drawerTransitionDuration,
  nextDrawerOpenAfterRouteChange,
  persistSidebarCollapsed,
  providerPathAfterNavigation,
  readSidebarCollapsed,
  reservedSidebarWidth,
  desktopSidebarPinSx,
  appShellRootSx,
  appShellMainSx,
  shouldMoveFocusToMain,
  shouldRestoreHamburgerOnDrawerClose,
  shouldRenderSkipLink,
  shouldShowHamburger,
  shouldShowSkipLink,
  shouldUseMobileDrawer,
  sidebarIconAriaHidden,
  sidebarNavButtonA11y,
  sidebarPixelWidth,
  sidebarTooltipTarget,
  sidebarWidthTransition,
  skipLinkComesBeforeNavbar,
  skipLinkIsFirstTabStop,
  navbarLogoImgStyle,
} from './appShellBehavior';
import {
  FOCUS_VISIBLE_INTERACTIVE_SELECTORS,
  FOCUS_VISIBLE_RING,
  MAIN_CONTENT_FOCUS_SELECTORS,
} from './ops/dashboardTokens';

describe('shouldUseMobileDrawer', () => {
  it('uses a temporary drawer below the MUI md 900px cutoff', () => {
    expect(DESKTOP_BREAKPOINT_PX).toBe(900);
    expect(shouldUseMobileDrawer(320)).toBe(true);
    expect(shouldUseMobileDrawer(375)).toBe(true);
    expect(shouldUseMobileDrawer(899)).toBe(true);
  });

  it('keeps the persistent sidebar at md and above', () => {
    expect(shouldUseMobileDrawer(900)).toBe(false);
    expect(shouldUseMobileDrawer(1440)).toBe(false);
  });
});

describe('desktop sidebar collapse', () => {
  it('preserves the 240/76 widths and scoutx.sidebarCollapsed key', () => {
    expect(SIDEBAR_WIDTH_EXPANDED).toBe(240);
    expect(SIDEBAR_WIDTH_COLLAPSED).toBe(76);
    expect(SIDEBAR_STORAGE_KEY).toBe('scoutx.sidebarCollapsed');
    expect(sidebarPixelWidth(false)).toBe(240);
    expect(sidebarPixelWidth(true)).toBe(76);
  });

  it('reads and persists collapse through the storage key', () => {
    const store = new Map<string, string>();
    expect(readSidebarCollapsed((key) => store.get(key) ?? null)).toBe(false);

    persistSidebarCollapsed((key, value) => {
      store.set(key, value);
    }, true);

    expect(store.get(SIDEBAR_STORAGE_KEY)).toBe('true');
    expect(readSidebarCollapsed((key) => store.get(key) ?? null)).toBe(true);
  });

  it('does not reserve a 240px sidebar at 320 CSS pixels', () => {
    expect(reservedSidebarWidth(320, false)).toBe(0);
    expect(reservedSidebarWidth(899, true)).toBe(0);
    expect(reservedSidebarWidth(900, false)).toBe(240);
    expect(reservedSidebarWidth(1280, true)).toBe(76);
  });

  it('pins the desktop sidebar and keeps only main content in the scrollport', () => {
    expect(appShellRootSx()).toMatchObject({ height: '100%', overflow: 'hidden' });
    expect(desktopSidebarPinSx()).toMatchObject({
      position: 'sticky',
      top: 0,
      height: '100%',
      overflow: 'hidden',
    });
    expect(appShellMainSx()).toMatchObject({
      overflow: 'hidden',
      minHeight: 0,
    });
  });
});

describe('mobile drawer', () => {
  it('shows the hamburger only when the drawer layout is active and the shell is mounted', () => {
    expect(shouldShowHamburger(true, true)).toBe(true);
    expect(shouldShowHamburger(true, false)).toBe(false);
    expect(shouldShowHamburger(false, true)).toBe(false);
    expect(shouldShowHamburger(false, false)).toBe(false);
  });

  it('closes the drawer when the pathname changes', () => {
    expect(nextDrawerOpenAfterRouteChange('/dashboard', '/automations', true)).toBe(false);
    expect(nextDrawerOpenAfterRouteChange('/dashboard', '/dashboard', true)).toBe(true);
    expect(nextDrawerOpenAfterRouteChange('/runs', '/runs', false)).toBe(false);
  });

  it('stays closed on first provider mount when previous path is null', () => {
    expect(nextDrawerOpenAfterRouteChange(null, '/dashboard', false)).toBe(false);
    expect(nextDrawerOpenAfterRouteChange(null, '/dashboard', true)).toBe(false);
  });

  it('keeps disableRestoreFocus true at drawer open because MUI snapshots the prop', () => {
    expect(drawerDisableRestoreFocus()).toBe(true);
  });

  it('restores hamburger focus only on Escape/backdrop, not navigation close', () => {
    expect(shouldRestoreHamburgerOnDrawerClose(false)).toBe(true);
    expect(shouldRestoreHamburgerOnDrawerClose(true)).toBe(false);
  });

  it('names the drawer dialog for assistive tech', () => {
    expect(DRAWER_ARIA_LABEL).toBe('Main navigation');
  });

  it('gives the hamburger a stable id so user-close can restore focus', () => {
    expect(HAMBURGER_BUTTON_ID).toBe('app-shell-hamburger');
  });
});

describe('collapsed sidebar item a11y', () => {
  it('always names the ButtonBase and hides the icon', () => {
    expect(sidebarNavButtonA11y('Dashboard')).toEqual({ 'aria-label': 'Dashboard' });
    expect(sidebarNavButtonA11y('Automations')).toEqual({ 'aria-label': 'Automations' });
    expect(sidebarIconAriaHidden).toBe(true);
  });

  it('puts the tooltip on the ButtonBase, not a wrapping box', () => {
    expect(sidebarTooltipTarget).toBe('buttonBase');
  });
});

describe('skip link and main landmark', () => {
  it('targets #main-content with the skip-link class and label', () => {
    expect(SKIP_LINK_CLASS).toBe('skip-link');
    expect(SKIP_LINK_HREF).toBe('#main-content');
    expect(SKIP_LINK_LABEL).toBe('Skip to main content');
    expect(MAIN_CONTENT_ID).toBe('main-content');
  });

  it('places the skip link first in tab order, before the navbar', () => {
    // PageWrapper renders skip-link then NavBar; that DOM order is the first-tab-stop proof.
    expect(skipLinkComesBeforeNavbar(['skip-link', 'navbar', 'main'])).toBe(true);
    expect(skipLinkComesBeforeNavbar(['navbar', 'skip-link'])).toBe(false);
    expect(skipLinkIsFirstTabStop).toBe(true);
  });

  it('does not render the skip link for bootstrap /, login, recording, or admin', () => {
    const routesWithoutMain = [
      '/',
      '/login',
      '/register',
      '/recording',
      '/recording-setup',
      '/admin',
      '/admin/users',
    ];
    for (const pathname of routesWithoutMain) {
      expect(shouldRenderSkipLink(pathname), pathname).toBe(false);
    }
  });

  it('renders the skip link only on routes that have a #main-content landmark', () => {
    const routesWithMain = [
      '/dashboard',
      '/automations',
      '/jobs',
      '/robots',
      '/robots/create',
      '/runs',
      '/failures',
      '/proxy',
      '/automation/abc/data',
      '/automation/abc/config',
      '/run/xyz',
      '/this-page-does-not-exist',
    ];

    for (const pathname of routesWithMain) {
      expect(shouldRenderSkipLink(pathname), pathname).toBe(true);
    }
  });

  it('hides the skip link until a real landmark is mounted', () => {
    expect(shouldShowSkipLink('/dashboard', false)).toBe(false);
    expect(shouldShowSkipLink('/dashboard', true)).toBe(true);
    expect(shouldShowSkipLink('/', true)).toBe(false);
    expect(shouldShowSkipLink('/login', true)).toBe(false);
    expect(shouldShowSkipLink('/robots/create', true)).toBe(true);
  });
});

describe('focus on route change', () => {
  it('does not move focus on first provider mount', () => {
    const first = providerPathAfterNavigation(null, '/dashboard');
    expect(first.previousPath).toBeNull();
    expect(shouldMoveFocusToMain(first.previousPath, first.nextPath)).toBe(false);
    expect(first.shouldFocus).toBe(false);
    expect(first.nextStoredPrevious).toBe('/dashboard');
  });

  it('does not steal focus when previousPath is null (first load, not remount)', () => {
    expect(shouldMoveFocusToMain(null, '/dashboard')).toBe(false);
    expect(shouldMoveFocusToMain(null, '/automations')).toBe(false);
  });

  it('does not treat bootstrap / → /dashboard as a route-change focus', () => {
    expect(shouldMoveFocusToMain('/', '/dashboard')).toBe(false);
    expect(shouldMoveFocusToMain('/dashboard', '/')).toBe(false);
    expect(providerPathAfterNavigation('/', '/dashboard').shouldFocus).toBe(false);
    expect(providerPathAfterNavigation('/dashboard', '/').shouldFocus).toBe(false);
  });

  it('moves focus on client-side pathname changes using the provider stored path', () => {
    const nav = providerPathAfterNavigation('/dashboard', '/automations');
    expect(nav.shouldFocus).toBe(true);
    expect(shouldMoveFocusToMain(nav.previousPath, nav.nextPath)).toBe(true);
    expect(providerPathAfterNavigation('/dashboard', '/dashboard').shouldFocus).toBe(false);
  });

  it('moves focus when returning from a PageMain route onto a remounted AppShell', () => {
    const nav = providerPathAfterNavigation('/robots/create', '/dashboard');
    expect(nav.shouldFocus).toBe(true);
    expect(shouldMoveFocusToMain(nav.previousPath, nav.nextPath)).toBe(true);
  });

  it('moves focus when PageMain stays mounted across parametric routes', () => {
    expect(shouldMoveFocusToMain(null, '/automation/a/data')).toBe(false);
    expect(providerPathAfterNavigation('/automation/a/data', '/automation/b/data').shouldFocus).toBe(
      true
    );
    expect(shouldMoveFocusToMain('/run/x', '/run/y')).toBe(true);
    expect(shouldMoveFocusToMain('/run/x', '/run/x')).toBe(false);
  });
});

describe('reduced motion', () => {
  it('disables the sidebar width animation when the user prefers reduced motion', () => {
    expect(sidebarWidthTransition(false)).toContain('width');
    expect(sidebarWidthTransition(true)).toBe('none');
  });

  it('disables the mobile drawer transition when the user prefers reduced motion', () => {
    expect(drawerTransitionDuration(true)).toBe(0);
    expect(drawerTransitionDuration(false)).toBeUndefined();
  });
});

describe('UserRoute auth-check landmark', () => {
  it('does not render a disposable #main-content while checking auth', () => {
    expect(authCheckMainLandmark(true)).toBeNull();
    expect(authCheckMainLandmark(false)).toBeNull();
  });
});

describe('navbar landmark', () => {
  it('uses a header element for the bar', () => {
    expect(NAVBAR_LANDMARK_TAG).toBe('header');
  });

  it('keeps the centered logo inside the bar so it cannot steal clicks on the page', () => {
    expect(NAVBAR_MIN_HEIGHT_PX).toBeGreaterThanOrEqual(56);
    expect(NAVBAR_LOGO_MAX_HEIGHT_PX).toBeGreaterThanOrEqual(44);
    expect(NAVBAR_LOGO_MAX_HEIGHT_PX).toBeLessThan(NAVBAR_MIN_HEIGHT_PX);
  });

  it('does not round the wordmark into a white face/halo behind the mark', () => {
    expect(navbarLogoImgStyle().borderRadius).toBeUndefined();
    expect(navbarLogoImgStyle().objectFit).toBe('contain');
    expect(navbarLogoImgStyle().width).toBe('auto');
  });
});

describe('global focus-visible ring', () => {
  it('uses a 2px high-contrast ring with offset', () => {
    expect(FOCUS_VISIBLE_RING.outline).toMatch(/2px/);
    expect(FOCUS_VISIBLE_RING.outlineOffset).toBe('2px');
  });

  it('includes a 2px ring on #main-content focus and focus-visible', () => {
    expect(MAIN_CONTENT_FOCUS_SELECTORS).toContain('[id="main-content"]:focus');
    expect(MAIN_CONTENT_FOCUS_SELECTORS).toContain('[id="main-content"]:focus-visible');
  });

  it('does not put a second outline on outlined inputs (MUI fieldset is already the border)', () => {
    const joined = FOCUS_VISIBLE_INTERACTIVE_SELECTORS.join(', ');
    expect(joined).not.toMatch(/MuiOutlinedInput-root:focus-within/);
    expect(joined).not.toMatch(/MuiOutlinedInput-root:focus-visible/);
  });
});
