import React, { memo } from 'react';
import {
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Tooltip,
} from '@mui/material';
import {
  ContentCopy,
  DeleteForever,
  Edit,
  MoreHoriz,
  PlayCircle,
  Power,
  Refresh,
  Schedule,
  Settings,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { FIRSTSTEP } from '../../components/dashboard/ops/dashboardTokens';
import { overflowMenuAriaLabel, runActionAriaLabel } from './scrapersPageBehavior';

export interface ScrapersRowHandlers {
  onRun: (id: string, name: string, params: string[]) => void;
  onSchedule: (id: string, name: string, params: string[]) => void;
  onIntegrate: (id: string, name: string, params: string[]) => void;
  onSettings: (id: string, name: string, params: string[]) => void;
  onRetrain: (id: string, name: string, url: string | null) => void;
  onEdit: (id: string, name: string, params: string[]) => void;
  onDuplicate: (id: string, name: string, params: string[]) => void;
  onDelete: (id: string) => void;
}

export const ScrapersRowActions = memo(function ScrapersRowActions({
  row,
  handlers,
  compact = false,
}: {
  row: {
    id: string;
    name: string;
    type: string;
    url: string | null;
    params: string[];
  };
  handlers: ScrapersRowHandlers;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);
  const iconSize = compact ? 32 : 36;

  return (
    <>
      <Tooltip title={t('recordingtable.run')} arrow>
        <IconButton
          aria-label={runActionAriaLabel(row.name)}
          size="small"
          onClick={() => handlers.onRun(row.id, row.name, row.params || [])}
          sx={{
            width: iconSize,
            height: iconSize,
            color: FIRSTSTEP.tealDark,
          }}
        >
          <PlayCircle fontSize="small" />
        </IconButton>
      </Tooltip>
      <Tooltip title={t('recordingtable.options')} arrow>
        <IconButton
          aria-label={overflowMenuAriaLabel(row.name)}
          size="small"
          onClick={(event) => setAnchorEl(event.currentTarget)}
          sx={{ width: iconSize, height: iconSize }}
        >
          <MoreHoriz fontSize="small" />
        </IconButton>
      </Tooltip>
      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={() => setAnchorEl(null)}>
        <MenuItem
          onClick={() => {
            handlers.onSchedule(row.id, row.name, row.params || []);
            setAnchorEl(null);
          }}
        >
          <ListItemIcon>
            <Schedule fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t('recordingtable.schedule')}</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            handlers.onIntegrate(row.id, row.name, row.params || []);
            setAnchorEl(null);
          }}
        >
          <ListItemIcon>
            <Power fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t('recordingtable.integrate')}</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            handlers.onSettings(row.id, row.name, row.params || []);
            setAnchorEl(null);
          }}
        >
          <ListItemIcon>
            <Settings fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t('recordingtable.settings')}</ListItemText>
        </MenuItem>
        {row.type !== 'scrape' ? (
          <MenuItem
            onClick={() => {
              handlers.onRetrain(row.id, row.name, row.url);
              setAnchorEl(null);
            }}
          >
            <ListItemIcon>
              <Refresh fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t('recordingtable.retrain')}</ListItemText>
          </MenuItem>
        ) : null}
        <MenuItem
          onClick={() => {
            handlers.onEdit(row.id, row.name, row.params || []);
            setAnchorEl(null);
          }}
        >
          <ListItemIcon>
            <Edit fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t('recordingtable.edit')}</ListItemText>
        </MenuItem>
        {row.type === 'extract' ? (
          <MenuItem
            onClick={() => {
              handlers.onDuplicate(row.id, row.name, row.params || []);
              setAnchorEl(null);
            }}
          >
            <ListItemIcon>
              <ContentCopy fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t('recordingtable.duplicate')}</ListItemText>
          </MenuItem>
        ) : null}
        <MenuItem
          onClick={() => {
            handlers.onDelete(row.id);
            setAnchorEl(null);
          }}
        >
          <ListItemIcon>
            <DeleteForever fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t('recordingtable.delete')}</ListItemText>
        </MenuItem>
      </Menu>
    </>
  );
});
