import React from 'react';
import { Box, Typography } from '@mui/material';
import PlayArrowRounded from '@mui/icons-material/PlayArrowRounded';
import { TourSelectorModal } from './TourSelectorModal';
import { useGuidedTour } from './useGuidedTour';
import { STITCH } from '../tokens';

/** FirstStep-parity Guided Tour FAB — opens the tour selector. */
export function WatchTourButton() {
  const { openSelector } = useGuidedTour();

  return (
    <>
      <Box
        component="button"
        type="button"
        aria-label="Guided Tour"
        onClick={openSelector}
        sx={{
          position: 'fixed',
          bottom: { xs: 16, sm: 32 },
          left: { xs: 16, sm: 32 },
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          bgcolor: '#ffffff',
          color: '#000000',
          boxShadow: '0 4px 14px rgba(0,0,0,0.15)',
          zIndex: 1300,
          px: { xs: 1.5, sm: 2.5 },
          py: { xs: 1.5, sm: 2 },
          borderRadius: { xs: '12px', sm: '16px' },
          border: 'none',
          cursor: 'pointer',
          transition: 'all 0.2s ease',
          font: 'inherit',
          '&:hover': {
            bgcolor: '#f9fafb',
            boxShadow: '0 6px 20px rgba(0,0,0,0.2)',
            transform: 'translateY(-2px)',
          },
        }}
      >
        <PlayArrowRounded sx={{ fontSize: 22, color: STITCH.primary }} />
        <Typography
          sx={{
            fontSize: { xs: 0, sm: '0.875rem' },
            fontWeight: 500,
            display: { xs: 'none', sm: 'inline' },
            color: '#000',
          }}
        >
          Guided Tour
        </Typography>
      </Box>
      <TourSelectorModal />
    </>
  );
}
