import React from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import type { SvgIconComponent } from '@mui/icons-material';
import { Link } from 'react-router-dom';
import { BODY_FONT, DISPLAY_FONT, RADIUS, STITCH, accentButtonSx, ghostButtonSx, tint } from '../tokens';

type Props = {
  icon: SvgIconComponent;
  title: string;
  description: string;
  actionLabel?: string;
  actionTo?: string;
  onAction?: () => void;
  secondaryLabel?: string;
  secondaryTo?: string;
  variant?: 'onboarding' | 'filtered';
};

export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  actionTo,
  onAction,
  secondaryLabel,
  secondaryTo,
  variant = 'onboarding',
}: Props) {
  const onboarding = variant === 'onboarding';

  return (
    <Box
      sx={{
        textAlign: 'center',
        px: 3,
        py: { xs: 4, md: onboarding ? 6 : 5 },
        borderRadius: RADIUS.card,
        border: `1px dashed ${onboarding ? tint(STITCH.secondaryBright, 0.4) : STITCH.border}`,
        bgcolor: onboarding ? tint(STITCH.secondaryBright, 0.05) : STITCH.surfaceLowest,
      }}
    >
      <Box
        aria-hidden
        sx={{
          width: 56,
          height: 56,
          mx: 'auto',
          mb: 2,
          borderRadius: '50%',
          display: 'grid',
          placeItems: 'center',
          bgcolor: tint(STITCH.secondaryBright, 0.14),
          color: STITCH.secondaryDark,
        }}
      >
        <Icon sx={{ fontSize: 28 }} />
      </Box>
      <Typography sx={{ fontFamily: DISPLAY_FONT, fontWeight: 600, color: STITCH.onSurface, fontSize: '1.1rem' }}>
        {title}
      </Typography>
      <Typography sx={{ color: STITCH.muted, mt: 0.75, maxWidth: 420, mx: 'auto', fontSize: '0.875rem', fontFamily: BODY_FONT }}>
        {description}
      </Typography>
      {(actionLabel || secondaryLabel) && (
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} justifyContent="center" sx={{ mt: 2.5 }}>
          {actionLabel && (
            <Button
              variant="contained"
              disableElevation
              sx={accentButtonSx}
              {...(actionTo ? { component: Link, to: actionTo } : { onClick: onAction })}
            >
              {actionLabel}
            </Button>
          )}
          {secondaryLabel && secondaryTo && (
            <Button variant="outlined" component={Link} to={secondaryTo} sx={ghostButtonSx}>
              {secondaryLabel}
            </Button>
          )}
        </Stack>
      )}
    </Box>
  );
}
