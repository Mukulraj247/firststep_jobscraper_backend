import React, { useCallback, useEffect, useState } from 'react';
import { Box } from '@mui/material';
import { getDashboardDigestStatus, sendDashboardDigestTest } from '../api/automation';
import { FIRSTSTEP } from '../components/dashboard/ops/dashboardTokens';
import { CommunicationHero } from '../features/communication/CommunicationHero';
import { OpsDigestPanel } from '../features/communication/OpsDigestPanel';
import { digestSentMessage, type DigestStatus } from '../features/communication/communicationPageBehavior';

export const CommunicationPage = () => {
  const [status, setStatus] = useState<DigestStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setStatus(await getDashboardDigestStatus());
    } catch (error: any) {
      const statusCode = error?.response?.status;
      setLoadError(
        statusCode === 401 || statusCode === 403
          ? 'You need to be signed in to load digest status.'
          : error?.response?.data?.error || 'Failed to load digest status',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const handleSend = async () => {
    setSending(true);
    setMessage(null);
    try {
      const result = await sendDashboardDigestTest();
      setMessage(digestSentMessage(result.summary));
      const next = await getDashboardDigestStatus().catch(() => null);
      if (next) setStatus(next);
    } catch (error: any) {
      const data = error?.response?.data;
      setMessage(data?.reason || data?.error || 'Failed to send digest');
    } finally {
      setSending(false);
    }
  };

  return (
    <Box
      sx={{
        p: { xs: 2, md: 3 },
        minHeight: '100%',
        bgcolor: (theme) => (theme.palette.mode === 'dark' ? '#000' : FIRSTSTEP.surface),
      }}
    >
      <CommunicationHero canSend={status?.canSend} />
      <OpsDigestPanel
        status={status}
        sending={sending}
        loading={loading}
        message={message}
        loadError={loadError}
        onRefresh={() => {
          void loadStatus();
        }}
        onSend={() => {
          void handleSend();
        }}
      />
    </Box>
  );
};
