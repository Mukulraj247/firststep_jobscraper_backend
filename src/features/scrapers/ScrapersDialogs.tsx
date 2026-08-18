import React from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { FIRSTSTEP, RADIUS } from '../../components/dashboard/ops/dashboardTokens';

export function ScrapersDialogs({
  warningOpen,
  deleteOpen,
  pendingDeleteName,
  onCloseWarning,
  onConfirmDiscardAndRetrain,
  onCloseDelete,
  onConfirmDelete,
}: {
  warningOpen: boolean;
  deleteOpen: boolean;
  pendingDeleteName?: string | null;
  onCloseWarning: () => void;
  onConfirmDiscardAndRetrain: () => void;
  onCloseDelete: () => void;
  onConfirmDelete: () => void;
}) {
  const { t } = useTranslation();

  return (
    <>
      <Dialog open={warningOpen} onClose={onCloseWarning} fullWidth maxWidth="sm">
        <DialogTitle sx={{ fontWeight: 700 }}>{t('recordingtable.warning_modal.title')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            {t('recordingtable.warning_modal.message')}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={onCloseWarning} variant="outlined" sx={{ borderRadius: RADIUS.pill }}>
            {t('recordingtable.warning_modal.cancel')}
          </Button>
          <Button
            onClick={onConfirmDiscardAndRetrain}
            variant="contained"
            color="error"
            sx={{ borderRadius: RADIUS.pill }}
          >
            {t('recordingtable.warning_modal.discard_and_create')}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={deleteOpen} onClose={onCloseDelete} fullWidth maxWidth="sm">
        <DialogTitle sx={{ fontWeight: 700 }}>
          {t('recordingtable.delete_confirm.title', {
            name: pendingDeleteName,
            defaultValue: 'Delete {{name}}?',
          })}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            {t('recordingtable.delete_confirm.message', {
              name: pendingDeleteName,
              defaultValue: 'Are you sure you want to delete the scraper "{{name}}"?',
            })}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={onCloseDelete} variant="outlined" sx={{ borderRadius: RADIUS.pill }}>
            {t('common.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button
            onClick={onConfirmDelete}
            variant="contained"
            sx={{
              borderRadius: RADIUS.pill,
              bgcolor: FIRSTSTEP.danger,
              '&:hover': { bgcolor: '#b71c1c' },
            }}
          >
            {t('common.delete', { defaultValue: 'Delete' })}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
