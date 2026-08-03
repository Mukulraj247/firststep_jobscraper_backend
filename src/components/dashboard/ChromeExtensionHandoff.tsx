import React, { forwardRef, useState } from 'react';
import {
  Box,
  Button,
  IconButton,
  InputAdornment,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { ContentCopy } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { extensionApiBaseUrl } from '../../apiConfig';
import { useGlobalInfoStore } from '../../context/globalInfo';

/** Dashboard card: copy API base URL for the Chrome extension + links to API key and docs. */
export const ChromeExtensionHandoff = forwardRef<HTMLDivElement>((_, ref) => {
  const { t } = useTranslation();
  const { notify } = useGlobalInfoStore();
  const [copied, setCopied] = useState(false);

  const MAXUN_APPLY_BACKEND_URL = 'MAXUN_APPLY_BACKEND_URL';

  const handlePushToExtension = () => {
    try {
      window.postMessage(
        { type: MAXUN_APPLY_BACKEND_URL, backendUrl: extensionApiBaseUrl },
        window.location.origin
      );
      notify('info', t('chrome_extension.notifications.push_sent'));
    } catch {
      notify('error', t('chrome_extension.notifications.push_error'));
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(extensionApiBaseUrl);
      setCopied(true);
      notify('success', t('chrome_extension.notifications.copy_success'));
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      notify('error', t('chrome_extension.notifications.copy_error'));
    }
  };

  return (
    <Paper ref={ref} elevation={0} variant="outlined" sx={{ p: 2.5, mb: 3 }}>
      <Typography variant="h6" fontWeight={700} gutterBottom>
        {t('chrome_extension.title')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t('chrome_extension.subtitle')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t('chrome_extension.setup_steps')}
      </Typography>

      <TextField
        fullWidth
        size="small"
        label={t('chrome_extension.api_base_label')}
        value={extensionApiBaseUrl}
        InputProps={{
          readOnly: true,
          endAdornment: (
            <InputAdornment position="end">
              <IconButton
                edge="end"
                onClick={handleCopy}
                aria-label={t('chrome_extension.copy')}
                size="small"
              >
                <ContentCopy fontSize="small" />
              </IconButton>
            </InputAdornment>
          ),
        }}
        helperText={copied ? t('chrome_extension.copied') : undefined}
      />

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mt: 1 }} alignItems={{ xs: 'stretch', sm: 'center' }}>
        <Button variant="outlined" onClick={handlePushToExtension}>
          {t('chrome_extension.push_to_extension')}
        </Button>
      </Stack>

      <Box sx={{ mt: 2 }}>
        <Typography variant="caption" color="text.secondary" component="p">
          Install the Scout-X Chrome extension from this project&apos;s <code>chrome-extension/</code> folder,
          paste the API base URL above (or push it), then pick a list and Send to Scout-X.
        </Typography>
      </Box>
    </Paper>
  );
});

ChromeExtensionHandoff.displayName = 'ChromeExtensionHandoff';
