import { FC } from 'react';
import { IconButton } from '@mui/material';
import ClearIcon from '@mui/icons-material/Clear';

interface ClearButtonProps {
  handleClick: () => void;
  size?: 'small' | 'medium' | 'large';
}

/** Restored for legacy recorder UI imports. */
export const ClearButton: FC<ClearButtonProps> = ({ handleClick, size = 'small' }) => (
  <IconButton aria-label="clear" size={size} onClick={handleClick}>
    <ClearIcon fontSize="inherit" />
  </IconButton>
);
