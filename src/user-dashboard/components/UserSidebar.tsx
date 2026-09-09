import React, { useEffect, useState } from 'react';
import { Box, ButtonBase, Stack, Typography } from '@mui/material';
import LaunchOutlined from '@mui/icons-material/LaunchOutlined';
import { Link, useLocation } from 'react-router-dom';
import { BrandMark } from './BrandMark';
import { NAV_SECTIONS, isNavItemActive } from '../navItems';
import { usePortalAuth } from '../hooks/usePortalAuth';
import { listRequests, listSaved, listSubscriptions } from '../mock/mockApi';
import type { PersonaKey } from '../mock/mockPersonas';
import { BODY_FONT, EASE, PORTAL_NAV_WIDTH, RADIUS, SHADOW, STITCH } from '../tokens';

type BadgeCounts = { feed: string | null; saved: number; requests: number };

export function UserSidebar() {
  const location = useLocation();
  const { user, switchDemoPersona } = usePortalAuth();
  const [badges, setBadges] = useState<BadgeCounts>({ feed: null, saved: 0, requests: 0 });

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

  const persona = (user?.persona === 'marcus' ? 'marcus' : 'priya') as PersonaKey;

  return (
    <Box
      component="nav"
      aria-label="ScoutText navigation"
      sx={{
        display: { xs: 'none', md: 'flex' },
        flexDirection: 'column',
        position: 'fixed',
        top: 0,
        left: 0,
        bottom: 0,
        width: PORTAL_NAV_WIDTH,
        bgcolor: STITCH.surfaceLowest,
        boxShadow: SHADOW.xs,
        borderRight: `1px solid ${STITCH.border}`,
        zIndex: 50,
      }}
    >
      <Box sx={{ height: 64, px: 3, display: 'flex', alignItems: 'center', flexShrink: 0 }}>
        <Box component={Link} to="/user" sx={{ textDecoration: 'none' }}>
          <BrandMark />
        </Box>
      </Box>

      <Stack sx={{ px: 2, py: 1, gap: 0.25, flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {NAV_SECTIONS[0].items.map(({ label, path, icon: Icon, badgeKey }) => {
          const active = isNavItemActive(path, location.pathname);
          let badge: React.ReactNode = null;
          if (badgeKey === 'feed' && badges.feed) {
            badge = (
              <Box
                component="span"
                sx={{
                  px: 1,
                  py: 0.25,
                  borderRadius: RADIUS.pill,
                  bgcolor: STITCH.secondaryContainer,
                  color: STITCH.onSecondaryContainer,
                  fontSize: '0.68rem',
                  fontWeight: 700,
                  fontFamily: BODY_FONT,
                }}
              >
                {badges.feed}
              </Box>
            );
          } else if (badgeKey === 'saved' && badges.saved > 0) {
            badge = (
              <Box
                component="span"
                sx={{
                  px: 1,
                  py: 0.25,
                  borderRadius: RADIUS.pill,
                  bgcolor: STITCH.surfaceHigh,
                  color: STITCH.onSurface,
                  fontSize: '0.68rem',
                  fontWeight: 700,
                }}
              >
                {badges.saved}
              </Box>
            );
          } else if (badgeKey === 'requests' && badges.requests > 0) {
            badge = (
              <Box
                component="span"
                sx={{
                  px: 1,
                  py: 0.25,
                  borderRadius: RADIUS.pill,
                  bgcolor: STITCH.secondaryContainer,
                  color: STITCH.onSecondaryContainer,
                  fontSize: '0.68rem',
                  fontWeight: 700,
                }}
              >
                {badges.requests} Active
              </Box>
            );
          }

          return (
            <ButtonBase
              key={path}
              component={Link}
              to={path}
              aria-current={active ? 'page' : undefined}
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 1,
                width: '100%',
                px: 2,
                py: 1.15,
                borderRadius: RADIUS.control,
                textAlign: 'left',
                textDecoration: 'none',
                fontFamily: BODY_FONT,
                color: active ? STITCH.onPrimary : STITCH.onSurfaceVariant,
                bgcolor: active ? STITCH.primaryContainer : 'transparent',
                fontWeight: 600,
                fontSize: '0.875rem',
                boxShadow: active ? SHADOW.xs : 'none',
                transition: `background-color 150ms ${EASE}, color 150ms ${EASE}`,
                '&:hover': {
                  bgcolor: active ? STITCH.primaryContainer : STITCH.surfaceLow,
                  color: active ? STITCH.onPrimary : STITCH.onSurface,
                },
                '& .MuiSvgIcon-root': { color: 'inherit', fontSize: 20 },
              }}
            >
              <Stack direction="row" alignItems="center" spacing={1.25} sx={{ minWidth: 0 }}>
                <Icon />
                <Typography noWrap sx={{ fontWeight: 'inherit', fontSize: 'inherit', fontFamily: 'inherit' }}>
                  {label}
                </Typography>
              </Stack>
              {badge}
            </ButtonBase>
          );
        })}
      </Stack>

      <Box
        sx={{
          m: 1.5,
          p: 1.5,
          flexShrink: 0,
          borderRadius: RADIUS.control,
          bgcolor: STITCH.surfaceLow,
          display: 'flex',
          flexDirection: 'column',
          gap: 1.25,
        }}
      >
        <Typography
          sx={{
            fontSize: '0.68rem',
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: STITCH.onSurfaceVariant,
            fontFamily: BODY_FONT,
          }}
        >
          Active Persona
        </Typography>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 0.5,
            p: 0.5,
            bgcolor: STITCH.surfaceLowest,
            borderRadius: '8px',
          }}
        >
          {(
            [
              { key: 'priya' as PersonaKey, label: 'Priya (Student)' },
              { key: 'marcus' as PersonaKey, label: 'Marcus (Pro)' },
            ] as const
          ).map(({ key, label }) => {
            const on = persona === key;
            return (
              <ButtonBase
                key={key}
                onClick={async () => {
                  if (on) return;
                  await switchDemoPersona(key);
                  window.location.reload();
                }}
                sx={{
                  py: 0.85,
                  px: 0.75,
                  borderRadius: '6px',
                  fontSize: '0.68rem',
                  fontWeight: 700,
                  fontFamily: BODY_FONT,
                  bgcolor: on ? STITCH.primaryContainer : 'transparent',
                  color: on ? STITCH.onPrimary : STITCH.onSurfaceVariant,
                  boxShadow: on ? SHADOW.xs : 'none',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  '&:hover': { color: on ? STITCH.onPrimary : STITCH.onSurface },
                }}
              >
                {label}
              </ButtonBase>
            );
          })}
        </Box>
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Typography sx={{ fontSize: '0.68rem', color: STITCH.onSurfaceVariant, fontFamily: BODY_FONT }}>
            Powered by ScoutText
          </Typography>
          <Box
            component={Link}
            to="/login"
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 0.35,
              fontSize: '0.68rem',
              fontWeight: 700,
              color: STITCH.secondary,
              textDecoration: 'none',
              fontFamily: BODY_FONT,
              '&:hover': { color: STITCH.onSecondaryContainer },
            }}
          >
            Ops Login
            <LaunchOutlined sx={{ fontSize: 14 }} />
          </Box>
        </Stack>
      </Box>
    </Box>
  );
}
