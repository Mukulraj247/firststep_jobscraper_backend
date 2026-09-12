import React from 'react';
import { Box, Stack, Typography } from '@mui/material';
import BoltOutlined from '@mui/icons-material/BoltOutlined';
import TuneOutlined from '@mui/icons-material/TuneOutlined';
import VerifiedOutlined from '@mui/icons-material/VerifiedOutlined';
import { BrandMark } from './BrandMark';
import { BODY_FONT, DISPLAY_FONT, RADIUS, SHADOW, STITCH } from '../tokens';

const VALUE_PROPS = [
  { icon: BoltOutlined, title: 'Fresh every 1–2 hours', body: 'New postings reach you while they are still open.' },
  { icon: TuneOutlined, title: 'Clusters, not keyword soup', body: 'Curated feeds built and maintained for you.' },
  { icon: VerifiedOutlined, title: 'Signals that matter', body: 'H-1B sponsorship and filing indicators on every role.' },
];

export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{ minHeight: '100dvh', display: 'flex', bgcolor: STITCH.background, fontFamily: BODY_FONT }}>
      <Box
        sx={{
          display: { xs: 'none', md: 'flex' },
          flexDirection: 'column',
          justifyContent: 'space-between',
          width: '46%',
          maxWidth: 560,
          p: 6,
          position: 'relative',
          overflow: 'hidden',
          color: STITCH.onPrimary,
          background: `linear-gradient(150deg, ${STITCH.primary} 0%, ${STITCH.primaryContainer} 48%, ${STITCH.tertiaryContainer} 100%)`,
        }}
      >
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            width: 420,
            height: 420,
            top: -160,
            right: -140,
            borderRadius: '50%',
            background: STITCH.secondaryBright,
            opacity: 0.28,
            filter: 'blur(110px)',
          }}
        />
        <Box sx={{ position: 'relative' }}>
          <Stack direction="row" alignItems="center" spacing={1.25}>
            <Box
              sx={{
                width: 34,
                height: 34,
                borderRadius: RADIUS.control,
                bgcolor: 'rgba(255,255,255,0.14)',
                border: '1px solid rgba(255,255,255,0.24)',
                display: 'grid',
                placeItems: 'center',
                fontWeight: 800,
                fontSize: '0.95rem',
                fontFamily: DISPLAY_FONT,
              }}
            >
              S
            </Box>
            <Typography sx={{ fontFamily: DISPLAY_FONT, fontWeight: 700, letterSpacing: '-0.03em', fontSize: '1.05rem' }}>
              Scout
              <Box component="span" sx={{ color: STITCH.secondaryBright }}>
                Text
              </Box>
            </Typography>
          </Stack>
        </Box>

        <Box sx={{ position: 'relative' }}>
          <Typography
            sx={{ fontFamily: DISPLAY_FONT, fontWeight: 700, letterSpacing: '-0.035em', fontSize: '2.2rem', lineHeight: 1.15, mb: 3 }}
          >
            Job clusters that come to you.
          </Typography>
          <Stack spacing={2.5}>
            {VALUE_PROPS.map(({ icon: Icon, title, body }) => (
              <Stack key={title} direction="row" spacing={1.75} alignItems="flex-start">
                <Box
                  aria-hidden
                  sx={{
                    width: 36,
                    height: 36,
                    flexShrink: 0,
                    borderRadius: RADIUS.control,
                    bgcolor: 'rgba(255,255,255,0.12)',
                    display: 'grid',
                    placeItems: 'center',
                    color: STITCH.secondaryBright,
                  }}
                >
                  <Icon sx={{ fontSize: 19 }} />
                </Box>
                <Box>
                  <Typography sx={{ fontWeight: 700, fontSize: '0.95rem' }}>{title}</Typography>
                  <Typography sx={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.875rem' }}>{body}</Typography>
                </Box>
              </Stack>
            ))}
          </Stack>
        </Box>

        <Typography sx={{ position: 'relative', color: 'rgba(255,255,255,0.55)', fontSize: '0.75rem' }}>
          Prototype build — mock data, no charges.
        </Typography>
      </Box>

      <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', p: { xs: 2.5, md: 4 } }}>
        <Box
          sx={{
            width: '100%',
            maxWidth: 400,
            bgcolor: STITCH.surfaceLowest,
            border: `1px solid ${STITCH.border}`,
            borderRadius: RADIUS.panel,
            boxShadow: SHADOW.md,
            p: { xs: 3, md: 4 },
          }}
        >
          <Box sx={{ display: { md: 'none' }, mb: 2.5 }}>
            <BrandMark size={36} />
          </Box>
          {children}
        </Box>
      </Box>
    </Box>
  );
}
