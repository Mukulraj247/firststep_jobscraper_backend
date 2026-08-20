import React from 'react';
import { Alert, Box, Button, CircularProgress, Paper, Stack, Typography } from '@mui/material';
import MailOutlineIcon from '@mui/icons-material/MailOutline';
import RefreshIcon from '@mui/icons-material/Refresh';
import SendOutlinedIcon from '@mui/icons-material/SendOutlined';
import {
  cardSx,
  FIRSTSTEP,
  fadeUpSx,
  RADIUS,
  tint,
} from '../../components/dashboard/ops/dashboardTokens';
import {
  digestAlertSeverity,
  digestSendDisabled,
  digestStatusCaption,
  type DigestStatus,
} from './communicationPageBehavior';

export function OpsDigestPanel({
  status,
  sending,
  loading,
  message,
  loadError,
  onRefresh,
  onSend,
}: {
  status: DigestStatus | null;
  sending: boolean;
  loading: boolean;
  message: string | null;
  loadError: string | null;
  onRefresh: () => void;
  onSend: () => void;
}) {
  const caption = digestStatusCaption(status);
  const sendDisabled = digestSendDisabled(sending, status?.canSend);

  return (
    <Paper
      elevation={0}
      sx={[
        fadeUpSx(1),
        cardSx(),
        { p: { xs: 2.25, md: 3 }, mt: 2.5 },
      ]}
    >
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        justifyContent="space-between"
        alignItems={{ sm: 'flex-start' }}
        spacing={2}
      >
        <Stack direction="row" spacing={1.5} alignItems="flex-start" sx={{ minWidth: 0 }}>
          <Box
            aria-hidden
            sx={{
              width: 44,
              height: 44,
              borderRadius: RADIUS.control,
              display: 'grid',
              placeItems: 'center',
              flexShrink: 0,
              bgcolor: tint(FIRSTSTEP.teal, 0.14),
              color: FIRSTSTEP.teal,
            }}
          >
            <MailOutlineIcon />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle1" fontWeight={700}>
              Email trigger
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25, maxWidth: 560 }}>
              Send the ops digest now to the ZeptoMail recipients configured on the server. Same
              email as the scheduled 6-hour digest.
            </Typography>
          </Box>
        </Stack>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Button
            variant="outlined"
            startIcon={loading ? <CircularProgress size={16} color="inherit" /> : <RefreshIcon />}
            onClick={onRefresh}
            disabled={loading || sending}
          >
            {loading ? 'Loading…' : 'Refresh status'}
          </Button>
          <Button
            variant="contained"
            startIcon={sending ? <CircularProgress size={16} color="inherit" /> : <SendOutlinedIcon />}
            onClick={onSend}
            disabled={sendDisabled || loading}
            sx={{
              bgcolor: FIRSTSTEP.teal,
              '&:hover': { bgcolor: FIRSTSTEP.navy },
            }}
          >
            {sending ? 'Sending…' : 'Send test digest'}
          </Button>
        </Stack>
      </Stack>

      {caption ? (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
          {caption}
        </Typography>
      ) : null}

      {loadError ? (
        <Alert severity="error" sx={{ mt: 2 }}>
          {loadError}
        </Alert>
      ) : null}

      {message ? (
        <Alert severity={digestAlertSeverity(message)} sx={{ mt: 2 }}>
          {message}
        </Alert>
      ) : null}
    </Paper>
  );
}
