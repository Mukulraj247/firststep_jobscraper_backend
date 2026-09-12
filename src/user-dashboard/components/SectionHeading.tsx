import React from 'react';
import { Box, Stack, Typography } from '@mui/material';
import ChevronRight from '@mui/icons-material/ChevronRight';
import { Link } from 'react-router-dom';
import { BODY_FONT, DISPLAY_FONT, STITCH } from '../tokens';

type Props = {
  title: string;
  count?: number;
  actionLabel?: string;
  actionTo?: string;
};

export function SectionHeading({ title, count, actionLabel, actionTo }: Props) {
  return (
    <Stack
      direction="row"
      alignItems="baseline"
      justifyContent="space-between"
      spacing={1}
      sx={{ mb: 1.5 }}
    >
      <Stack direction="row" alignItems="baseline" spacing={1} sx={{ minWidth: 0 }}>
        <Typography
          component="h2"
          sx={{
            fontFamily: DISPLAY_FONT,
            fontWeight: 600,
            color: STITCH.primaryContainer,
            fontSize: '1.5rem',
            letterSpacing: '-0.02em',
          }}
        >
          {title}
        </Typography>
        {typeof count === 'number' && (
          <Typography sx={{ color: STITCH.muted, fontSize: '0.875rem', fontFamily: BODY_FONT }}>
            {count}
          </Typography>
        )}
      </Stack>
      {actionLabel && actionTo && (
        <Box
          component={Link}
          to={actionTo}
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.25,
            flexShrink: 0,
            fontSize: '0.875rem',
            fontWeight: 600,
            color: STITCH.primaryContainer,
            textDecoration: 'none',
            fontFamily: BODY_FONT,
            '&:hover': { color: STITCH.secondary },
          }}
        >
          {actionLabel}
          <ChevronRight sx={{ fontSize: 16 }} />
        </Box>
      )}
    </Stack>
  );
}
