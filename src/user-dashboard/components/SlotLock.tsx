import React from 'react';
import { Box, Button, Typography } from '@mui/material';
import LockOutlined from '@mui/icons-material/LockOutlined';
import type { PortalEntitlements } from '../types';
import {
  DISPLAY_FONT,
  RADIUS,
  STITCH,
  ghostButtonSx,
  primaryButtonSx,
  tint,
} from '../tokens';

type Props = {
  entitlements?: PortalEntitlements | null;
  /** Compact inline variant for cards / banners */
  compact?: boolean;
  sx?: Record<string, unknown>;
};

/** True when the user has used all subscribed cluster slots. */
export function isSlotLocked(entitlements: PortalEntitlements | null | undefined): boolean {
  if (!entitlements) return false;
  if (!entitlements.clusterServiceStarted) return false;
  const allotment =
    entitlements.subscribedSlots ?? entitlements.maxActiveClusters ?? 0;
  if (allotment <= 0) return false;
  return (entitlements.availableSlots ?? 0) <= 0;
}

/**
 * Paywall lock when allotment is exhausted.
 * Payment / upgrade is intentionally a dead-end for now — ops assigns extras.
 */
export function SlotLock({ entitlements, compact = false, sx }: Props) {
  const planSlots =
    entitlements?.subscribedSlots ??
    entitlements?.includedSlots ??
    entitlements?.maxActiveClusters ??
    0;
  const planLabel =
    entitlements?.subscriptionTypeDisplay ||
    entitlements?.subscriptionType ||
    'Your plan';
  const title =
    planSlots === 2
      ? 'Both Premium Plus cluster slots are in use'
      : planSlots === 1
        ? 'Your cluster slot is in use'
        : 'All cluster slots are in use';

  return (
    <Box
      sx={{
        p: compact ? 1.5 : 2.5,
        borderRadius: RADIUS.card,
        bgcolor: tint(STITCH.warning, 0.08),
        border: `1px solid ${tint(STITCH.warning, 0.35)}`,
        textAlign: compact ? 'left' : 'center',
        ...sx,
      }}
    >
      <Box
        sx={{
          display: 'flex',
          flexDirection: compact ? 'row' : 'column',
          alignItems: compact ? 'flex-start' : 'center',
          gap: compact ? 1.25 : 1,
        }}
      >
        <Box
          aria-hidden
          sx={{
            width: compact ? 36 : 48,
            height: compact ? 36 : 48,
            flexShrink: 0,
            borderRadius: '50%',
            display: 'grid',
            placeItems: 'center',
            bgcolor: tint(STITCH.warning, 0.18),
            color: STITCH.warning,
          }}
        >
          <LockOutlined sx={{ fontSize: compact ? 18 : 24 }} />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography
            sx={{
              fontFamily: DISPLAY_FONT,
              fontWeight: 700,
              fontSize: compact ? '0.95rem' : '1.1rem',
              color: STITCH.primary,
            }}
          >
            {title}
          </Typography>
          <Typography
            sx={{
              mt: 0.5,
              fontSize: '0.8125rem',
              color: STITCH.muted,
              maxWidth: compact ? 'none' : 420,
              mx: compact ? 0 : 'auto',
            }}
          >
            {planLabel} includes {planSlots} cluster{planSlots === 1 ? '' : 's'}. Additional
            clusters require payment — unlock is not available in ScoutX yet. Ask ops to increase
            your allotment after payment.
          </Typography>
          {!compact && (
            <Button
              variant="contained"
              disableElevation
              disabled
              startIcon={<LockOutlined sx={{ fontSize: 16 }} />}
              sx={{ ...primaryButtonSx, mt: 2, opacity: 0.7 }}
            >
              Unlock more clusters
            </Button>
          )}
          {compact && (
            <Button
              size="small"
              disabled
              startIcon={<LockOutlined sx={{ fontSize: 14 }} />}
              sx={{ ...ghostButtonSx, mt: 1, opacity: 0.75, pointerEvents: 'none' }}
            >
              Payment coming soon
            </Button>
          )}
        </Box>
      </Box>
    </Box>
  );
}
