import React from 'react';
import { Box, Paper, Stack, Typography } from '@mui/material';
import { OpsHeroBackdrop } from '../../components/dashboard/ops/OpsHeroBackdrop';
import {
  FIRSTSTEP,
  fadeUpSx,
  heroGlassOverlineSx,
  heroGlassPanelSx,
  heroGlassPillSx,
  heroGlassPillTextSx,
  heroGlassSubtitleSx,
  heroGlassTitleSx,
} from '../../components/dashboard/ops/dashboardTokens';

export function CommunicationHero({ canSend }: { canSend: boolean | undefined }) {
  const ready = canSend === true;
  return (
    <Paper
      elevation={0}
      sx={[fadeUpSx(0), heroGlassPanelSx({ shadow: 'lifted' }), { p: { xs: 2.5, md: 3.5 } }]}
    >
      <OpsHeroBackdrop />
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'flex-start', md: 'flex-end' }}
        spacing={2.5}
        sx={{ position: 'relative', zIndex: 1 }}
      >
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="overline" sx={heroGlassOverlineSx}>
            Communication
          </Typography>
          <Typography sx={heroGlassTitleSx('lg')}>Email trigger</Typography>
          <Typography variant="body2" sx={{ ...heroGlassSubtitleSx, maxWidth: 560 }}>
            Manual send for the Scout-X ops digest — last 6h runs, jobs added, failures, and a light infra snapshot.
          </Typography>
          <Stack direction="row" alignItems="center" spacing={1} sx={heroGlassPillSx}>
            <Box
              aria-hidden
              sx={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                bgcolor: ready ? FIRSTSTEP.teal : FIRSTSTEP.danger,
                boxShadow: ready
                  ? '0 0 0 4px rgba(79, 179, 169, 0.18)'
                  : '0 0 0 4px rgba(196, 92, 92, 0.16)',
              }}
            />
            <Typography variant="body2" sx={heroGlassPillTextSx}>
              {canSend == null ? 'Checking ZeptoMail…' : ready ? 'Ready to send' : 'Not configured'}
            </Typography>
          </Stack>
        </Box>
      </Stack>
    </Paper>
  );
}
