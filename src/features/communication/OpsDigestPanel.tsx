import React, { useEffect, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import MailOutlineIcon from '@mui/icons-material/MailOutline';
import RefreshIcon from '@mui/icons-material/Refresh';
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined';
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
  digestRecipientsEqual,
  digestSendDisabled,
  digestStatusCaption,
  normalizeDigestEmailList,
  type DigestStatus,
} from './communicationPageBehavior';

export function OpsDigestPanel({
  status,
  sending,
  saving,
  loading,
  message,
  loadError,
  onRefresh,
  onSend,
  onSaveRecipients,
}: {
  status: DigestStatus | null;
  sending: boolean;
  saving: boolean;
  loading: boolean;
  message: string | null;
  loadError: string | null;
  onRefresh: () => void;
  onSend: () => void;
  onSaveRecipients: (recipients: string[]) => void;
}) {
  const [draft, setDraft] = useState<string[]>(status?.recipients || []);
  const [inputValue, setInputValue] = useState('');

  useEffect(() => {
    setDraft(status?.recipients || []);
  }, [status?.recipients]);

  const caption = digestStatusCaption(status);
  const sendDisabled = digestSendDisabled(sending, status?.canSend);
  const dirty = !digestRecipientsEqual(draft, status?.recipients || []);
  const busy = loading || sending || saving;

  const commitInput = () => {
    const next = normalizeDigestEmailList([...draft, inputValue]);
    setDraft(next);
    setInputValue('');
  };

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
              These addresses all receive the scheduled digest and test sends. Add or remove as
              many as you need.
            </Typography>
          </Box>
        </Stack>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Button
            variant="outlined"
            startIcon={loading ? <CircularProgress size={16} color="inherit" /> : <RefreshIcon />}
            onClick={onRefresh}
            disabled={busy}
          >
            {loading ? 'Loading…' : 'Refresh status'}
          </Button>
          <Button
            variant="contained"
            startIcon={sending ? <CircularProgress size={16} color="inherit" /> : <SendOutlinedIcon />}
            onClick={onSend}
            disabled={sendDisabled || busy || dirty}
            sx={{
              bgcolor: FIRSTSTEP.teal,
              '&:hover': { bgcolor: FIRSTSTEP.navy },
            }}
          >
            {sending ? 'Sending…' : 'Send test digest'}
          </Button>
        </Stack>
      </Stack>

      <Box sx={{ mt: 2.5 }}>
        <Autocomplete
          multiple
          freeSolo
          options={[]}
          value={draft}
          inputValue={inputValue}
          onInputChange={(_e, value) => setInputValue(value)}
          onChange={(_e, value) => {
            setDraft(normalizeDigestEmailList(value));
          }}
          onBlur={() => {
            if (inputValue.trim()) commitInput();
          }}
          disabled={busy}
          renderTags={(value, getTagProps) =>
            value.map((option, index) => {
              const { key, ...tagProps } = getTagProps({ index });
              return <Chip key={key} label={option} size="small" {...tagProps} />;
            })
          }
          renderInput={(params) => (
            <TextField
              {...params}
              label="Digest recipients"
              placeholder={draft.length ? 'Add another email' : 'name@company.com'}
              helperText="Press Enter or paste a comma-separated list. Save to apply."
              onKeyDown={(e) => {
                if (e.key === 'Enter' && inputValue.trim()) {
                  e.preventDefault();
                  commitInput();
                }
              }}
            />
          )}
        />
        <Stack direction="row" spacing={1} sx={{ mt: 1.5 }} flexWrap="wrap" useFlexGap>
          <Button
            variant="contained"
            startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <SaveOutlinedIcon />}
            onClick={() => onSaveRecipients(normalizeDigestEmailList([...draft, inputValue]))}
            disabled={busy || !dirty}
            sx={{
              bgcolor: FIRSTSTEP.navy,
              '&:hover': { bgcolor: FIRSTSTEP.tealDark },
            }}
          >
            {saving ? 'Saving…' : 'Save recipients'}
          </Button>
        </Stack>
      </Box>

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
