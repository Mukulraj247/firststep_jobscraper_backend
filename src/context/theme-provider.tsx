import React, { createContext, useContext, useState, useEffect } from 'react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { FIRSTSTEP, FOCUS_VISIBLE_RING, MAIN_CONTENT_FOCUS_SELECTORS } from '../components/dashboard/ops/dashboardTokens';

export { FOCUS_VISIBLE_RING };

const firstStepFont =
  "'Geologica', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

const focusVisibleFor = (color: string) => ({
  outline: FOCUS_VISIBLE_RING.outline,
  outlineColor: color,
  outlineOffset: FOCUS_VISIBLE_RING.outlineOffset,
});

const interactiveFocusVisible = (color: string) => ({
  '&:focus-visible': focusVisibleFor(color),
});

const baselineA11y = (ringColor: string) => ({
  '.skip-link': {
    position: 'absolute',
    left: 16,
    top: -48,
    zIndex: 2000,
    padding: '8px 14px',
    backgroundColor: FIRSTSTEP.navy,
    color: FIRSTSTEP.white,
    borderRadius: 8,
    fontWeight: 700,
    textDecoration: 'none',
    '&:focus': {
      top: 12,
      ...focusVisibleFor(FIRSTSTEP.teal),
    },
  },
  [MAIN_CONTENT_FOCUS_SELECTORS.join(', ')]: {
    ...focusVisibleFor(ringColor),
  },
  'button:focus-visible, a:focus-visible, [role="button"]:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible, .MuiButtonBase-root:focus-visible, .MuiChip-root:focus-visible, .MuiPaginationItem-root:focus-visible, .MuiIconButton-root:focus-visible, .MuiMenuItem-root:focus-visible, .MuiInputBase-input:focus-visible': {
    ...focusVisibleFor(ringColor),
  },
});

const lightFocus = interactiveFocusVisible(FIRSTSTEP.navy);
const darkFocus = interactiveFocusVisible(FIRSTSTEP.teal);

const lightTheme = createTheme({
  typography: {
    fontFamily: firstStepFont,
  },
  palette: {
    primary: {
      main: "#023345",
      dark: "#002941",
      light: "#2a8e9e",
      contrastText: "#ffffff",
    },
    secondary: {
      main: "#4fb3a9",
      dark: "#2a8e9e",
      light: "#7dcdc5",
      contrastText: "#002941",
    },
    background: {
      default: "#f8f9fa",
      paper: "#ffffff",
    },
    text: {
      primary: "#023345",
      secondary: "#4a6570",
    },
    divider: "rgba(2, 51, 69, 0.12)",
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: baselineA11y(FIRSTSTEP.navy),
    },
    MuiTableContainer: {
      styleOverrides: {
        root: {
          overflow: 'auto',
          /* Firefox */
          scrollbarWidth: 'thin',
          scrollbarColor: 'gray transparent',

          /* WebKit (Chrome, Edge, Safari) */
          '&::-webkit-scrollbar': {
            width: '5px',
            height: '5px',
          },
          '&::-webkit-scrollbar-track': {
            background: 'transparent',
          },
          '&::-webkit-scrollbar-thumb': {
            backgroundColor: 'gray',
            borderRadius: '8px',
          },
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          // Default styles for all buttons (optional)
          textTransform: "none",
          ...lightFocus,
        },
        containedPrimary: {
          "&:hover": {
            backgroundColor: "#0c4a6e",
          },
        },
        outlined: {
          // Apply white background for all 'outlined' variant buttons
          backgroundColor: "#ffffff",
          "&:hover": {
            backgroundColor: "#f0f0f0", // Optional lighter background on hover
          },
        },
      },
    },
    MuiLink: {
      styleOverrides: {
        root: {
          "&:hover": {
            color: "#0e7490",
          },
          ...lightFocus,
        },
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: {
          ...lightFocus,
        },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: {
         minHeight: 60, 
         textTransform: "none",
        },
      },
    },
    MuiAlert: {
      styleOverrides: {
        outlinedInfo: {
          color: 'rgb(0, 0, 0)',
          border: 'none',
          "& .MuiAlert-icon": {
            color: "#000000",
          },
        },
        standardInfo: {
          backgroundColor: "#e8f6f4",
          color: "#023345",
          "& .MuiAlert-icon": {
            color: "#2a8e9e",
          },
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
        },
        rounded: {
          borderRadius: 12,
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          fontWeight: 600,
          ...lightFocus,
        },
      },
    },
    MuiPaginationItem: {
      styleOverrides: {
        root: {
          ...lightFocus,
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        input: lightFocus,
      },
    },
    MuiMenuItem: {
      styleOverrides: {
        root: lightFocus,
      },
    },
  },
});

