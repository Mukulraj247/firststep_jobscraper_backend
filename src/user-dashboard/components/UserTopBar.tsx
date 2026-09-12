import React, { useEffect, useState } from 'react';
import {
  Avatar,
  Badge,
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
import MenuRounded from '@mui/icons-material/MenuRounded';
import NotificationsNoneOutlined from '@mui/icons-material/NotificationsNoneOutlined';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { BrandMark } from './BrandMark';
import { ALL_NAV_ITEMS, isNavItemActive } from '../navItems';
import { usePortalAuth } from '../hooks/usePortalAuth';
import { listRequests, listSaved, listSubscriptions } from '../mock/mockApi';
import type { PersonaKey } from '../mock/mockPersonas';
import priyaAvatar from '../assets/persona-priya.png';
import { BODY_FONT, EASE, PAGE_MAX_WIDTH, PORTAL_TOPBAR_HEIGHT, RADIUS, STITCH, tint } from '../tokens';

type BadgeCounts = { feed: string | null; saved: number; requests: number };

const NAV_LINKS = ALL_NAV_ITEMS.filter((item) => item.path !== '/user/profile');

function NavBadge({ children }: { children: React.ReactNode }) {
  return (
    <Box
      component="span"
      sx={{
        ml: 0.75,
        px: 0.75,
        py: 0.1,
        borderRadius: RADIUS.pill,
        bgcolor: STITCH.secondaryContainer,
        color: STITCH.primary,
        fontSize: '0.58rem',
        fontWeight: 700,
        fontFamily: BODY_FONT,
        lineHeight: 1.4,
      }}
    >
      {children}
    </Box>
  );
}

export function UserTopBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, switchDemoPersona, authMode } = usePortalAuth();
  const [badges, setBadges] = useState<BadgeCounts>({ feed: null, saved: 0, requests: 0 });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const avatarSrc = user?.persona === 'priya' ? priyaAvatar : undefined;
  const planBadge = user?.persona === 'marcus' ? 'H-1B Pro' : user?.persona === 'guest' ? 'ScoutX' : 'FAANG Pro';
  const persona = (user?.persona === 'marcus' ? 'marcus' : 'priya') as PersonaKey;
  const showDemoPersonas = authMode === 'mock';

  useEffect(() => {
    if (!user) return;
    Promise.all([listSubscriptions(), listSaved(), listRequests()]).then(([subs, saved, reqs]) => {
      const active = subs.filter((s) => s.status === 'active');
      const freq = active[0]?.frequency;
      setBadges({
        feed: freq ? `${freq} live` : null,
        saved: saved.length,
        requests: reqs.filter((r) => r.status !== 'published' && r.status !== 'rejected').length,
      });
    });
  }, [user, location.pathname]);

  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  const renderBadge = (badgeKey?: 'feed' | 'saved' | 'requests') => {
    if (badgeKey === 'feed' && badges.feed) return <NavBadge>{badges.feed}</NavBadge>;
    if (badgeKey === 'saved' && badges.saved > 0) return <NavBadge>{badges.saved}</NavBadge>;
    if (badgeKey === 'requests' && badges.requests > 0) return <NavBadge>{badges.requests}</NavBadge>;
    return null;
  };

  const navButtonSx = (active: boolean) => ({
    fontFamily: BODY_FONT,
    color: active ? STITCH.primary : STITCH.muted,
    fontWeight: active ? 600 : 500,
    fontSize: { md: '0.9rem', lg: '1rem' },
    textTransform: 'none' as const,
    letterSpacing: '-0.02em',
    px: { md: 1.25, lg: 1.6 },
    py: 1.1,
    minHeight: 48,
    minWidth: 'auto',
    borderRadius: '10px',
    whiteSpace: 'nowrap' as const,
    flexShrink: 0,
    bgcolor: active ? tint(STITCH.primary, 0.08) : 'transparent',
    position: 'relative' as const,
    transition: `all 200ms ${EASE}`,
    '&:hover': {
      bgcolor: tint(STITCH.primary, 0.1),
      color: STITCH.primary,
    },
    '&::after': active
      ? {
          content: '""',
          position: 'absolute',
          left: 12,
          right: 12,
          bottom: 6,
          height: 3,
          borderRadius: 99,
          bgcolor: STITCH.secondary,
        }
      : {},
    '& .MuiButton-startIcon': { mr: 0.85 },
    '& .MuiSvgIcon-root': { fontSize: 20 },
  });

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
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 1300,
          height: { xs: 72, md: PORTAL_TOPBAR_HEIGHT },
          bgcolor: '#f5f9fa',
          borderBottom: `1px solid ${STITCH.outlineVariant}`,
          boxShadow: 'none',
        }}
      >
        <Box
          sx={{
            height: '100%',
            maxWidth: PAGE_MAX_WIDTH,
            mx: 'auto',
            px: { xs: 2.5, md: 4 },
            display: 'flex',
            alignItems: 'center',
            gap: { md: 1, lg: 2 },
          }}
        >
        <IconButton
          aria-label="Open menu"
          onClick={() => setDrawerOpen(true)}
          sx={{
            display: { xs: 'inline-flex', md: 'none' },
            color: STITCH.primary,
            mr: 0.5,
            width: 44,
            height: 44,
          }}
        >
          <MenuRounded />
        </IconButton>

        <Box component={Link} to="/user" sx={{ textDecoration: 'none', flexShrink: 0 }}>
          <BrandMark size={40} />
        </Box>

        <Box
          component="nav"
          aria-label="ScoutText navigation"
          sx={{
            display: { xs: 'none', md: 'flex' },
            alignItems: 'center',
            justifyContent: 'flex-start',
            flex: 1,
            gap: { md: 0.25, lg: 0.5 },
            minWidth: 0,
            ml: { md: 1, lg: 2 },
          }}
        >
          {NAV_LINKS.map(({ label, path, icon: Icon, badgeKey }) => {
            const active = isNavItemActive(path, location.pathname);
            return (
              <Button
                key={path}
                component={Link}
                to={path}
                startIcon={<Icon />}
                aria-current={active ? 'page' : undefined}
                sx={navButtonSx(active)}
              >
                {label}
                {renderBadge(badgeKey)}
              </Button>
            );
          })}
        </Box>

        <Stack direction="row" alignItems="center" spacing={1.25} sx={{ ml: 'auto', flexShrink: 0 }}>
          <IconButton
            aria-label="Notifications"
            sx={{
              display: { xs: 'none', sm: 'inline-flex' },
              color: STITCH.muted,
              width: 44,
              height: 44,
              '&:hover': { bgcolor: tint(STITCH.primary, 0.08), color: STITCH.primary },
            }}
          >
            <Badge badgeContent={badges.requests} color="error" max={99}>
              <NotificationsNoneOutlined sx={{ fontSize: 22 }} />
            </Badge>
          </IconButton>

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
                gap: 1.25,
                cursor: 'pointer',
                borderRadius: 999,
                py: 0.5,
                pl: 0.5,
                pr: { xs: 0.5, md: 1.25 },
                '&:hover': { bgcolor: tint(STITCH.primary, 0.06) },
              }}
            >
              <Avatar
                src={avatarSrc}
                alt={user.name}
                sx={{
                  width: { xs: 40, md: 44 },
                  height: { xs: 40, md: 44 },
                  bgcolor: STITCH.primaryContainer,
                  fontSize: '0.9rem',
                  fontWeight: 700,
                  border: `2px solid ${STITCH.primary}`,
                }}
              >
                {user.name.charAt(0)}
              </Avatar>
              <Box sx={{ display: { xs: 'none', lg: 'block' }, minWidth: 0, textAlign: 'left' }}>
                <Typography
                  noWrap
                  sx={{ fontSize: '0.85rem', fontWeight: 700, color: STITCH.primary, fontFamily: BODY_FONT, lineHeight: 1.2 }}
                >
                  {user.name}
                </Typography>
                <Typography noWrap sx={{ fontSize: '0.7rem', color: STITCH.muted, fontFamily: BODY_FONT, lineHeight: 1.3 }}>
                  {planBadge}
                </Typography>
              </Box>
            </Box>
          )}
        </Stack>
        </Box>
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
            boxShadow: '0 12px 40px rgba(0,0,0,0.12)',
          },
        }}
      >
        {user && (
          <Box sx={{ px: 2, py: 1.5 }}>
            <Typography sx={{ fontWeight: 700, fontSize: '0.9rem', color: STITCH.primary, fontFamily: BODY_FONT }}>
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
          Profile & Settings
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
                    ...navButtonSx(persona === key),
                    fontSize: '0.72rem',
                    px: 1.25,
                  }}
                >
                  {label}
                </Button>
              ))}
            </Stack>
          </Box>
        )}
        {showDemoPersonas && <Divider />}
      </Menu>

      <Drawer
        anchor="left"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        PaperProps={{
          sx: {
            width: 300,
            bgcolor: '#f5f9fa',
            pt: 1,
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
                sx={{
                  ...navButtonSx(active),
                  justifyContent: 'flex-start',
                  fontSize: '0.95rem',
                  px: 1.5,
                  py: 1.15,
                  width: '100%',
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
