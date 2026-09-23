import React, { useEffect, useState } from 'react';
import {
  Avatar,
  Badge,
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import ChevronLeft from '@mui/icons-material/ChevronLeft';
import ChevronRight from '@mui/icons-material/ChevronRight';
import LogoutOutlined from '@mui/icons-material/LogoutOutlined';
import NotificationsNoneOutlined from '@mui/icons-material/NotificationsNoneOutlined';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { BrandMark } from './BrandMark';
import { ALL_NAV_ITEMS, isNavItemActive } from '../navItems';
import { usePortalAuth } from '../hooks/usePortalAuth.tsx';
import { usePortalBootstrap } from '../hooks/portalQueries';
import type { PersonaKey } from '../mock/mockPersonas';
import priyaAvatar from '../assets/persona-priya.png';
import {
  BODY_FONT,
  DISPLAY_FONT,
  EASE,
  PORTAL_NAV_COLLAPSED,
  PORTAL_NAV_WIDTH,
  RADIUS,
  STITCH,
  tint,
} from '../tokens';

const COLLAPSE_KEY = 'sSortx.userNavCollapsed';

type BadgeCounts = { feed: string | null; saved: number; requests: number };

export function UserSideNav({
  collapsed,
  onToggleCollapsed,
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, switchDemoPersona, authMode, logout } = usePortalAuth();
  const { data: bootstrap } = usePortalBootstrap(Boolean(user));
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const avatarcrc = user?.persona === 'priya' ? priyaAvatar : undefined;
  const persona = (user?.persona === 'marcus' ? 'marcus' : 'priya') as PersonaKey;
  const showDemoPersonas = authMode === 'mock';

  const badges: BadgeCounts = (() => {
    if (!bootstrap) return { feed: null, saved: 0, requests: 0 };
    const active = bootstrap.subscriptions.filter((s) => s.status === 'active');
    const freq = active[0]?.frequency;
    return {
      feed: freq ? `${freq}` : null,
      saved: bootstrap.savedCount,
      requests: bootstrap.openRequestCount,
    };
  })();

  const planBadge = (() => {
    const label =
      bootstrap?.entitlements?.subscriptionTypeDisplay ||
      bootstrap?.entitlements?.subscriptionType ||
      user?.firstStepPlan?.subscriptionType ||
      'ScoutX';
    return String(label).toLowerCase() === 'unknown' ? 'ScoutX' : String(label);
  })();

  const renderCount = (badgeKey?: 'feed' | 'saved' | 'requests') => {
    if (badgeKey === 'saved' && badges.saved > 0) return badges.saved;
    if (badgeKey === 'requests' && badges.requests > 0) return badges.requests;
    return null;
  };

  const switchPersona = async (key: PersonaKey) => {
    if (persona === key) return;
    await switchDemoPersona(key);
    window.location.reload();
  };

  const width = collapsed ? PORTAL_NAV_COLLAPSED : PORTAL_NAV_WIDTH;

  return (
    <Box
      component="aside"
      sx={{
        display: { xs: 'none', md: 'flex' },
        flexDirection: 'column',
        position: 'fixed',
        top: 0,
        left: 0,
        bottom: 0,
        width,
        zIndex: 1200,
        bgcolor: STITCH.background,
        color: STITCH.onSurface,
        borderRight: `1px solid ${STITCH.outlineVariant}`,
        transition: `width 220ms ${EASE}`,
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        justifyContent={collapsed ? 'center' : 'space-between'}
        sx={{ px: collapsed ? 1 : 1.5, py: 1.25, minHeight: 56 }}
      >
        <Box
          component={Link}
          to="/user"
          sx={{ textDecoration: 'none', display: 'flex', minWidth: 0, overflow: 'hidden' }}
        >
          <BrandMark size={32} compact={collapsed} />
        </Box>
        {!collapsed && (
          <IconButton
            aria-label="Collapse navigation"
            onClick={onToggleCollapsed}
            size="small"
            sx={{ color: STITCH.muted, width: 32, height: 32 }}
          >
            <ChevronLeft sx={{ fontSize: 20 }} />
          </IconButton>
        )}
      </Stack>

      {collapsed && (
        <Box sx={{ display: 'flex', justifyContent: 'center', mb: 1 }}>
          <IconButton
            aria-label="Expand navigation"
            onClick={onToggleCollapsed}
            size="small"
            sx={{ color: STITCH.muted }}
          >
            <ChevronRight sx={{ fontSize: 20 }} />
          </IconButton>
        </Box>
      )}

      <Box
        component="nav"
        aria-label="ScoutX navigation"
        sx={{ flex: 1, overflowY: 'auto', px: collapsed ? 1 : 1.25, py: 0.5 }}
      >
        <Stack spacing={0.4}>
          {ALL_NAV_ITEMS.map(({ label, shortLabel, path, icon: Icon, badgeKey }) => {
            const active = isNavItemActive(path, location.pathname);
            const count = renderCount(badgeKey);
            const btn = (
              <Button
                component={Link}
                to={path}
                data-tour={
                  path === '/user/clusters'
                    ? 'scoutx-nav-clusters'
                    : path === '/user/feed'
                      ? 'scoutx-nav-feed'
                      : undefined
                }
                aria-label={label}
                aria-current={active ? 'page' : undefined}
                startIcon={!collapsed ? <Icon sx={{ fontSize: '20px !important' }} /> : undefined}
                sx={{
                  justifyContent: collapsed ? 'center' : 'flex-start',
                  minWidth: 0,
                  minHeight: 44,
                  px: collapsed ? 1 : 1.25,
                  py: 1,
                  borderRadius: RADIUS.control,
                  textTransform: 'none',
                  fontFamily: BODY_FONT,
                  fontWeight: active ? 700 : 550,
                  fontSize: '0.8125rem',
                  letterSpacing: '-0.01em',
                  color: active ? STITCH.primary : STITCH.muted,
                  bgcolor: active ? tint(STITCH.secondary, 0.18) : 'transparent',
                  boxShadow: 'none',
                  '&:hover': {
                    bgcolor: active ? tint(STITCH.secondary, 0.24) : tint(STITCH.primary, 0.05),
                    color: STITCH.primary,
                  },
                  '&:focus-visible': {
                    outline: `2px solid ${STITCH.secondary}`,
                    outlineOffset: 2,
                  },
                  '& .MuiButton-startIcon': {
                    mr: 1.1,
                    ml: 0,
                    color: active ? STITCH.secondaryDark : STITCH.muted,
                  },
                }}
              >
                {collapsed ? (
                  <Icon sx={{ fontSize: 22 }} />
                ) : (
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: 1 }}>
                    <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whitespace: 'nowrap' }}>
                      {label}
                    </Box>
                    {count != null && (
                      <Box
                        component="span"
                        sx={{
                          minWidth: 20,
                          px: 0.6,
                          py: 0.1,
                          borderRadius: RADIUS.pill,
                          bgcolor: STITCH.surfaceLowest,
                          color: STITCH.primary,
                          fontSize: '0.65rem',
                          fontWeight: 800,
                          lineHeight: 1.4,
                        }}
                      >
                        {count}
                      </Box>
                    )}
                  </Box>
                )}
              </Button>
            );
            return collapsed ? (
              <Tooltip key={path} title={shortLabel || label} placement="right">
                {btn}
              </Tooltip>
            ) : (
              <React.Fragment key={path}>{btn}</React.Fragment>
            );
          })}
        </Stack>
      </Box>

      <Box sx={{ px: collapsed ? 1 : 1.5, py: 1.25, borderTop: `1px solid ${STITCH.outlineVariant}` }}>
        {user && (
          <Box
            onClick={(e) => setMenuAnchor(e.currentTarget)}
            role="button"
            tabIndex={0}
            aria-label="Account menu"
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setMenuAnchor(e.currentTarget);
              }
            }}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              cursor: 'pointer',
              borderRadius: RADIUS.control,
              p: 0.75,
              justifyContent: collapsed ? 'center' : 'flex-start',
              '&:hover': { bgcolor: tint(STITCH.primary, 0.05) },
            }}
          >
            <Avatar
              src={avatarcrc}
              alt={user.name}
              sx={{
                width: 36,
                height: 36,
                bgcolor: STITCH.primaryContainer,
                fontSize: '0.85rem',
                fontWeight: 700,
              }}
            >
              {user.name.charAt(0)}
            </Avatar>
            {!collapsed && (
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography
                  noWrap
                  sx={{ fontSize: '0.8rem', fontWeight: 700, color: STITCH.primary, fontFamily: BODY_FONT, lineHeight: 1.2 }}
                >
                  {user.name}
                </Typography>
                <Typography noWrap sx={{ fontSize: '0.68rem', color: STITCH.muted, fontFamily: BODY_FONT }}>
                  {planBadge}
                </Typography>
              </Box>
            )}
          </Box>
        )}
      </Box>

      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={() => setMenuAnchor(null)}
        transformOrigin={{ horizontal: 'left', vertical: 'bottom' }}
        anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
        PaperProps={{
          sx: {
            ml: 1,
            minWidth: 240,
            borderRadius: 2,
            border: `1px solid ${STITCH.outlineVariant}`,
            boxShadow: '0 12px 40px rgba(0,0,0,0.12)',
          },
        }}
      >
        {user && (
          <Box sx={{ px: 2, py: 1.5 }}>
            <Typography sx={{ fontWeight: 700, fontSize: '0.9rem', color: STITCH.primary, fontFamily: DISPLAY_FONT }}>
              {user.name}
            </Typography>
            <Typography sx={{ fontSize: '0.75rem', color: STITCH.muted }}>{user.email}</Typography>
            <Chip
              label={planBadge}
              size="small"
              sx={{
                mt: 1,
                height: 22,
                fontWeight: 700,
                fontSize: '0.65rem',
                bgcolor: STITCH.secondaryContainer,
                color: STITCH.primary,
              }}
            />
          </Box>
        )}
        <Divider />
        <MenuItem
          onClick={() => {
            setMenuAnchor(null);
            navigate('/user/profile');
          }}
        >
          Profile & cettings
        </MenuItem>
        <MenuItem
          onClick={() => {
            setMenuAnchor(null);
            navigate('/user/requests');
          }}
        >
          <NotificationsNoneOutlined sx={{ fontSize: 18, mr: 1 }} />
          Requests
          {badges.requests > 0 && (
            <Badge badgeContent={badges.requests} color="error" sx={{ ml: 'auto' }} />
          )}
        </MenuItem>
        <MenuItem
          onClick={() => {
            setMenuAnchor(null);
            navigate('/user/subscriptions');
          }}
        >
          Subscriptions
        </MenuItem>
        <Divider />
        {showDemoPersonas && (
          <Box sx={{ px: 2, py: 1 }}>
            <Typography sx={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.08em', color: STITCH.muted, mb: 0.75 }}>
              DEMO PERSONA
            </Typography>
            <Stack direction="row" spacing={0.5}>
              {([
                { key: 'priya' as PersonaKey, label: 'Priya' },
                { key: 'marcus' as PersonaKey, label: 'Marcus' },
              ]).map(({ key, label }) => (
                <Button
                  key={key}
                  size="small"
                  onClick={() => switchPersona(key)}
                  sx={{
                    textTransform: 'none',
                    fontWeight: persona === key ? 700 : 500,
                    bgcolor: persona === key ? tint(STITCH.secondary, 0.18) : 'transparent',
                  }}
                >
                  {label}
                </Button>
              ))}
            </Stack>
          </Box>
        )}
        {showDemoPersonas && <Divider />}
        <MenuItem
          onClick={async () => {
            setMenuAnchor(null);
            await logout();
          }}
          sx={{ color: STITCH.error, fontWeight: 600, gap: 1 }}
        >
          <LogoutOutlined sx={{ fontSize: 18 }} />
          Log out
        </MenuItem>
      </Menu>
    </Box>
  );
}

export function useUserNavCollapsed() {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem(COLLAPSE_KEY) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  return { collapsed, setCollapsed, toggle: () => setCollapsed((v) => !v) };
}
