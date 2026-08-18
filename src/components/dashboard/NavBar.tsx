import { useTranslation } from "react-i18next";
import React, { useState, useContext, useEffect } from 'react';
import axios from 'axios';
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
  YouTube,
  X,
  GitHub,
  LightMode,
  DarkMode,
  Translate,
  Menu as MenuIcon,
} from "@mui/icons-material";
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../../context/auth';
import { SaveRecording } from '../recorder/SaveRecording';
import DiscordIcon from '../icons/DiscordIcon';
import { apiUrl } from '../../apiConfig';
import ScoutXLogo from "../../assets/scoutx-logo.png";
import { useThemeMode } from '../../context/theme-provider';
import { HAMBURGER_BUTTON_ID, shouldShowHamburger, useAppShellNav } from './AppShell';

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
  const { t, i18n } = useTranslation();
  const { isMobile, shellMounted, drawerOpen, openDrawer } = useAppShellNav();
  const showHamburger = shouldShowHamburger(isMobile, shellMounted);

  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);

  const [langAnchorEl, setLangAnchorEl] = useState<null | HTMLElement>(null);

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleLangMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setLangAnchorEl(event.currentTarget);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
    setLangAnchorEl(null);
  };

  const logout = async () => {
    try {
      const { data } = await axios.get(`${apiUrl}/auth/logout`);
      if (data.ok) {
        dispatch({ type: "LOGOUT" });
        window.localStorage.removeItem("user");
        // notify('success', t('navbar.notifications.success.logout'));
        navigate("/login");
      }
    } catch (error: any) {
      const status = error.response?.status;
      let errorKey = 'unknown';

      switch (status) {
        case 401:
          errorKey = 'unauthorized';
          break;
        case 500:
          errorKey = 'server';
          break;
        default:
          if (error.message?.includes('Network Error')) {
            errorKey = 'network';
          }
      }

      notify(
        'error',
        t(`navbar.notifications.errors.logout.${errorKey}`, {
          error: error.response?.data?.message || error.message
        })
      );
      navigate("/login");
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

  const changeLanguage = (lang: string) => {
    i18n.changeLanguage(lang);
    localStorage.setItem("language", lang);
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
          aria-label={t('navbar.project_name')}
        >
          <img
            src={ScoutXLogo}
            width={200}
            height={200}
            style={{ borderRadius: '18px', objectFit: 'contain' }}
            alt=""
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
                      <Logout sx={{ marginRight: '5px' }} /> {t('navbar.menu_items.logout')}
                    </MenuItem>
                    <MenuItem onClick={handleLangMenuOpen}>
                      <Translate sx={{ marginRight: '5px' }} /> {t('navbar.menu_items.language')}
                    </MenuItem>
                    <hr />
                    <MenuItem onClick={() => {
                      window.open('https://github.com/getmaxun/maxun', '_blank');
                    }}>
                      <GitHub sx={{ marginRight: '5px' }} /> GitHub
                    </MenuItem>
                    <MenuItem onClick={() => {
                      window.open('https://discord.gg/5GbPjBUkws', '_blank');
                    }}>
                      <DiscordIcon sx={{ marginRight: '5px' }} /> Discord
                    </MenuItem>
                    <MenuItem onClick={() => {
                      window.open('https://www.youtube.com/@MaxunOSS/videos?ref=app', '_blank');
                    }}>
                      <YouTube sx={{ marginRight: '5px' }} /> YouTube
                    </MenuItem>
                    <MenuItem onClick={() => {
                      window.open('https://x.com/MaxunHQ?ref=app', '_blank');
                    }}>
                      <X sx={{ marginRight: '5px' }} /> Twitter (X)
                    </MenuItem>
                    <Menu
                      anchorEl={langAnchorEl}
                      open={Boolean(langAnchorEl)}
                      onClose={handleMenuClose}
                      anchorOrigin={{
                        vertical: "bottom",
                        horizontal: "center",
                      }}
                      transformOrigin={{
                        vertical: "top",
                        horizontal: "center",
                      }}
                    >
                      <MenuItem
                        onClick={() => {
                          changeLanguage("en");
                          handleMenuClose();
                        }}
                      >
                        English
                      </MenuItem>
                      <MenuItem
                        onClick={() => {
                          changeLanguage("es");
                          handleMenuClose();
                        }}
                      >
                        Español
                      </MenuItem>
                      <MenuItem
                        onClick={() => {
                          changeLanguage("ja");
                          handleMenuClose();
                        }}
                      >
                        日本語
                      </MenuItem>
                      <MenuItem
                        onClick={() => {
                          changeLanguage("zh");
                          handleMenuClose();
                        }}
                      >
                        中文
                      </MenuItem>
                      <MenuItem
                        onClick={() => {
                          changeLanguage("de");
                          handleMenuClose();
                        }}
                      >
                        Deutsch
                      </MenuItem>
                      <MenuItem
                        onClick={() => {
                          changeLanguage("tr");
                          handleMenuClose();
                        }}
                      >
                        Türkçe
                      </MenuItem>
                      <MenuItem
                        onClick={() => {
                          window.open('https://docs.maxun.dev/development/i18n', '_blank');
                          handleMenuClose();
                        }}
                      >
                        Add Language
                      </MenuItem>
                    </Menu>
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
              <IconButton
                onClick={handleLangMenuOpen}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  borderRadius: "5px",
                  padding: "8px",
                  marginRight: "4px",
                }}
              >
                <Translate />
              </IconButton>
              <Menu
                anchorEl={langAnchorEl}
                open={Boolean(langAnchorEl)}
                onClose={handleMenuClose}
                anchorOrigin={{
                  vertical: "bottom",
                  horizontal: "center",
                }}
                transformOrigin={{
                  vertical: "top",
                  horizontal: "center",
                }}
              >
                <MenuItem
                  onClick={() => {
                    changeLanguage("en");
                    handleMenuClose();
                  }}
                >
                  English
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    changeLanguage("es");
                    handleMenuClose();
                  }}
                >
                  Español
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    changeLanguage("ja");
                    handleMenuClose();
                  }}
                >
                  日本語
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    changeLanguage("zh");
                    handleMenuClose();
                  }}
                >
                  中文
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    changeLanguage("de");
                    handleMenuClose();
                  }}
                >
                  Deutsch
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    changeLanguage("tr");
                    handleMenuClose();
                  }}
                >
                  Türkçe
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    window.open('https://docs.maxun.dev/development/i18n', '_blank');
                    handleMenuClose();
                  }}
                >
                  Add Language
                </MenuItem>
              </Menu>
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
  background-color: ${({ mode }) => (mode === 'dark' ? '#080808ff' : '#ffffff')};
  padding: 6px 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 56px;
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
