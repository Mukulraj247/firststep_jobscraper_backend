import { useTranslation } from "react-i18next";
import React, { useState, useContext } from 'react';
import styled from "styled-components";
import { stopRecording } from "../../api/recording";
import { useGlobalInfoStore } from "../../context/globalInfo";
import {
  IconButton,
  Menu,
  MenuItem,
  Typography,
  Tooltip
} from "@mui/material";
import {
  AccountCircle,
  Logout,
  Clear,
  LightMode,
  DarkMode,
  Menu as MenuIcon,
} from "@mui/icons-material";
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../../context/auth';
import { SaveRecording } from '../recorder/SaveRecording';
import ScoutXLogo from "../../assets/scoutx-logo.png";
import { useThemeMode } from '../../context/theme-provider';
import { useScoutXLogout } from '../../auth/scoutxLogout';
import {
  HAMBURGER_BUTTON_ID,
  NAVBAR_LOGO_MAX_HEIGHT_PX,
  NAVBAR_MIN_HEIGHT_PX,
  navbarLogoImgStyle,
  shouldShowHamburger,
  useAppShellNav,
} from './AppShell';

interface NavBarProps {
  recordingName: string;
  isRecording: boolean;
}

export const NavBar: React.FC<NavBarProps> = ({
  recordingName,
  isRecording,
}) => {
  const { notify, browserId, setBrowserId } = useGlobalInfoStore();
  const { state, dispatch } = useContext(AuthContext);
  const { user } = state;
  const navigate = useNavigate();
  const { darkMode, toggleTheme } = useThemeMode();
  const { t } = useTranslation();
  const { isMobile, shellMounted, drawerOpen, openDrawer } = useAppShellNav();
  const showHamburger = shouldShowHamburger(isMobile, shellMounted);
  const scoutXLogout = useScoutXLogout();

  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
  };

  /** Clears ScoutX cookie + Auth0 session (see scoutxLogout). */
  const logout = async () => {
    try {
      dispatch({ type: 'LOGOUT' });
      await scoutXLogout();
    } catch (error: any) {
      notify(
        'error',
        t('navbar.notifications.errors.logout.unknown', {
          error: error?.response?.data?.message || error?.message || 'Logout failed',
        })
      );
      window.location.assign('/login');
    }
  };

  const goToMainMenu = async () => {
    if (browserId) {
      await stopRecording(browserId);
      notify("warning", t('browser_recording.notifications.terminated'));
      setBrowserId(null);
    }
    navigate("/");
  };

  const renderThemeToggle = () => (
    <Tooltip title="Change Mode">
      <IconButton
        onClick={toggleTheme}
        sx={{
          color: darkMode ? '#ffffff' : '#023345',
          '&:hover': {
            background: 'inherit'
          }
        }}
      >
        {darkMode ? <LightMode /> : <DarkMode />}
      </IconButton>
    </Tooltip>
  );

  return (
    <>
      <NavBarWrapper mode={darkMode ? 'dark' : 'light'}>
        <NavBarStart>
          {showHamburger ? (
            <IconButton
              id={HAMBURGER_BUTTON_ID}
              onClick={openDrawer}
              aria-label="Open navigation"
              aria-controls="app-shell-drawer"
              aria-expanded={drawerOpen}
              sx={{
                color: darkMode ? '#ffffff' : '#023345',
                '&:hover': { background: 'inherit' },
              }}
            >
              <MenuIcon />
            </IconButton>
          ) : null}
        </NavBarStart>
        <NavBarLogoCenter
          role="button"
          tabIndex={0}
          onClick={() => navigate('/')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              navigate('/');
            }
          }}
          aria-label="Scout-X Scrapper"
        >
          <img
            src={ScoutXLogo}
            alt=""
            height={NAVBAR_LOGO_MAX_HEIGHT_PX}
            style={navbarLogoImgStyle()}
          />
        </NavBarLogoCenter>
        {
          user ? (
            <NavBarEnd>
              {!isRecording ? (
                <>
                  <IconButton onClick={handleMenuOpen} sx={{
                    display: 'flex',
                    alignItems: 'center',
                    borderRadius: '5px',
                    padding: '8px',
                    marginRight: '10px',
                    '&:hover': {
                      background: 'inherit'
                    }
                  }}>
                    <AccountCircle sx={{ marginRight: '5px' }} />
                    <Typography variant="body1">{user.email}</Typography>
                  </IconButton>
                  <Menu
                    anchorEl={anchorEl}
                    open={Boolean(anchorEl)}
                    onClose={handleMenuClose}
                    anchorOrigin={{
                      vertical: 'bottom',
                      horizontal: 'center',
                    }}
                    transformOrigin={{
                      vertical: 'top',
                      horizontal: 'center',
                    }}
                    PaperProps={{ sx: { width: '180px' } }}
                  >
                    <MenuItem onClick={() => { handleMenuClose(); logout(); }}>
                      <Logout sx={{ marginRight: '5px' }} /> Logout
                    </MenuItem>
                  </Menu>
                  {renderThemeToggle()}
                </>
              ) : (
                <>
                  <IconButton onClick={goToMainMenu} sx={{
                    borderRadius: '5px',
                    padding: '8px',
                    background: 'red',
                    color: 'white',
                    marginRight: '10px',
                    '&:hover': { color: 'white', backgroundColor: 'red' }
                  }}>
                    <Clear sx={{ marginRight: '5px' }} />
                    {t('navbar.recording.discard')}
                  </IconButton>
                  <SaveRecording fileName={recordingName} />
                </>
              )}
            </NavBarEnd>
          ) : (
            <NavBarEnd>
              {renderThemeToggle()}
            </NavBarEnd>
          )}
      </NavBarWrapper>
    </>
  );
};

const NavBarWrapper = styled.header<{ mode: 'light' | 'dark' }>`
  grid-area: navbar;
  position: relative;
  overflow: hidden;
  background-color: ${({ mode }) => (mode === 'dark' ? '#080808ff' : '#ffffff')};
  padding: 6px 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: ${NAVBAR_MIN_HEIGHT_PX}px;
  border-bottom: 1px solid ${({ mode }) => (mode === 'dark' ? '#1a1a1a' : 'rgba(2, 51, 69, 0.12)')};
`;

const NavBarStart = styled.div`
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  z-index: 2;
`;

const NavBarLogoCenter = styled.div`
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  z-index: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 0;
`;

const NavBarEnd = styled.div`
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  z-index: 2;
`;
