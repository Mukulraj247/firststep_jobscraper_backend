import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Box, Drawer, useMediaQuery, useTheme } from '@mui/material';
import { useLocation } from 'react-router-dom';
import { SidebarContent } from './SidebarContent';
import {
  DRAWER_ARIA_LABEL,
  HAMBURGER_BUTTON_ID,
  MAIN_CONTENT_ID,
  SIDEBAR_WIDTH_EXPANDED,
  appShellMainSx,
  appShellRootSx,
  desktopSidebarPinSx,
  drawerDisableRestoreFocus,
  drawerTransitionDuration,
  nextDrawerOpenAfterRouteChange,
  persistSidebarCollapsed,
  providerPathAfterNavigation,
  readSidebarCollapsed,
  shouldRestoreHamburgerOnDrawerClose,
  sidebarPixelWidth,
  sidebarWidthTransition,
} from './appShellBehavior';

export {
  DESKTOP_BREAKPOINT_PX,
  DRAWER_ARIA_LABEL,
  HAMBURGER_BUTTON_ID,
  MAIN_CONTENT_ID,
  NAVBAR_LANDMARK_TAG,
  NAVBAR_LOGO_MAX_HEIGHT_PX,
  NAVBAR_MIN_HEIGHT_PX,
  navbarLogoImgStyle,
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
} from './appShellBehavior';

type AppShellNavValue = {
  isMobile: boolean;
  drawerOpen: boolean;
  shellMounted: boolean;
  landmarkMounted: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
  closeDrawerFromNavigation: () => void;
  setShellMounted: (mounted: boolean) => void;
  setLandmarkMounted: (mounted: boolean) => void;
};

const AppShellNavContext = createContext<AppShellNavValue | null>(null);

const inactiveShellNav: AppShellNavValue = {
  isMobile: false,
  drawerOpen: false,
  shellMounted: false,
  landmarkMounted: false,
  openDrawer: () => {},
  closeDrawer: () => {},
  closeDrawerFromNavigation: () => {},
  setShellMounted: () => {},
  setLandmarkMounted: () => {},
};

export function useAppShellNav(): AppShellNavValue {
  return useContext(AppShellNavContext) ?? inactiveShellNav;
}

export function AppShellNavProvider({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'), { noSsr: true });
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [shellMounted, setShellMounted] = useState(false);
  const [landmarkMounted, setLandmarkMounted] = useState(false);
  const previousPathRef = useRef<string | null>(null);

  useEffect(() => {
    const nav = providerPathAfterNavigation(previousPathRef.current, location.pathname);
    setDrawerOpen((wasOpen) =>
      nextDrawerOpenAfterRouteChange(nav.previousPath, nav.nextPath, wasOpen)
    );
    if (nav.shouldFocus) {
      document.getElementById(MAIN_CONTENT_ID)?.focus();
    }
    previousPathRef.current = nav.nextStoredPrevious;
  }, [location.pathname]);

  useEffect(() => {
    if (!isMobile) setDrawerOpen(false);
  }, [isMobile]);

  const openDrawer = useCallback(() => {
    setDrawerOpen(true);
  }, []);
  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
  }, []);
  const closeDrawerFromNavigation = useCallback(() => {
    setDrawerOpen(false);
  }, []);

  const value = useMemo(
    () => ({
      isMobile,
      drawerOpen,
      shellMounted,
      landmarkMounted,
      openDrawer,
      closeDrawer,
      closeDrawerFromNavigation,
      setShellMounted,
      setLandmarkMounted,
    }),
    [
      isMobile,
      drawerOpen,
      shellMounted,
      landmarkMounted,
      openDrawer,
      closeDrawer,
      closeDrawerFromNavigation,
    ]
  );

  return <AppShellNavContext.Provider value={value}>{children}</AppShellNavContext.Provider>;
}

