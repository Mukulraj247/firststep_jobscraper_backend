import { Chip } from '@mui/material';
import { useTranslation } from 'react-i18next';

export function RunStatusChip({
  status,
  anomaly,
  anomalyMeta,
  size = 'small',
}: {
  status?: string;
  anomaly?: string | null;
  anomalyMeta?: { escalated?: boolean } | null;
  size?: 'small' | 'medium';
}) {
  const { t } = useTranslation();
  const value = String(status || '').toLowerCase();

  if ((value === 'success' || value === 'completed') && !anomaly) {
    return <Chip size={size} label={t('runs_table.run_status_chips.success')} color="success" variant="outlined" />;
  }
  if ((value === 'success' || value === 'completed') && anomaly === 'row_drop') {
    return (
      <Chip
        size={size}
        label={anomalyMeta?.escalated ? 'Row drop (escalated)' : 'Row drop'}
        color="warning"
        variant="outlined"
      />
    );
  }
  if (value === 'running') {
    return <Chip size={size} label={t('runs_table.run_status_chips.running')} color="warning" variant="outlined" />;
  }
  if (value === 'pending') {
    return <Chip size={size} label={t('runs_table.run_status_chips.pending', 'Pending')} color="info" variant="outlined" />;
  }
  if (value === 'scheduled') {
    return <Chip size={size} label={t('runs_table.run_status_chips.scheduled')} variant="outlined" />;
  }
  if (value === 'queued') {
    return <Chip size={size} label={t('runs_table.run_status_chips.queued')} variant="outlined" />;
  }
  if (value === 'failed' && !anomaly) {
    return <Chip size={size} label={t('runs_table.run_status_chips.failed')} color="error" variant="outlined" />;
  }
  if (value === 'failed' && anomaly === 'zero_rows') {
    return <Chip size={size} label="Zero rows" color="error" variant="outlined" />;
  }
  if (value === 'failed' && anomaly === 'row_drop') {
    return <Chip size={size} label="Row drop (escalated)" color="error" variant="outlined" />;
  }
  if (value === 'failed' && anomaly) {
    return <Chip size={size} label={String(anomaly)} color="error" variant="outlined" />;
  }
  if (value === 'dead') {
    return <Chip size={size} label={t('runs_table.run_status_chips.dead', 'Dead')} color="error" variant="outlined" />;
  }
  if (value === 'aborted' || value === 'aborting') {
    return <Chip size={size} label={t('runs_table.run_status_chips.aborted')} color="error" variant="outlined" />;
  }
  if (!value) return <Chip size={size} label="—" variant="outlined" />;
  return <Chip size={size} label={value} variant="outlined" />;
}
