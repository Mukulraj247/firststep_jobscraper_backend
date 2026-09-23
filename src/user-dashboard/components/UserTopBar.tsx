import React, { useEffect, useState } from 'react';
import {
  Avatar,
  Box,
  Button,
  Chip,
  Divider,
  Drawer,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  Typography,
} from '@mui/material';
import CloseRounded from '@mui/icons-material/CloseRounded';
import LogoutOutlined from '@mui/icons-material/LogoutOutlined';
import MenuRounded from '@mui/icons-material/MenuRounded';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { BrandMark } from './BrandMark';
import { ALL_NAV_ITEMS, isNavItemActive } from '../navItems';
import { usePortalAuth } from '../hooks/usePortalAuth.tsx';
import { usePortalBootstrap } from '../hooks/portalQueries';
import type { PersonaKey } from '../mock/mockPersonas';
import priyaAvatar from '../assets/persona-priya.png';
import { BODY_FONT, DISPLAY_FONT, EASE, PORTAL_TOPBAR_HEIGHT, RADIUS, STITCH, tint } from '../tokens';

type BadgeCounts = { feed: string | null; saved: number; requests: number };

/** Mobile-only top bar. Desktop navigation lives in UserSideNav. */
export function UserTopBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, switchDemoPersona, authMode, logout } = usePortalAuth();
  const { data: bootstrap } = usePortalBootstrap(Boolean(user));
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const avatarSrc = user?.persona === 'priya' ? priyaAvatar : undefined;
  const persona = (user?.persona === 'marcus' ? 'marcus' : 'priya') as PersonaKey;
  const showDemoPersonas = authMode === 'mock';

  const badges: BadgeCounts = (() => {
    if (!bootstrap) return { feed: null, saved: 0, requests: 0 };
    const active = bootstrap.subscriptions.filter((s) => s.status === 'active');
    const freq = active[0]?.frequency;
    return {
      feed: freq ? `${freq} live` : null,
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

  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  const renderBadge = (badgeKey?: 'feed' | 'saved' | 'requests') => {
    if (badgeKey === 'feed' && badges.feed) {
      return (
        <Box component="span" sx={{ ml: 0.75, fontSize: '0.62rem', fontWeight: 700, color: STITCH.secondaryDark }}>
          {badges.feed}
        </Box>
      );
    }
    if (badgeKey === 'saved' && badges.saved > 0) {
      return (
        <Chip
          size="small"
          label={badges.saved}
          sx={{ ml: 0.75, height: 20, bgcolor: STITCH.secondaryContainer, color: STITCH.primary, fontWeight: 700 }}
        />
      );
    }
    if (badgeKey === 'requests' && badges.requests > 0) {
      return (
        <Chip
          size="small"
          label={badges.requests}
          sx={{ ml: 0.75, height: 20, bgcolor: STITCH.secondaryContainer, color: STITCH.primary, fontWeight: 700 }}
        />
      );
    }
    return null;
  };

  const switchPersona = async (key: PersonaKey) => {
    if (persona === key) return;
    await switchDemoPersona(key);
    window.location.reload();
  };

  return (
    <>
      <Box
        component="header"
        sx={{
          display: { xs: 'flex', md: 'none' },
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 1300,
          height: PORTAL_TOPBAR_HEIGHT,
          bgcolor: STITCH.background,
          borderBottom: `1px solid ${STITCH.outlineVariant}`,
          alignItems: 'center',
          px: 1.5,
          gap: 1,
        }}
      >
        <IconButton
          aria-label="Open menu"
          onClick={() => setDrawerOpen(true)}
          sx={{ color: STITCH.primary, width: 44, height: 44 }}
        >
          <MenuRounded />
        </IconButton>
        <Box component={Link} to="/user" sx={{ textDecoration: 'none', flex: 1, minWidth: 0 }}>
          <BrandMark size={32} />
        </Box>
        {user && (
          <Avatar
            src={avatarSrc}
            alt={user.name}
            onClick={(e) => setMenuAnchor(e.currentTarget)}
            sx={{
              width: 36,
              height: 36,
              bgcolor: STITCH.primaryContainer,
              fontSize: '0.85rem',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            {user.name.charAt(0)}
          </Avatar>
        )}
      </Box>

      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={() => setMenuAnchor(null)}
        transformOrigin={{ horizontal: 'right', vertical: 'top' }}
        anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
        PaperProps={{
          sx: {
            mt: 1,
            minWidth: 240,
            borderRadius: 2,
            border: `1px solid ${STITCH.outlineVariant}`,
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
              sx={{ mt: 1, height: 22, fontWeight: 700, fontSize: '0.65rem', bgcolor: STITCH.secondaryContainer }}
            />
          </Box>
        )}
        <Divider />
        <MenuItem onClick={() => { setMenuAnchor(null); navigate('/user/profile'); }}>Profile & Settings</MenuItem>
        <MenuItem onClick={() => { setMenuAnchor(null); navigate('/user/subscriptions'); }}>Subscriptions</MenuItem>
        {showDemoPersonas && <Divider />}
        {showDemoPersonas && (
          <Box sx={{ px: 2, py: 1 }}>
            <Stack direction="row" spacing={0.5}>
              {(['priya', 'marcus'] as PersonaKey[]).map((key) => (
                <Button key={key} size="small" onClick={() => switchPersona(key)} sx={{ textTransform: 'none' }}>
                  {key === 'priya' ? 'Priya' : 'Marcus'}
                </Button>
              ))}
            </Stack>
          </Box>
        )}
        <Divider />
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

      <Drawer
        anchor="left"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        PaperProps={{
          sx: {
            width: 300,
            bgcolor: STITCH.background,
            color: STITCH.onSurface,
            backgroundImage: 'none',
          },
        }}
      >
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 2, py: 1.25 }}>
          <BrandMark size={32} />
          <IconButton aria-label="Close menu" onClick={() => setDrawerOpen(false)} sx={{ color: STITCH.primary }}>
            <CloseRounded />
          </IconButton>
        </Stack>
        <Divider />
        <Stack sx={{ px: 1.5, py: 1.5, gap: 0.35 }}>
          {ALL_NAV_ITEMS.map(({ label, path, icon: Icon, badgeKey }) => {
            const active = isNavItemActive(path, location.pathname);
            return (
              <Button
                key={path}
                component={Link}
                to={path}
                startIcon={<Icon />}
                onClick={() => setDrawerOpen(false)}
                aria-current={active ? 'page' : undefined}
                sx={{
                  justifyContent: 'flex-start',
                  fontSize: '0.95rem',
                  px: 1.5,
                  py: 1.15,
                  width: '100%',
                  minHeight: 44,
                  borderRadius: RADIUS.control,
                  textTransform: 'none',
                  fontFamily: BODY_FONT,
                  fontWeight: active ? 700 : 550,
                  color: active ? STITCH.primary : STITCH.muted,
                  bgcolor: active ? tint(STITCH.secondary, 0.18) : 'transparent',
                  boxShadow: 'none',
                  transition: `background 180ms ${EASE}`,
                  '& .MuiButton-startIcon': { color: active ? STITCH.secondaryDark : STITCH.muted },
                  '&:hover': { bgcolor: tint(STITCH.primary, 0.06), color: STITCH.primary },
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                  {label}
                  {renderBadge(badgeKey)}
                </Box>
              </Button>
            );
          })}
        </Stack>
      </Drawer>
    </>
  );
}
