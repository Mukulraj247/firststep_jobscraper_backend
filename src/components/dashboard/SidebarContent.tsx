import React from 'react';
import Box from '@mui/material/Box';
import { useNavigate, useLocation } from 'react-router-dom';
import { ButtonBase, Divider, IconButton, Paper, Stack, Tooltip, Typography, useTheme } from '@mui/material';
import {
  AutoAwesome,
  Usb,
  PlayArrow,
  Dashboard,
  WorkOutline,
  ErrorOutline,
  PrecisionManufacturing,
  ChevronLeft,
  ChevronRight,
  MailOutline,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { FIRSTSTEP, tint } from './ops/dashboardTokens';
import { sidebarIconAriaHidden, sidebarNavButtonA11y } from './appShellBehavior';
import { SIDEBAR_NAV_VALUES } from './sidebarNav';

export interface SidebarContentProps {
  value: string;
  handleChangeContent: (newValue: string) => void;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  showCollapseToggle?: boolean;
  onNavigate?: () => void;
}

export const SidebarContent = ({
  value = 'scrapers',
  handleChangeContent,
  collapsed = false,
  onToggleCollapsed,
  showCollapseToggle = true,
  onNavigate,
}: SidebarContentProps) => {
  const theme = useTheme();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();

  const itemMeta: Record<
    (typeof SIDEBAR_NAV_VALUES)[number],
    { label: string; icon: React.ReactNode }
  > = {
    dashboard: { label: 'Dashboard', icon: <Dashboard aria-hidden={sidebarIconAriaHidden} /> },
    automations: {
      label: 'Automations',
      icon: <PrecisionManufacturing aria-hidden={sidebarIconAriaHidden} />,
    },
    jobs: { label: t('mainmenu.jobs'), icon: <WorkOutline aria-hidden={sidebarIconAriaHidden} /> },
    scrapers: { label: t('mainmenu.recordings'), icon: <AutoAwesome aria-hidden={sidebarIconAriaHidden} /> },
    runs: { label: t('mainmenu.runs'), icon: <PlayArrow aria-hidden={sidebarIconAriaHidden} /> },
    failures: {
      label: 'Failure Dashboard',
      icon: <ErrorOutline aria-hidden={sidebarIconAriaHidden} />,
    },
    communication: {
      label: t('mainmenu.communication', 'Communication'),
      icon: <MailOutline aria-hidden={sidebarIconAriaHidden} />,
    },
    proxy: { label: t('mainmenu.proxy'), icon: <Usb aria-hidden={sidebarIconAriaHidden} /> },
  };

  const items = SIDEBAR_NAV_VALUES.map((navValue) => ({
    value: navValue,
    ...itemMeta[navValue],
  }));

  const activeColor =
    theme.palette.mode === 'light' ? theme.palette.primary.main : theme.palette.secondary.main;

  const handleSelect = (next: string) => {
    if (location.pathname !== `/${next}`) {
      navigate(`/${next}`);
    }
    handleChangeContent(next);
    onNavigate?.();
  };

  return (
    <Paper
      component="nav"
      aria-label="Main navigation"
      sx={{
        height: '100%',
        minHeight: '100%',
        width: '100%',
        bgcolor: 'background.paper',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
      variant="outlined"
      square
    >
      <Stack
        direction="row"
        alignItems="center"
        spacing={1.25}
        sx={{
          px: collapsed ? 0 : 2,
          py: 2,
          minHeight: 72,
          flexShrink: 0,
          justifyContent: collapsed ? 'center' : 'flex-start',
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <Box
          aria-hidden
          sx={{
            width: 34,
            height: 34,
            flexShrink: 0,
            display: 'grid',
            placeItems: 'center',
            borderRadius: '10px',
            background: `linear-gradient(135deg, ${FIRSTSTEP.teal} 0%, ${FIRSTSTEP.navy} 100%)`,
            color: FIRSTSTEP.white,
            fontWeight: 700,
            fontSize: '0.95rem',
            letterSpacing: '-0.02em',
            boxShadow: `0 4px 12px ${tint(FIRSTSTEP.navy, 0.28)}`,
          }}
        >
          S
        </Box>
        {!collapsed ? (
          <Typography
            variant="subtitle1"
            noWrap
            sx={{
              fontWeight: 700,
              letterSpacing: '-0.01em',
              lineHeight: 1.2,
              fontSize: '1.02rem',
              color: 'text.primary',
            }}
          >
            {t('navbar.project_name')}
          </Typography>
        ) : null}
      </Stack>

      <Box sx={{ flexGrow: 1, overflowY: 'auto', overflowX: 'hidden', py: 1.25 }}>
        <Stack spacing={0.25} sx={{ px: 1.25 }}>
          {items.map((item) => {
            const selected = value === item.value;
            const button = (
              <ButtonBase
                {...sidebarNavButtonA11y(item.label)}
                onClick={() => handleSelect(item.value)}
                aria-current={selected ? 'page' : undefined}
                sx={{
                  position: 'relative',
                  overflow: 'hidden',
                  width: '100%',
                  minHeight: 46,
                  px: collapsed ? 0 : 1.5,
                  borderRadius: '10px',
                  justifyContent: collapsed ? 'center' : 'flex-start',
                  gap: 1.5,
                  color: selected ? activeColor : 'text.primary',
                  fontWeight: selected ? 700 : 500,
                  fontSize: '0.9375rem',
                  fontFamily: 'inherit',
                  textAlign: 'left',
                  background: selected
                    ? `linear-gradient(135deg, ${tint(FIRSTSTEP.teal, 0.18)} 0%, ${tint(
                        FIRSTSTEP.teal,
                        0.06
                      )} 100%)`
                    : 'transparent',
                  transition: 'background-color 180ms ease, color 180ms ease',
                  '&::before': selected
                    ? {
                        content: '""',
                        position: 'absolute',
                        left: 0,
                        top: 0,
                        bottom: 0,
                        width: 3,
                        bgcolor: FIRSTSTEP.teal,
                      }
                    : undefined,
                  '&:hover': {
                    backgroundColor: selected ? undefined : tint(FIRSTSTEP.navy, 0.05),
                  },
                  '&:focus-visible': {
                    outline: `2px solid ${FIRSTSTEP.teal}`,
                    outlineOffset: 2,
                  },
                  '& svg': { fontSize: 20, flexShrink: 0 },
                  '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
                }}
              >
                {item.icon}
                {!collapsed ? (
                  <Box component="span" sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.label}
                  </Box>
                ) : null}
              </ButtonBase>
            );

            return collapsed ? (
              <Tooltip key={item.value} title={item.label} placement="right" arrow>
                {button}
              </Tooltip>
            ) : (
              <React.Fragment key={item.value}>{button}</React.Fragment>
            );
          })}
        </Stack>
      </Box>

      {showCollapseToggle ? (
        <>
          <Divider />
          <Box sx={{ p: 1.25, flexShrink: 0 }}>
            {collapsed ? (
              <Tooltip title="Expand sidebar" placement="right" arrow>
                <IconButton
                  onClick={onToggleCollapsed}
                  aria-label="Expand sidebar"
                  aria-expanded={false}
                  sx={{ width: '100%', borderRadius: '10px', color: 'text.secondary' }}
                >
                  <ChevronRight />
                </IconButton>
              </Tooltip>
            ) : (
              <ButtonBase
                onClick={onToggleCollapsed}
                aria-label="Collapse sidebar"
                aria-expanded
                sx={{
                  width: '100%',
                  minHeight: 42,
                  px: 1.5,
                  gap: 1.5,
                  borderRadius: '10px',
                  justifyContent: 'flex-start',
                  color: 'text.secondary',
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  fontFamily: 'inherit',
                  '&:hover': { backgroundColor: tint(FIRSTSTEP.navy, 0.05) },
                  '&:focus-visible': { outline: `2px solid ${FIRSTSTEP.teal}`, outlineOffset: 2 },
                  '& svg': { fontSize: 20 },
                }}
              >
                <ChevronLeft />
                {t('mainmenu.collapse', 'Collapse')}
              </ButtonBase>
            )}
          </Box>
        </>
      ) : null}
    </Paper>
  );
};
