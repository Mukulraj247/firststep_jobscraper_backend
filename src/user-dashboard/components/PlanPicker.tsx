import React from 'react';
import { Box, Button, Chip, Stack, Typography } from '@mui/material';
import CheckCircle from '@mui/icons-material/CheckCircle';
import type { ClusterPlan, DeliveryFrequency } from '../types';
import { EASE, RADIUS, SHADOW, STITCH, primaryButtonSx, tint } from '../tokens';

type Props = {
  plans: ClusterPlan[];
  selectedPlanId: string;
  selectedFrequency: DeliveryFrequency;
  onPlanChange: (planId: string) => void;
  onFrequencyChange: (freq: DeliveryFrequency) => void;
};

const FREQ_OPTIONS: Array<{ value: DeliveryFrequency; label: string; hint?: string }> = [
  { value: '1h', label: 'Hourly' },
  { value: '2h', label: 'Every 2 hours', hint: 'Recommended' },
  { value: '24h', label: 'Daily' },
];

export function PlanPicker({
  plans,
  selectedPlanId,
  selectedFrequency,
  onPlanChange,
  onFrequencyChange,
}: Props) {
  return (
    <Stack spacing={2.5}>
      <Box>
        <Typography
          variant="overline"
          sx={{ display: 'block', mb: 1, fontWeight: 700, letterSpacing: '0.1em', color: STITCH.muted }}
        >
          DELIVERY WINDOW
        </Typography>
        <Stack direction="row" flexWrap="wrap" gap={0.75}>
          {FREQ_OPTIONS.map(({ value, label, hint }) => {
            const selected = selectedFrequency === value;
            return (
              <Chip
                key={value}
                label={hint && selected ? `${label} · ${hint}` : label}
                onClick={() => onFrequencyChange(value)}
                sx={{
                  borderRadius: RADIUS.pill,
                  fontWeight: selected ? 700 : 500,
                  cursor: 'pointer',
                  border: 'none',
                  bgcolor: selected ? STITCH.secondaryContainer : STITCH.surfaceLow,
                  color: selected ? STITCH.onSecondaryContainer : STITCH.muted,
                  boxShadow: selected ? 'none' : `inset 0 0 0 1px ${STITCH.outlineVariant}`,
                  '&:hover': { bgcolor: selected ? STITCH.secondaryContainer : tint(STITCH.secondary, 0.08) },
                }}
              />
            );
          })}
        </Stack>
      </Box>

      <Stack spacing={1.25}>
        <Typography
          variant="overline"
          sx={{ display: 'block', fontWeight: 700, letterSpacing: '0.1em', color: STITCH.muted }}
        >
          SUBSCRIPTION TIER
        </Typography>
        {plans.map((plan, idx) => {
          const selected = plan.id === selectedPlanId;
          const featured = idx === plans.length - 1 && plans.length > 1;
          return (
            <Box
              key={plan.id}
              role="radio"
              aria-checked={selected}
              tabIndex={0}
              onClick={() => onPlanChange(plan.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onPlanChange(plan.id);
                }
              }}
              sx={{
                p: 2,
                cursor: 'pointer',
                borderRadius: RADIUS.card,
                bgcolor: selected ? tint(STITCH.secondary, 0.07) : STITCH.surfaceLowest,
                boxShadow: selected
                  ? `inset 0 0 0 2px ${STITCH.secondary}, ${SHADOW.sm}`
                  : `inset 0 0 0 1px ${STITCH.outlineVariant}`,
                transition: `box-shadow 180ms ${EASE}, background-color 180ms ${EASE}`,
                '&:hover': {
                  boxShadow: selected
                    ? `inset 0 0 0 2px ${STITCH.secondary}, ${SHADOW.sm}`
                    : `inset 0 0 0 1px ${tint(STITCH.secondary, 0.45)}`,
                },
                '&:focus-visible': { outline: `2px solid ${STITCH.secondary}`, outlineOffset: 2 },
              }}
            >
              <Stack direction="row" justifyContent="space-between" alignItems="baseline" spacing={1}>
                <Stack direction="row" alignItems="center" spacing={0.75}>
                  <Typography sx={{ fontWeight: 700, color: STITCH.primary }}>{plan.name}</Typography>
                  {featured && (
                    <Chip
                      label="Best for job seekers"
                      size="small"
                      sx={{
                        height: 20,
                        fontSize: '0.62rem',
                        fontWeight: 700,
                        bgcolor: STITCH.primaryContainer,
                        color: STITCH.onPrimary,
                      }}
                    />
                  )}
                </Stack>
                <Typography sx={{ fontWeight: 700, color: STITCH.primary, letterSpacing: '-0.02em' }}>
                  ${plan.priceMonthly}
                  <Box component="span" sx={{ fontSize: '0.75rem', fontWeight: 500, color: STITCH.muted }}>
                    /mo
                  </Box>
                </Typography>
              </Stack>
              <Stack spacing={0.5} sx={{ mt: 1 }}>
                {plan.features.map((f) => (
                  <Stack key={f} direction="row" alignItems="flex-start" spacing={0.75}>
                    <CheckCircle sx={{ fontSize: 15, color: STITCH.secondary, mt: 0.25, flexShrink: 0 }} />
                    <Typography variant="body2" sx={{ color: STITCH.muted, fontSize: '0.82rem' }}>
                      {f}
                    </Typography>
                  </Stack>
                ))}
              </Stack>
            </Box>
          );
        })}
      </Stack>
    </Stack>
  );
}

export function PlanPickerStickyBar({ price, onSubscribe }: { price: number; onSubscribe: () => void }) {
  return (
    <Box
      sx={{
        display: { xs: 'flex', md: 'none' },
        position: 'fixed',
        bottom: `calc(62px + env(safe-area-inset-bottom))`,
        left: 0,
        right: 0,
        px: 2,
        py: 1.5,
        zIndex: 1100,
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 1,
        bgcolor: 'rgba(255,255,255,0.96)',
        backdropFilter: 'blur(12px)',
        borderTop: `1px solid ${STITCH.outlineVariant}`,
        boxShadow: SHADOW.lg,
      }}
    >
      <Box>
        <Typography variant="caption" sx={{ color: STITCH.muted, display: 'block', lineHeight: 1.2 }}>
          From
        </Typography>
        <Typography sx={{ fontWeight: 700, color: STITCH.primary, lineHeight: 1.2 }}>${price}/mo</Typography>
      </Box>
      <Button variant="contained" disableElevation onClick={onSubscribe} sx={primaryButtonSx}>
        Subscribe
      </Button>
    </Box>
  );
}
