import axios from "axios";
import { useState, useContext, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { AuthContext } from "../context/auth";
import { Box, Typography, TextField, Button, CircularProgress, InputAdornment, IconButton } from "@mui/material";
import Visibility from "@mui/icons-material/Visibility";
import VisibilityOff from "@mui/icons-material/VisibilityOff";
import { useGlobalInfoStore } from "../context/globalInfo";
import { apiUrl } from "../apiConfig";
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import { useThemeMode } from "../context/theme-provider";
import ScoutXLogo from "../assets/scoutx-logo.png";

const Login = () => {
  const { t } = useTranslation();
  // just don't remove these logs - god knows why it's not working without them
  console.log(i18n)
  console.log(t)
  const [form, setForm] = useState({
    email: "",
    password: "",
  });

  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const { notify } = useGlobalInfoStore();
  const { email, password } = form;

  const { state, dispatch } = useContext(AuthContext);
  const { user } = state;
  const { darkMode } = useThemeMode();

  const navigate = useNavigate();

  useEffect(() => {
    if (user) {
      navigate("/");
    }
  }, [user, navigate]);

  const handleChange = (e: any) => {
    const { name, value } = e.target;
    setForm({ ...form, [name]: value });
  };

  const submitForm = async (e: any) => {
    e.preventDefault();

    if (!email.includes("@")) {
      notify("error", "Please enter a valid email.");
      return;
    }

    setLoading(true);
    try {
      const { data } = await axios.post(
        `${apiUrl}/auth/login`,
        { email, password },
        { withCredentials: true }
      );
      dispatch({ type: "LOGIN", payload: data });
      window.localStorage.setItem("user", JSON.stringify(data));
      navigate("/");
    } catch (err: any) {
      const errorResponse = err.response?.data;

      const errorMessage = errorResponse?.code
        ? t(errorResponse.code)
        : t('login.error.generic');

      notify("error", errorMessage);
      setLoading(false);
    }
  };

  return (
    <Box
      sx={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        maxHeight: "100vh",
        mt: 6,
        padding: 4,
        backgroundColor: "inherit",
      }}
    >
      <Box
        component="form"
        onSubmit={submitForm}
        sx={{
          textAlign: "center",
          backgroundColor: darkMode ? "#121111ff" : "#ffffff",
          color: darkMode ? "#ffffff" : "#333333",
          padding: 6,
          borderRadius: 5,
          boxShadow: "0px 20px 40px rgba(0, 0, 0, 0.2), 0px -5px 10px rgba(0, 0, 0, 0.15)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          maxWidth: 500,
          width: "100%",
        }}
      >
        <img src={ScoutXLogo} alt="Scout-X Scrapper" height={48}
          style={{ marginBottom: 20, width: 'auto', maxHeight: 48, objectFit: 'contain', display: 'block' }} />
        <Typography variant="h4" gutterBottom>
          {t('login.title')}
        </Typography>
        <TextField
          fullWidth
          label={t('login.email')}
          name="email"
          value={email}
          onChange={handleChange}
          margin="normal"
          variant="outlined"
          required
        />
        <TextField
          fullWidth
          label={t('login.password')}
          name="password"
          type={showPassword ? "text" : "password"}
          value={password}
          onChange={handleChange}
          margin="normal"
          variant="outlined"
          InputProps={{
            endAdornment: (
              <InputAdornment position="end">
                <IconButton
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  onClick={() => setShowPassword((prev) => !prev)}
                  edge="end"
                >
                  {showPassword ? <VisibilityOff /> : <Visibility />}
                </IconButton>
              </InputAdornment>
            ),
          }}
          required
        />
        <Button
          type="submit"
          fullWidth
          variant="contained"
          color="primary"
          sx={{
            mt: 2,
            mb: 2,
          }}
          disabled={loading || !email || !password}
        >
          {loading ? (
            <>
              <CircularProgress size={20} sx={{ mr: 2 }} />
              {t('login.loading')}
            </>
          ) : (
            t('login.button')
          )}
        </Button>
        <Typography variant="body2" align="center">
          {t('login.register_prompt')}{" "}
          <Link to="/register" style={{ textDecoration: "none", color: "#ff33cc" }}>
            {t('login.register_link')}
          </Link>
        </Typography>
      </Box>
    </Box>
  );
};

export default Login;