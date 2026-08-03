import { IconButton } from '@mui/material';
import CircleOutlinedIcon from '@mui/icons-material/CircleOutlined';
import CircleIcon from '@mui/icons-material/Circle';

interface BreakpointButtonProps {
  handleClick: () => void;
  size?: 'small' | 'medium' | 'large';
  changeColor?: boolean;
}

/** Restored for legacy recorder UI imports. */
export const BreakpointButton = ({
  handleClick,
  size = 'small',
  changeColor = false,
}: BreakpointButtonProps) => (
  <IconButton aria-label="breakpoint" size={size} onClick={handleClick} color={changeColor ? 'error' : 'default'}>
    {changeColor ? <CircleIcon fontSize="inherit" /> : <CircleOutlinedIcon fontSize="inherit" />}
  </IconButton>
);
