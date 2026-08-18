import React from 'react';
import { Box } from '@mui/material';
import { FIRSTSTEP, heroBlobSx, heroBubbleAccentSx } from './dashboardTokens';

/** Decorative glass orbs and bubbles shared by ops page heroes. */
export function OpsHeroBackdrop() {
  return (
    <>
      <Box
        sx={heroBlobSx(FIRSTSTEP.teal, 320, { top: -120, right: -48 }, { opacity: 0.34, blur: 90 })}
      />
      <Box
        sx={heroBlobSx(FIRSTSTEP.tealDark, 220, { bottom: -130, left: '34%' }, { opacity: 0.22, blur: 88 })}
      />
      <Box
        sx={heroBlobSx('#b8ebe6', 160, { top: 18, left: '58%' }, { opacity: 0.55, blur: 64 })}
      />
      <Box sx={heroBubbleAccentSx(56, { top: 28, right: '16%' }, { filled: true })} />
      <Box sx={heroBubbleAccentSx(34, { top: 72, right: '28%' }, { opacity: 0.85 })} />
      <Box sx={heroBubbleAccentSx(22, { bottom: 26, left: '12%' }, { filled: true, opacity: 0.9 })} />
      <Box sx={heroBubbleAccentSx(40, { bottom: 18, right: '42%' }, { opacity: 0.75 })} />
      <Box sx={heroBubbleAccentSx(14, { top: 36, left: '8%' }, { opacity: 0.7 })} />
    </>
  );
}
