import * as React from 'react';
import Snackbar from '@mui/material/Snackbar';
import MuiAlert, { AlertProps } from '@mui/material/Alert';
import { useGlobalInfoStore } from "../../context/globalInfo";

const Alert = React.forwardRef<HTMLDivElement, AlertProps>(function Alert(
  props,
  ref,
) {
  return <MuiAlert elevation={6} ref={ref} variant="outlined" {...props} />;
});

export interface AlertSnackbarProps {
  severity: 'error' | 'warning' | 'info' | 'success',
  message: string,
  isOpen: boolean,
};

export const AlertSnackbar = ({ severity, message, isOpen }: AlertSnackbarProps) => {
  const { closeNotify } = useGlobalInfoStore();

  const handleClose = (_event?: React.SyntheticEvent | Event, reason?: string) => {
    if (reason === 'clickaway') {
      return;
    }
    closeNotify();
  };

  return (
    <Snackbar
      anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      open={isOpen}
      autoHideDuration={4000}
      onClose={handleClose}
    >
      <Alert onClose={handleClose} severity={severity} sx={{ width: '100%', bgcolor: 'background.paper', border: "none" }} variant="outlined">
        {message}
      </Alert>
    </Snackbar>
  );
}