const darkTheme = createTheme({
  typography: {
    fontFamily: firstStepFont,
  },
  palette: {
    mode: 'dark',
    primary: {
      main: "#4fb3a9",
      contrastText: "#002941",
    },
    secondary: {
      main: "#4fb3a9",
      dark: "#2a8e9e",
      light: "#7dcdc5",
      contrastText: "#002941",
    },
    error: {
      main: '#f44336',
      light: '#e57373',
      dark: '#d32f2f',
      contrastText: '#ffffff',
    },
    background: {
      default: '#000000ff',
      paper: '#000000ff',
    },
    text: {
      primary: '#ffffff',
      secondary: '#b3b3b3',
    },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: baselineA11y(FIRSTSTEP.teal),
    },
    MuiTableContainer: {
      styleOverrides: {
        root: {
          overflow: 'auto',
          /* Firefox */
          scrollbarWidth: 'thin',
          scrollbarColor: 'currentColor transparent',

          /* WebKit (Chrome, Edge, Safari) */
          '&::-webkit-scrollbar': {
            width: '5px',
            height: '5px',
          },
          '&::-webkit-scrollbar-track': {
            background: 'transparent',
          },
          '&::-webkit-scrollbar-thumb': {
            backgroundColor: 'currentColor',
            borderRadius: '8px',
          },
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: "none",
          color: '#ffffff',
          ...darkFocus,
          '&.MuiButton-outlined': {
            borderColor: '#ffffff',
            color: '#ffffff',
            "&:hover": {
              borderColor: '#ffffff',
              backgroundColor: 'inherit',
            },
          },
        },
        containedPrimary: {
          "&:hover": {
            backgroundColor: "#155e75",
          },
        },
        outlined: {
          borderColor: '#0e7490',
          color: '#0e7490',
          "&:hover": {
            borderColor: '#22d3ee',
          },
          '&.MuiButton-outlinedError': {
            borderColor: '#f44336',
            color: '#f44336',
            "&:hover": {
              // backgroundColor: 'rgba(244, 67, 54, 0.08)',
              borderColor: '#d32f2f',
            },
          },
        },
      },
    },
    MuiLink: {
      styleOverrides: {
        root: {
          color: '#22d3ee',
          "&:hover": {
            color: "#67e8f9",
          },
          ...darkFocus,
        },
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: {
          color: '#ffffff',
          ...darkFocus,
          '&.MuiIconButton-colorError': {
            color: '#f44336',
          },
        },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: {
          minHeight: 60, 
          textTransform: "none",
          color: '#ffffff',
          "&.Mui-selected": {
            color: '#22d3ee',
          },
        },
      },
    },
    MuiAlert: {
      styleOverrides: {
        outlinedInfo: {
          color: '#ffffff',
          border: 'none',
          "& .MuiAlert-icon": {
            color: "#ffffff",
          },
        },
        standardInfo: {
          backgroundColor: "#082f49",
          color: "#e0f2fe",
          "& .MuiAlert-icon": {
            color: "#22d3ee",
          },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          fontWeight: 600,
          ...darkFocus,
        },
      },
    },
    MuiPaginationItem: {
      styleOverrides: {
        root: {
          ...darkFocus,
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        input: darkFocus,
      },
    },
    MuiMenuItem: {
      styleOverrides: {
        root: darkFocus,
      },
    },
    // Additional dark mode specific components
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundColor: '#000000ff',
          border: '1px solid #080808ff',
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundColor: '#080808ff',
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          backgroundColor: '#080808ff',
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: {
          borderBottom: '1px solid #080808ff',
        },
      },
    },
    MuiDivider: {
      styleOverrides: {
        root: {
          borderColor: '#494949ff',
        },
      },
    },
    //   MuiTextField:{
    //     styleOverrides: {
    //       root: {
    //         '& .MuiInputBase-root': {
    //           backgroundColor: '#1d1c1cff',
    //         },
    //   }
    // }}
  },
});

const ThemeModeContext = createContext({
  toggleTheme: () => { },
  darkMode: false,
});

export const useThemeMode = () => useContext(ThemeModeContext);

const ThemeModeProvider = ({ children }: { children: React.ReactNode }) => {
  // Load saved mode from localStorage or default to light mode
  const [darkMode, setDarkMode] = useState(() => {
    const savedMode = localStorage.getItem('darkMode');
    return savedMode ? JSON.parse(savedMode) : false;
  });

  const toggleTheme = () => {
    setDarkMode((prevMode: any) => {
      const newMode = !prevMode;
      localStorage.setItem('darkMode', JSON.stringify(newMode)); // Save new mode to localStorage
      return newMode;
    });
  };

  useEffect(() => {
    localStorage.setItem('darkMode', JSON.stringify(darkMode)); // Save initial mode
  }, [darkMode]);

  return (
    <ThemeModeContext.Provider value={{ toggleTheme, darkMode }}>
      <ThemeProvider theme={darkMode ? darkTheme : lightTheme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </ThemeModeContext.Provider>
  );
};

export default ThemeModeProvider;