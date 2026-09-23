import React from 'react';
import { Box, Typography } from '@mui/material';

const WHATSAPP_PHONE = '919494286653';
const WHATSAPP_MESSAGE = "I'm a beta user for ScoutX. I have few questions.";

function WhatsAppGlyph({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path
        fill="#22c55e"
        d="M16.04 3C9.4 3 4 8.36 4 14.96c0 2.12.56 4.16 1.64 5.96L4 29l8.28-1.56a12.1 12.1 0 0 0 3.76.6c6.64 0 12.04-5.36 12.04-11.96C28.08 8.36 22.68 3 16.04 3zm0 21.84c-1.2 0-2.36-.28-3.4-.84l-.24-.12-4.92.92.92-4.8-.16-.28a9.7 9.7 0 0 1-1.48-5.16c0-5.36 4.4-9.72 9.84-9.72s9.84 4.36 9.84 9.72-4.4 9.72-9.84 9.72zm5.4-7.28c-.28-.16-1.68-.84-1.96-.92-.28-.12-.48-.16-.68.16-.2.28-.76.92-.92 1.12-.16.2-.36.2-.64.08-.28-.16-1.2-.44-2.28-1.4-.84-.76-1.4-1.68-1.56-1.96-.16-.28-.02-.44.14-.56.12-.12.28-.36.4-.52.16-.16.2-.28.28-.48.12-.2.04-.36-.04-.52-.08-.16-.68-1.64-.92-2.24-.24-.6-.48-.52-.68-.52h-.56c-.2 0-.52.08-.8.36-.28.28-1.04 1-1.04 2.44s1.08 2.84 1.24 3.04c.16.2 2.12 3.24 5.12 4.52.72.32 1.28.48 1.72.64.72.24 1.36.2 1.88.12.56-.08 1.68-.68 1.92-1.36.24-.68.24-1.24.16-1.36-.08-.12-.28-.2-.56-.36z"
      />
    </svg>
  );
}

export function ScoutXWhatsAppButton() {
  const href = `https://wa.me/${WHATSAPP_PHONE}?text=${encodeURIComponent(WHATSAPP_MESSAGE)}`;

  return (
    <Box
      component="a"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="WhatsApp Us"
      sx={{
        position: 'fixed',
        bottom: { xs: 16, sm: 32 },
        right: { xs: 16, sm: 32 },
        zIndex: 1300,
        display: 'flex',
        alignItems: 'center',
        gap: { xs: 0, sm: 1.5 },
        bgcolor: '#ffffff',
        color: '#000000',
        boxShadow: '0 4px 14px rgba(0,0,0,0.15)',
        px: { xs: 1.5, sm: 2.5 },
        py: { xs: 1.5, sm: 2 },
        borderRadius: { xs: '12px', sm: '16px' },
        textDecoration: 'none',
        transition: 'all 0.2s ease',
        '&:hover': {
          bgcolor: '#f9fafb',
          boxShadow: '0 6px 20px rgba(0,0,0,0.2)',
          transform: 'translateY(-2px)',
        },
      }}
    >
      <WhatsAppGlyph size={28} />
      <Typography
        sx={{
          fontSize: { xs: 0, sm: '0.875rem' },
          fontWeight: 500,
          display: { xs: 'none', sm: 'inline' },
          color: '#000',
        }}
      >
        WhatsApp Us
      </Typography>
    </Box>
  );
}
