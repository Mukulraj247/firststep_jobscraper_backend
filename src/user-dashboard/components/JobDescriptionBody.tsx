import React, { useMemo, useState } from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import {
  buildJobDetailSections,
  sectionBodyLines,
} from '../../utils/jobDescriptionSections';
import { BODY_FONT, DISPLAY_FONT, STITCH } from '../tokens';

/** Strip HTML / normalize whitespace and fix common mojibake for ATS descriptions. */
export function toReadableDescription(value: unknown): string {
  let raw = value == null ? '' : String(value);
  if (!raw.trim()) return '';

  // UTF-8 interpreted as Latin-1 (common: â€¢ → •, â€” → —, â€™ → ')
  raw = raw
    .replace(/â€¢/g, '•')
    .replace(/â€"|â€”/g, '—')
    .replace(/â€“/g, '–')
    .replace(/â€˜/g, "'")
    .replace(/â€™/g, "'")
    .replace(/â€œ/g, '"')
    .replace(/â€/g, '"')
    .replace(/â€¦/g, '…')
    .replace(/Â /g, ' ')
    .replace(/&bull;/gi, '•')
    .replace(/&#8226;/g, '•')
    .replace(/&#x2022;/gi, '•');

  if (/<\/?[a-z][\s\S]*?>/i.test(raw)) {
    raw = raw
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, '\n')
      .replace(/<(h[1-6])[^>]*>/gi, '\n\n')
      .replace(/<\/?(strong|b)\b[^>]*>/gi, '')
      .replace(/<li[^>]*>/gi, '• ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'");
  }

  return raw
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

const EEO_RE = /equal\s+opportunity|eeo\b|affirmative\s+action/i;

type Props = {
  description: string;
  /** Outer section heading (e.g. About the Role). Omit to render sections only. */
  heading?: string;
  emptyLabel?: string;
};

/**
 * Presentable JD for the ScoutX portal — sections + real bullets
 * (same pipeline as ops Job Board).
 */
export function JobDescriptionBody({
  description,
  heading = 'About the Role',
  emptyLabel = 'No description available for this role yet.',
}: Props) {
  const [showLegal, setShowLegal] = useState(false);

  const sections = useMemo(() => {
    const text = toReadableDescription(description);
    if (!text) return [];
    return buildJobDetailSections(text, 'Overview');
  }, [description]);

  if (sections.length === 0) {
    return (
      <Box>
        {heading && (
          <Typography
            sx={{ fontFamily: DISPLAY_FONT, fontWeight: 700, color: STITCH.primary, fontSize: '1.05rem' }}
          >
            {heading}
          </Typography>
        )}
        <Typography sx={{ mt: 1, color: STITCH.muted, fontSize: '0.875rem' }}>{emptyLabel}</Typography>
      </Box>
    );
  }

  const main = sections.filter((s) => !EEO_RE.test(s.title));
  const legal = sections.filter((s) => EEO_RE.test(s.title));

  return (
    <Box>
      {heading && (
        <Typography
          sx={{
            fontFamily: DISPLAY_FONT,
            fontWeight: 700,
            color: STITCH.primary,
            fontSize: '1.05rem',
            mb: 1.5,
          }}
        >
          {heading}
        </Typography>
      )}
      <Stack spacing={2.5}>
        {main.map((section) => {
          const lines = sectionBodyLines(section.body);
          return (
            <Box key={section.id}>
              <Typography
                sx={{
                  display: 'block',
                  fontWeight: 700,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  fontSize: '0.7rem',
                  color: STITCH.muted,
                  mb: 1,
                  fontFamily: BODY_FONT,
                }}
              >
                {section.title}
              </Typography>
              <Stack spacing={0.85}>
                {lines.map((line, i) =>
                  line.type === 'bullet' ? (
                    <Stack key={i} direction="row" spacing={1} alignItems="flex-start">
                      <Typography
                        component="span"
                        sx={{ lineHeight: 1.65, color: STITCH.secondary, fontWeight: 700, mt: 0.05 }}
                      >
                        •
                      </Typography>
                      <Typography
                        sx={{
                          lineHeight: 1.65,
                          fontSize: '0.9rem',
                          flex: 1,
                          color: STITCH.onSurfaceVariant,
                          fontFamily: BODY_FONT,
                        }}
                      >
                        {line.text}
                      </Typography>
                    </Stack>
                  ) : (
                    <Typography
                      key={i}
                      sx={{
                        whiteSpace: 'pre-wrap',
                        lineHeight: 1.7,
                        fontSize: '0.9rem',
                        color: STITCH.onSurfaceVariant,
                        fontFamily: BODY_FONT,
                      }}
                    >
                      {line.text}
                    </Typography>
                  )
                )}
              </Stack>
            </Box>
          );
        })}
      </Stack>

      {legal.length > 0 && (
        <Box sx={{ mt: 2 }}>
          <Button
            size="small"
            onClick={() => setShowLegal((v) => !v)}
            sx={{ textTransform: 'none', fontWeight: 600, color: STITCH.muted, px: 0 }}
          >
            {showLegal ? 'Hide' : 'Show'} equal opportunity / legal text
          </Button>
          {showLegal && (
            <Stack spacing={2} sx={{ mt: 1.5 }}>
              {legal.map((section) => {
                const lines = sectionBodyLines(section.body);
                return (
                  <Box key={section.id}>
                    <Typography
                      sx={{
                        fontWeight: 700,
                        fontSize: '0.7rem',
                        letterSpacing: '0.06em',
                        textTransform: 'uppercase',
                        color: STITCH.muted,
                        mb: 0.75,
                      }}
                    >
                      {section.title}
                    </Typography>
                    {lines.map((line, i) => (
                      <Typography
                        key={i}
                        sx={{
                          fontSize: '0.8rem',
                          color: STITCH.muted,
                          lineHeight: 1.6,
                          whiteSpace: 'pre-wrap',
                          mb: 0.5,
                        }}
                      >
                        {line.type === 'bullet' ? `• ${line.text}` : line.text}
                      </Typography>
                    ))}
                  </Box>
                );
              })}
            </Stack>
          )}
        </Box>
      )}
    </Box>
  );
}