/** Landmark for NavBar-visible pages that are not wrapped by AppShell. */
export function PageMain({ children }: { children: React.ReactNode }) {
  const { setLandmarkMounted } = useAppShellNav();

  useEffect(() => {
    setLandmarkMounted(true);
    return () => setLandmarkMounted(false);
  }, [setLandmarkMounted]);

  return (
    <main id={MAIN_CONTENT_ID} tabIndex={-1}>
      {children}
    </main>
  );
}

interface AppShellProps {
  value: string;
  handleChangeContent: (newValue: string) => void;
  children: React.ReactNode;
}

export const AppShell = ({ value, handleChangeContent, children }: AppShellProps) => {
  const {
    isMobile,
    drawerOpen,
    closeDrawer,
    closeDrawerFromNavigation,
    setShellMounted,
    setLandmarkMounted,
  } = useAppShellNav();
  const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)', { noSsr: true });
  const restoreHamburgerOnExitRef = useRef(false);
  const [collapsed, setCollapsed] = useState(() =>
    readSidebarCollapsed((key) => {
      try {
        return window.localStorage.getItem(key);
      } catch {
        return null;
      }
    })
  );

  useEffect(() => {
    setShellMounted(true);
    setLandmarkMounted(true);
    return () => {
      setShellMounted(false);
      setLandmarkMounted(false);
    };
  }, [setShellMounted, setLandmarkMounted]);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      persistSidebarCollapsed((key, storageValue) => {
        window.localStorage.setItem(key, storageValue);
      }, next);
      return next;
    });
  }, []);

  const handleDrawerClose = useCallback(() => {
    restoreHamburgerOnExitRef.current = shouldRestoreHamburgerOnDrawerClose(false);
    closeDrawer();
  }, [closeDrawer]);

  const handleDrawerExited = useCallback(() => {
    if (!restoreHamburgerOnExitRef.current) return;
    restoreHamburgerOnExitRef.current = false;
    document.getElementById(HAMBURGER_BUTTON_ID)?.focus();
  }, []);

  const nav = (
    <SidebarContent
      value={value}
      handleChangeContent={handleChangeContent}
      collapsed={isMobile ? false : collapsed}
      onToggleCollapsed={isMobile ? undefined : toggleCollapsed}
      showCollapseToggle={!isMobile}
      onNavigate={isMobile ? closeDrawerFromNavigation : undefined}
    />
  );

  const sidebarWidth = isMobile ? 0 : sidebarPixelWidth(collapsed);

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'stretch',
        ...appShellRootSx(),
        flex: 1,
        width: '100%',
        minWidth: 0,
        maxWidth: '100%',
      }}
    >
      {!isMobile ? (
        <Box
          sx={{
            width: sidebarWidth,
            flexShrink: 0,
            minWidth: 0,
            zIndex: 1000,
            transition: sidebarWidthTransition(false),
            '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
            ...desktopSidebarPinSx(),
          }}
        >
          {nav}
        </Box>
      ) : (
        <Drawer
          id="app-shell-drawer"
          variant="temporary"
          open={drawerOpen}
          onClose={handleDrawerClose}
          transitionDuration={drawerTransitionDuration(prefersReducedMotion)}
          SlideProps={{ onExited: handleDrawerExited }}
          ModalProps={{
            keepMounted: true,
            disableRestoreFocus: drawerDisableRestoreFocus(),
            'aria-label': DRAWER_ARIA_LABEL,
          }}
          PaperProps={{
            'aria-label': DRAWER_ARIA_LABEL,
            sx: {
              width: SIDEBAR_WIDTH_EXPANDED,
              maxWidth: '100%',
              minWidth: 0,
            },
          }}
        >
          {nav}
        </Drawer>
      )}

      <Box
        component="main"
        id={MAIN_CONTENT_ID}
        tabIndex={-1}
        sx={{
          flex: 1,
          minWidth: 0,
          ...appShellMainSx(),
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {children}
      </Box>
    </Box>
  );
};
