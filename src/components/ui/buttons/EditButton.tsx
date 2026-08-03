import { FC } from 'react';
import { IconButton } from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';

interface EditButtonProps {
  handleClick: () => void;
  size?: 'small' | 'medium' | 'large';
}

/** Restored for legacy recorder UI imports. */
export const EditButton: FC<EditButtonProps> = ({ handleClick, size = 'small' }) => (
  <IconButton aria-label="edit" size={size} onClick={handleClick}>
    <EditIcon fontSize="inherit" />
  </IconButton>
);
