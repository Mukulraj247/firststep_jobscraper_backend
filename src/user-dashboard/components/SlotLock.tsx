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

/** Plan-included clusters only (Premium Plus / Falcon = 2; everyone else = 0). */
export function planIncludedClusterCount(
  entitlements: PortalEntitlements | null | undefined
): number {
  return entitlements?.planIncludedSlots ?? entitlements?.includedSlots ?? 0;
}

/** Effective allotment (ops assignment, or Premium Plus plan default). */
export function effectiveAllotment(
  entitlements: PortalEntitlements | null | undefined
): number {
  return entitlements?.subscribedSlots ?? entitlements?.maxActiveClusters ?? 0;
}

/**
 * True when the user cannot subscribe to more clusters.
 * Locked when: subscription is off, allotment is 0, or all slots are used.
 * Premium Plus defaults subscription on (via API) with 2 slots.
 */
export function isSlotLocked(entitlements: PortalEntitlements | null | undefined): boolean {
  if (!entitlements) return false;
  if (!entitlements.clusterServiceStarted) return true;
  const allotment = effectiveAllotment(entitlements);
  if (allotment <= 0) return true;
  return (entitlements.availableSlots ?? 0) <= 0;
}

/** Browse / pick banner body — never claims non–Premium Plus plans “include free slots”. */
export function pickSlotsBannerBody(opts: {
  entitlements: PortalEntitlements | null | undefined;
  remaining: number;
  used: number;
  allotment: number;
}): string {
  const included = planIncludedClusterCount(opts.entitlements);
  const activeNote = opts.used > 0 ? ` · ${opts.used} already active` : '';
  if (included >= 2) {
    return `Premium Plus includes ${included} clusters in your plan${activeNote}. You have ${opts.remaining} remaining. Extra clusters need ops to raise your allotment — unlock is not available in ScoutX yet.`;
  }
  return `Ops assigned you ${opts.allotment} cluster slot${opts.allotment === 1 ? '' : 's'}${activeNote}. Pick up to ${opts.remaining} more. Ask ops if you need a higher allotment.`;
}

/**
 * Paywall / gate lock when subscription is off or allotment is exhausted.
 * Payment / upgrade is intentionally a dead-end for now — ops assigns extras.
 */
export function SlotLock({ entitlements, compact = false, sx }: Props) {
  const allotment = effectiveAllotment(entitlements);
  const included = planIncludedClusterCount(entitlements);
  const planLabel =
    entitlements?.subscriptionTypeDisplay ||
    entitlements?.subscriptionType ||
    'Your plan';
  const subscriptionOff = !entitlements?.clusterServiceStarted;
  const title = subscriptionOff
    ? 'Cluster subscription is not active'
    : allotment <= 0
      ? 'No cluster slots assigned'
      : included >= 2 && allotment <= included
        ? 'Both Premium Plus cluster slots are in use'
        : allotment === 1
          ? 'Your cluster slot is in use'
          : 'All assigned cluster slots are in use';
  const body = subscriptionOff
    ? `Your ${planLabel} plan does not unlock clusters until an admin starts your subscription and assigns how many you can hold.`
    : allotment <= 0
      ? `Ask ops to assign a cluster allotment for your ${planLabel} plan before you can subscribe.`
      : included >= 2 && allotment <= included
        ? `Premium Plus includes ${included} clusters in your plan. Ask ops to increase your allotment for more — unlock is not available in ScoutX yet.`
        : `You've used all ${allotment} slot${allotment === 1 ? '' : 's'} assigned by ops. Ask them to increase your allotment if you need more.`;

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
            {body}
          </Typography>
          {!compact && !subscriptionOff && (
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
          {compact && !subscriptionOff && (
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
