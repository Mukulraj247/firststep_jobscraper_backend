import React from 'react';
import { Avatar, Box, InputAdornment, Stack, TextField, Typography } from '@mui/material';
import SearchOutlined from '@mui/icons-material/SearchOutlined';
import { Link } from 'react-router-dom';
import { BrandMark } from './BrandMark';
import { usePortalAuth } from '../hooks/usePortalAuth';
import priyaAvatar from '../assets/persona-priya.png';
import { BODY_FONT, PORTAL_NAV_WIDTH, PORTAL_TOPBAR_HEIGHT, RADIUS, SHADOW, STITCH } from '../tokens';

/**
 * Desktop sticky top bar (search + live pulse + profile).
 * On mobile it becomes a compact brand/app bar; search moves into page headers.
 */
export function UserTopBar() {
  const { user } = usePortalAuth();
  const avatarSrc = user?.persona === 'priya' ? priyaAvatar : undefined;
  const planBadge = user?.persona === 'marcus' ? 'H-1B Pro' : 'FAANG Pro';

  return (
    <Box
      component="header"
      sx={{
        position: { xs: 'sticky', md: 'fixed' },
        top: 0,
        left: { md: `${PORTAL_NAV_WIDTH}px` },
        right: 0,
        zIndex: 40,
        height: PORTAL_TOPBAR_HEIGHT,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 2,
        px: { xs: 2, md: 3 },
        bgcolor: 'rgba(255,255,255,0.9)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        boxShadow: SHADOW.xs,
      }}
    >
      <Box sx={{ display: { xs: 'block', md: 'none' }, minWidth: 0 }}>
        <Box component={Link} to="/user" sx={{ textDecoration: 'none' }}>
          <BrandMark size={28} />
        </Box>
      </Box>

      <Box sx={{ display: { xs: 'none', md: 'block' }, flex: 1, maxWidth: 560 }}>
        <TextField
          size="small"
          fullWidth
          placeholder="Search job titles, clusters, skills, or sponsors…"
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchOutlined sx={{ fontSize: 20, color: STITCH.onSurfaceVariant }} />
              </InputAdornment>
            ),
          }}
          sx={{
            '& .MuiOutlinedInput-root': {
              borderRadius: RADIUS.control,
              bgcolor: STITCH.surfaceLow,
              fontFamily: BODY_FONT,
              fontSize: '0.8125rem',
              '& fieldset': { border: 'none' },
              '&.Mui-focused': {
                bgcolor: STITCH.surfaceLowest,
                boxShadow: `0 0 0 2px ${STITCH.secondary}33`,
              },
            },
          }}
        />
      </Box>

      <Stack direction="row" alignItems="center" spacing={{ xs: 1, md: 2.5 }}>
        <Stack
          direction="row"
          alignItems="center"
          spacing={0.75}
          sx={{
            display: { xs: 'none', lg: 'flex' },
            px: 1.5,
            py: 0.75,
            borderRadius: RADIUS.pill,
            bgcolor: STITCH.surfaceLow,
          }}
        >
          <Box sx={{ position: 'relative', width: 8, height: 8 }}>
            <Box
              sx={{
                position: 'absolute',
                inset: 0,
                borderRadius: '50%',
                bgcolor: STITCH.secondary,
                opacity: 0.75,
                animation: 'pulse 1.6s ease-out infinite',
                '@keyframes pulse': {
                  '0%': { transform: 'scale(1)', opacity: 0.75 },
                  '100%': { transform: 'scale(2.4)', opacity: 0 },
                },
              }}
            />
            <Box sx={{ position: 'relative', width: 8, height: 8, borderRadius: '50%', bgcolor: STITCH.secondary }} />
          </Box>
          <Typography sx={{ fontSize: '0.68rem', fontWeight: 500, color: STITCH.onSurfaceVariant, fontFamily: BODY_FONT }}>
            Last refreshed 14m ago · 1–2h window active
          </Typography>
        </Stack>

        {user && (
          <Box
            component={Link}
            to="/user/profile"
            sx={{ display: 'flex', alignItems: 'center', gap: 1.25, textDecoration: 'none', pl: 0.5 }}
          >
            <Avatar
              src={avatarSrc}
              alt={user.name}
              sx={{ width: 32, height: 32, bgcolor: STITCH.primaryContainer, fontSize: '0.75rem', fontWeight: 700 }}
            >
              {user.name.charAt(0)}
            </Avatar>
            <Box sx={{ display: { xs: 'none', sm: 'block' }, minWidth: 0 }}>
              <Stack direction="row" alignItems="center" spacing={0.75}>
                <Typography
                  noWrap
                  sx={{ fontSize: '0.75rem', fontWeight: 700, color: STITCH.onSurface, fontFamily: BODY_FONT, lineHeight: 1.2 }}
                >
                  {user.name}
                </Typography>
                <Box
                  component="span"
                  sx={{
                    px: 0.75,
                    py: 0.15,
                    borderRadius: '4px',
                    bgcolor: STITCH.secondaryContainer,
                    color: STITCH.onSecondaryContainer,
                    fontSize: '0.62rem',
                    fontWeight: 700,
                    lineHeight: 1.4,
                    fontFamily: BODY_FONT,
                  }}
                >
                  {planBadge}
                </Box>
              </Stack>
              <Typography noWrap sx={{ fontSize: '0.68rem', color: STITCH.onSurfaceVariant, fontFamily: BODY_FONT, lineHeight: 1.2 }}>
                {user.email}
              </Typography>
            </Box>
          </Box>
        )}
      </Stack>
    </Box>
  );
}
