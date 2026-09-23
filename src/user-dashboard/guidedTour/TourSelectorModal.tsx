import React from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Typography,
} from '@mui/material';
import CheckCircle from '@mui/icons-material/CheckCircle';
import Close from '@mui/icons-material/Close';
import ExploreOutlined from '@mui/icons-material/ExploreOutlined';
import HomeOutlined from '@mui/icons-material/HomeOutlined';
import PlayArrowRounded from '@mui/icons-material/PlayArrowRounded';
import Replay from '@mui/icons-material/Replay';
import WorkOutline from '@mui/icons-material/WorkOutline';
import { scoutXTourConfigs } from './tourConfigs';
import type { ScoutXTourId } from './types';
import { useGuidedTour } from './useGuidedTour';
import { DISPLAY_FONT, STITCH } from '../tokens';

const iconMap = {
  home: HomeOutlined,
  explore: ExploreOutlined,
  feed: WorkOutline,
} as const;

export function TourSelectorModal() {
  const { state, startTour, closeSelector, resetAllTours } = useGuidedTour();

  const handleSelect = (tourId: ScoutXTourId) => {
    closeSelector();
    setTimeout(() => startTour(tourId), 200);
  };

  return (
    <Dialog
      open={state.isSelectorOpen}
      onClose={closeSelector}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: { borderRadius: 3, overflow: 'hidden', m: { xs: 2, sm: 4 } },
      }}
    >
      <DialogTitle
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          pb: 1,
          pt: 2.5,
          px: 3,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box
            sx={{
              width: 36,
              height: 36,
              borderRadius: '10px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: `linear-gradient(135deg, ${STITCH.primary}, ${STITCH.secondary})`,
            }}
          >
            <PlayArrowRounded sx={{ color: '#fff', fontSize: 20 }} />
          </Box>
          <Typography
            sx={{
              fontFamily: DISPLAY_FONT,
              fontWeight: 700,
              color: STITCH.primary,
              fontSize: { xs: '1rem', sm: '1.15rem' },
            }}
          >
            Guided Tours
          </Typography>
        </Box>
        <IconButton onClick={closeSelector} size="small" aria-label="Close">
          <Close fontSize="small" />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ pt: 1.5, px: 3, pb: 3 }}>
        <Typography sx={{ color: STITCH.muted, mb: 2.5, fontSize: { xs: '0.8rem', sm: '0.875rem' } }}>
          Choose a tour to explore different parts of ScoutX.
        </Typography>

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' },
            gap: 1.5,
          }}
        >
          {scoutXTourConfigs.map((tour) => {
            const Icon = iconMap[tour.icon] || HomeOutlined;
            const isCompleted = state.completedTours.includes(tour.id);
            return (
              <Box
                key={tour.id}
                component="button"
                type="button"
                onClick={() => handleSelect(tour.id)}
                sx={{
                  textAlign: 'left',
                  p: 2,
                  borderRadius: 2.5,
                  border: `1px solid ${isCompleted ? '#86efac' : 'rgba(226, 232, 240, 0.8)'}`,
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  position: 'relative',
                  bgcolor: isCompleted ? 'rgba(16, 185, 129, 0.04)' : '#fff',
                  font: 'inherit',
                  '&:hover': {
                    borderColor: STITCH.primary,
                    bgcolor: 'rgba(2, 51, 69, 0.04)',
                    boxShadow: '0 4px 12px rgba(2, 51, 69, 0.1)',
                    transform: 'translateY(-1px)',
                  },
                }}
              >
                {isCompleted ? (
                  <Box sx={{ position: 'absolute', top: 8, right: 8 }}>
                    <CheckCircle sx={{ fontSize: 16, color: '#10b981' }} />
                  </Box>
                ) : null}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0.75 }}>
                  <Box
                    sx={{
                      width: 32,
                      height: 32,
                      borderRadius: '8px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: `linear-gradient(135deg, ${STITCH.primary}22, ${STITCH.secondary}22)`,
                    }}
                  >
                    <Icon sx={{ fontSize: 16, color: STITCH.primary }} />
                  </Box>
                  <Typography
                    sx={{
                      fontWeight: 600,
                      fontSize: '0.85rem',
                      color: STITCH.onSurface,
                      pr: isCompleted ? 2 : 0,
                    }}
                  >
                    {tour.label}
                  </Typography>
                </Box>
                <Typography sx={{ color: STITCH.muted, fontSize: '0.75rem', lineHeight: 1.4 }}>
                  {tour.description}
                </Typography>
              </Box>
            );
          })}
        </Box>

        {state.completedTours.length > 0 ? (
          <Box sx={{ mt: 2.5, textAlign: 'center' }}>
            <Button
              size="small"
              startIcon={<Replay sx={{ fontSize: 14 }} />}
              onClick={resetAllTours}
              sx={{
                textTransform: 'none',
                fontWeight: 500,
                fontSize: '0.8rem',
                color: STITCH.muted,
                '&:hover': { color: STITCH.primary },
              }}
            >
              Reset all tours
            </Button>
          </Box>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
