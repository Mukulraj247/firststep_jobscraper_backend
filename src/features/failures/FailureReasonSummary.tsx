import React from 'react';
import { Box, Paper, Stack, Typography } from '@mui/material';
import AllInclusiveIcon from '@mui/icons-material/AllInclusive';
import ViewQuiltOutlinedIcon from '@mui/icons-material/ViewQuiltOutlined';
import SecurityOutlinedIcon from '@mui/icons-material/SecurityOutlined';
import WebAssetOffOutlinedIcon from '@mui/icons-material/WebAssetOffOutlined';
import TravelExploreOutlinedIcon from '@mui/icons-material/TravelExploreOutlined';
import HourglassEmptyOutlinedIcon from '@mui/icons-material/HourglassEmptyOutlined';
import PowerOffOutlinedIcon from '@mui/icons-material/PowerOffOutlined';
import HelpOutlineOutlinedIcon from '@mui/icons-material/HelpOutlineOutlined';
import { cardSx, fadeUpSx, FIRSTSTEP, tint } from '../../components/dashboard/ops/dashboardTokens';
import {
  REASON_SUMMARY_ITEMS,
  normalizeReasonCounts,
} from './failuresPageBehavior';

const REASON_ICONS: Record<string, React.ReactNode> = {
  '': <AllInclusiveIcon />,
  layout_change: <ViewQuiltOutlinedIcon />,
  captcha: <SecurityOutlinedIcon />,
  browser_closed: <WebAssetOffOutlinedIcon />,
  navigation_error: <TravelExploreOutlinedIcon />,
  timeout: <HourglassEmptyOutlinedIcon />,
  circuit_open: <PowerOffOutlinedIcon />,
  unknown: <HelpOutlineOutlinedIcon />,
};

const REASON_ACCENTS: Record<string, string> = {
  '': FIRSTSTEP.danger,
  layout_change: FIRSTSTEP.navy,
  captcha: FIRSTSTEP.tealDark,
  browser_closed: FIRSTSTEP.tealDeep,
  navigation_error: FIRSTSTEP.teal,
  timeout: FIRSTSTEP.navyDeep,
  circuit_open: FIRSTSTEP.tealDark,
  unknown: FIRSTSTEP.navy,
};

export function FailureReasonSummary({
  countsByReason,
  selectedReason,
  onSelect,
}: {
  countsByReason: Record<string, number>;
  selectedReason: string;
  onSelect: (reason: string) => void;
}) {
  const normalized = normalizeReasonCounts(countsByReason);

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: {
          xs: '1fr 1fr',
          md: 'repeat(4, 1fr)',
          xl: 'repeat(8, 1fr)',
        },
        gap: 2,
        mb: 3,
      }}
    >
      {REASON_SUMMARY_ITEMS.map((item, index) => {
        const count = item.code ? (normalized.byCode[item.code] || 0) : normalized.all;
        const selected = selectedReason === item.code;
        const accent = REASON_ACCENTS[item.code] || FIRSTSTEP.teal;
        return (
          <Paper
            key={item.code || 'all'}
            elevation={0}
            component="button"
            type="button"
            aria-pressed={selected}
            onClick={() => onSelect(selected && item.code ? '' : item.code)}
            sx={[
              cardSx(accent),
              fadeUpSx(index * 40),
              {
                p: 1.75,
                pt: 2.25,
                textAlign: 'left',
                cursor: 'pointer',
                font: 'inherit',
                color: 'inherit',
                borderColor: selected ? accent : undefined,
                bgcolor: selected ? tint(accent, 0.1) : undefined,
                outline: selected ? `2px solid ${accent}` : 'none',
                outlineOffset: selected ? -2 : 0,
                minHeight: 88,
                '&:focus-visible': {
                  outline: `2px solid ${FIRSTSTEP.teal}`,
                  outlineOffset: 2,
                },
              },
            ]}
          >
            <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={1}>
              <Typography
                variant="overline"
                sx={{
                  color: 'text.secondary',
                  fontWeight: 700,
                  fontSize: '0.68rem',
                  letterSpacing: '0.12em',
                  lineHeight: 1.4,
                }}
              >
                {item.label}
              </Typography>
              <Box
                aria-hidden
                sx={{
                  flexShrink: 0,
                  width: 34,
                  height: 34,
                  display: 'grid',
                  placeItems: 'center',
                  borderRadius: '10px',
                  color: accent,
                  bgcolor: tint(accent, 0.12),
                  '& svg': { fontSize: 19 },
                }}
              >
                {REASON_ICONS[item.code]}
              </Box>
            </Stack>
            <Typography
              sx={{
                mt: 0.5,
                fontSize: { xs: '1.35rem', md: '1.5rem' },
                fontWeight: 700,
                lineHeight: 1.1,
                letterSpacing: '-0.02em',
                fontVariantNumeric: 'tabular-nums',
                color: item.code === '' ? FIRSTSTEP.danger : 'text.primary',
              }}
            >
              {count}
            </Typography>
          </Paper>
        );
      })}
    </Box>
  );
}
