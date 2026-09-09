import React from 'react';
import { BottomNavigation, BottomNavigationAction, Paper } from '@mui/material';
import { useLocation, useNavigate } from 'react-router-dom';
import { BOTTOM_NAV_ITEMS, isNavItemActive } from '../navItems';
import { BODY_FONT, SHADOW, STITCH, tint } from '../tokens';

export function UserBottomNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const value = BOTTOM_NAV_ITEMS.findIndex((item) => isNavItemActive(item.path, location.pathname));

  return (
    <Paper
      elevation={0}
      sx={{
        display: { xs: 'block', md: 'none' },
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 1200,
        borderTop: `1px solid ${STITCH.border}`,
        borderRadius: 0,
        boxShadow: SHADOW.lg,
        bgcolor: 'rgba(255,255,255,0.96)',
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
        pb: 'env(safe-area-inset-bottom)',
      }}
    >
      <BottomNavigation
        showLabels
        value={value >= 0 ? value : false}
        onChange={(_, idx) => navigate(BOTTOM_NAV_ITEMS[idx].path)}
        sx={{
          bgcolor: 'transparent',
          height: 62,
          fontFamily: BODY_FONT,
          '& .MuiBottomNavigationAction-root': {
            minWidth: 0,
            color: STITCH.muted,
            gap: '2px',
            '&.Mui-selected': { color: STITCH.secondaryDark },
          },
          '& .MuiBottomNavigationAction-label': {
            fontSize: '0.68rem',
            fontWeight: 600,
            fontFamily: BODY_FONT,
            '&.Mui-selected': { fontSize: '0.68rem', fontWeight: 700 },
          },
          '& .Mui-selected .MuiSvgIcon-root': {
            bgcolor: tint(STITCH.secondaryBright, 0.16),
            borderRadius: 999,
            px: 1.5,
            py: 0.15,
          },
        }}
      >
        {BOTTOM_NAV_ITEMS.map((item) => (
          <BottomNavigationAction
            key={item.path}
            label={item.shortLabel ?? item.label}
            icon={<item.icon sx={{ fontSize: 22 }} />}
          />
        ))}
      </BottomNavigation>
    </Paper>
  );
}
