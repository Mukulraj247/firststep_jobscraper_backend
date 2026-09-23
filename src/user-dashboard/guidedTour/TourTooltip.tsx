import React from 'react';
import { Box, Button, IconButton, Typography } from '@mui/material';
import Close from '@mui/icons-material/Close';
import type { TooltipRenderProps } from 'react-joyride';
import { DISPLAY_FONT, STITCH, primaryButtonSx } from '../tokens';

export function TourTooltip({
  continuous,
  index,
  step,
  backProps,
  closeProps,
  primaryProps,
  tooltipProps,
  size,
}: TooltipRenderProps) {
  return (
    <Box
      {...tooltipProps}
      sx={{
        bgcolor: '#ffffff',
        borderRadius: 3,
        boxShadow: '0 12px 40px rgba(0,0,0,0.15)',
        width: { xs: 300, sm: 360 },
        maxWidth: 'calc(100vw - 32px)',
        p: 0,
        overflow: 'hidden',
        position: 'relative',
        zIndex: 1,
      }}
    >
      <Box
        sx={{
          height: 4,
          background: `linear-gradient(90deg, ${STITCH.primary}, ${STITCH.secondary})`,
        }}
      />
      <IconButton
        {...closeProps}
        size="small"
        aria-label="Close tour step"
        sx={{
          position: 'absolute',
          top: 10,
          right: 10,
          color: STITCH.muted,
          '&:hover': { bgcolor: 'rgba(0,0,0,0.04)' },
        }}
      >
        <Close sx={{ fontSize: 16 }} />
      </IconButton>

      <Box sx={{ px: 3, pt: 2.5, pb: 1.5 }}>
        {step.title ? (
          <Typography
            sx={{
              fontWeight: 700,
              fontFamily: DISPLAY_FONT,
              color: STITCH.primary,
              mb: 0.5,
              pr: 3,
              fontSize: '1rem',
            }}
          >
            {step.title}
          </Typography>
        ) : null}
        <Typography
          sx={{
            color: STITCH.muted,
            lineHeight: 1.6,
            fontSize: { xs: '0.825rem', sm: '0.875rem' },
            pr: 2,
          }}
        >
          {step.content}
        </Typography>
      </Box>

      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: 3,
          pb: 2,
          pt: 1,
        }}
      >
        <Typography sx={{ color: STITCH.muted, fontSize: '0.75rem' }}>
          {index + 1} of {size}
        </Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          {index > 0 && (
            <Button
              {...backProps}
              size="small"
              variant="text"
              sx={{
                textTransform: 'none',
                fontWeight: 600,
                fontSize: '0.8rem',
                color: STITCH.muted,
                minWidth: 'auto',
                px: 1.5,
              }}
            >
              Back
            </Button>
          )}
          {continuous && (
            <Button
              {...primaryProps}
              size="small"
              variant="contained"
              disableElevation
              sx={{
                ...primaryButtonSx,
                textTransform: 'none',
                fontWeight: 600,
                fontSize: '0.8rem',
                borderRadius: 2,
                px: 2.5,
                py: 0.5,
              }}
            >
              {index === size - 1 ? 'Finish' : 'Next'}
            </Button>
          )}
        </Box>
      </Box>
    </Box>
  );
}
