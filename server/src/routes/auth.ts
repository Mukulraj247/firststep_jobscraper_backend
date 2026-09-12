import jwt from "jsonwebtoken";
import { requireSignIn } from "../middlewares/auth";
import { Auth0Request, requireAuth0AccessToken } from "../middlewares/auth0";
import {
  hasScoutXAdmin,
  resolveScoutXRoles,
  extractEmailFromAuth0Payload,
  extractSubFromAuth0Payload,
  extractFirstStepRole,
  SCOUTX_USER_ROLE,
  type ScoutXRole,
} from "../services/scoutxAuth0";
import { resolveOpsMongoUser } from "../services/scoutxOpsUser";
import { fetchFirstStepPlanSnapshot } from "../services/firstStepSubscription";
import { upsertPortalUser } from "../services/portalUserService";
import { genAPIKey } from "../utils/api";
import { google } from "googleapis";
import { capture } from "../utils/analytics";
import crypto from 'crypto';
import User from "../models/User";
import Robot from "../models/Robot";
import { Router, Request, Response } from "express";

declare module "express-session" {
  interface SessionData {
    code_verifier: string;
    robotId: string;
  }
}

export const router = Router();

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const isCrossOriginDeployment = (() => {
  try {
    const publicUrl = process.env.PUBLIC_URL ? new URL(process.env.PUBLIC_URL) : null;
    const backendUrl = process.env.BACKEND_URL ? new URL(process.env.BACKEND_URL) : null;
    if (!publicUrl || !backendUrl) return false;
    return publicUrl.origin !== backendUrl.origin;
  } catch {
    return false;
  }
})();
/** Secure cookies need HTTPS. Never use SameSite=None on plain HTTP. */
const cookieSecure = (process.env.PUBLIC_URL || '').trim().toLowerCase().startsWith('https:');
const cookieSameSite: 'none' | 'lax' =
  IS_PRODUCTION && isCrossOriginDeployment && cookieSecure ? 'none' : 'lax';

/** JWT session cookie for the web app (`requireSignIn`). */
const jwtCookieOptions = {
  httpOnly: true,
  secure: cookieSecure,
  sameSite: cookieSameSite,
  path: '/',
};

/** Short-lived OAuth integration status cookies (non-secret; read by frontend). */
const oauthStatusCookieOptions = {
  httpOnly: false,
  maxAge: 60000,
  secure: cookieSecure,
  sameSite: cookieSameSite,
  path: '/',
};

interface AuthenticatedRequest extends Request {
  user?: { id: string };
}

router.post("/register", async (_req, res) => {
  return res.status(410).json({
    error: "Password registration is disabled. Use Auth0 to sign in to ScoutX.",
    code: "register.auth0_only",
  });
});

router.post("/login", async (_req, res) => {
  return res.status(410).json({
    error: "Password login is disabled. Use Auth0 to sign in to ScoutX.",
    code: "login.auth0_only",
  });
});

/**
 * Exchange a validated Auth0 access token for ScoutX session.
 * ScoutX_Admin (RBAC claim only) → Mongo ops owner cookie.
 * Everyone else → portal session + scoutx_portal_users upsert (no maxun_users).
 */
router.post("/auth0/exchange", requireAuth0AccessToken, async (req: Auth0Request, res: Response) => {
  try {
    const payload = (req.auth?.payload || {}) as Record<string, unknown>;
    const bodyEmail =
      typeof req.body?.email === 'string' ? String(req.body.email).trim().toLowerCase() : null;
    const bodyName = typeof req.body?.name === 'string' ? String(req.body.name).trim() : null;
    const bodyFirstStepRole =
      typeof req.body?.firstStepRole === 'string' ? String(req.body.firstStepRole).trim() : null;
    const email = bodyEmail || extractEmailFromAuth0Payload(payload);
    const auth0Sub = extractSubFromAuth0Payload(payload);
    const roles = resolveScoutXRoles(payload, email);
    const firstStepRole = extractFirstStepRole(payload, bodyFirstStepRole);
    const name =
      bodyName ||
      (typeof payload.name === 'string' ? payload.name : null) ||
      (email ? email.split('@')[0] : null);

    // Debug: why /user vs /dashboard (remove once Auth0 roles are confirmed)
    console.log('[auth0/exchange]', {
      email,
      auth0Sub,
      roles,
      rolesClaim: payload['https://scoutx.app/roles'],
      permissions: payload.permissions,
      aud: payload.aud,
    });

    const firstStepPlan = await fetchFirstStepPlanSnapshot(auth0Sub);

    if (hasScoutXAdmin(roles)) {
      if (!email && !auth0Sub) {
        return res.status(400).json({
          error:
            'Auth0 token is missing email. Enable email scope / Action claim, or pass email in the request body.',
          code: 'auth0.email_required',
        });
      }

      const opsUser = await resolveOpsMongoUser({ email, auth0Sub, payload });
      if (!opsUser) {
        return res.status(500).json({
          error:
            'Ops Mongo user not found. Set SCOUTX_OPS_USER_ID to the existing maxun_users._id (do not register a new user).',
          code: 'auth0.ops_user_missing',
        });
      }

      if (auth0Sub && email) {
        try {
          await upsertPortalUser({
            auth0Sub,
            email,
            name,
            scoutxRoles: roles,
            firstStepRole,
            firstStepPlan,
          });
        } catch (err) {
          console.warn('Portal profile upsert (admin) failed (non-fatal):', err);
        }
      }

      const token = jwt.sign({ id: opsUser.id }, process.env.JWT_SECRET as string);
      res.cookie('token', token, jwtCookieOptions);

      capture('maxun-oss-user-login', {
        email: opsUser.email,
        userId: opsUser.id,
        authSource: 'auth0',
        loggedInAt: new Date().toISOString(),
      });

      return res.json({
        id: opsUser.id,
        email: opsUser.email,
        name: name || opsUser.email,
        auth0Sub: opsUser.auth0Sub || auth0Sub,
        scoutxRoles: roles,
        authSource: 'auth0',
        landing: '/dashboard',
        firstStepPlan: {
          subscriptionType: firstStepPlan.subscriptionType,
          isActive: firstStepPlan.isActive,
          status: firstStepPlan.status,
        },
        firstStepRole,
      });
    }

    // Portal — any Auth0 user; do not create maxun_users or set ops cookie.
    if (!email) {
      return res.status(400).json({
        error: 'Auth0 token is missing email for portal login.',
        code: 'auth0.email_required',
      });
    }
    if (!auth0Sub) {
      return res.status(400).json({
        error: 'Auth0 token is missing sub for portal profile.',
        code: 'auth0.sub_required',
      });
    }

    const portalRoles: ScoutXRole[] = roles.includes(SCOUTX_USER_ROLE)
      ? roles
      : [...roles, SCOUTX_USER_ROLE];

    try {
      await upsertPortalUser({
        auth0Sub,
        email,
        name,
        scoutxRoles: portalRoles,
        firstStepRole,
        firstStepPlan,
      });
    } catch (err) {
      console.error('Portal profile upsert failed:', err);
      return res.status(500).json({
        error: 'Failed to create portal profile',
        code: 'auth0.portal_upsert_failed',
      });
    }

    return res.json({
      id: auth0Sub,
      email,
      name: name || email.split('@')[0],
      auth0Sub,
      scoutxRoles: portalRoles,
      authSource: 'auth0',
      landing: '/user',
      firstStepPlan: {
        subscriptionType: firstStepPlan.subscriptionType,
        isActive: firstStepPlan.isActive,
        status: firstStepPlan.status,
      },
      firstStepRole,
    });
  } catch (error: any) {
    console.error(`Auth0 exchange error: ${error?.message || error}`);
    return res.status(500).json({
      error: 'SERVER_ERROR',
      code: 'auth0.exchange_failed',
    });
  }
});

router.get("/auth0/config", (_req, res) => {
  const domain = String(process.env.AUTH0_DOMAIN || '').trim();
  const clientId = String(process.env.AUTH0_SPA_CLIENT_ID || process.env.AUTH0_CLIENT_ID || '').trim();
  const audience = String(process.env.AUTH0_API_AUDIENCE || process.env.AUTH0_AUDIENCE || '').trim();
  res.json({
    configured: !!(domain && clientId),
    domain: domain || null,
    clientId: clientId || null,
    audience: audience || null,
  });
});

router.get("/logout", async (req, res) => {
  try {
    res.clearCookie("token", {
      path: jwtCookieOptions.path,
      secure: jwtCookieOptions.secure,
      sameSite: jwtCookieOptions.sameSite,
    });
    return res.status(200).json({
      ok: true,
      message: "Logged out successfully",
      code: "success"
    });
  } catch (error) {
    console.error('Logout error:', error);
    return res.status(500).json({
      ok: false,
      message: "Error during logout",
      code: "server",
      error: process.env.NODE_ENV === 'development' ? error : undefined
    });
  }
}
);

router.get(
  "/current-user",
  requireSignIn,
  async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ ok: false, error: "Unauthorized" });
      }
      const user = await User.findById(req.user.id).select('-password');
      if (!user) {
        return res.status(404).json({ ok: false, error: "User not found" });
      } else {
        return res.status(200).json({ ok: true, user: user });
      }
    } catch (error: any) {
      console.error("Error in current-user route:", error);
      return res
        .status(500)
        .json({
          ok: false,
          error: `Could not fetch current user: ${error.message}`,
        });
    }
  }
);

router.get(
  "/user/:id",
  requireSignIn,
  async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user || !req.user.id) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const userId = req.user.id;

      const user = await User.findById(userId).select('-password');

      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      return res
        .status(200)
        .json({ message: "User fetched successfully", user });
    } catch (error: any) {
      return res
        .status(500)
        .json({ message: "Error fetching user", error: error.message });
    }
  }
);

router.post(
  "/generate-api-key",
  requireSignIn,
  async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ ok: false, error: "Unauthorized" });
      }
      const user = await User.findById(req.user.id).select('-password');

      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      if (user.api_key) {
        return res.status(400).json({ message: "API key already exists" });
      }
      const apiKey = genAPIKey();
      const createdAt = new Date();

      user.api_key = apiKey;
      user.api_key_created_at = createdAt;
      await user.save();

      capture("maxun-oss-api-key-created", {
        user_id: user._id,
        created_at: new Date().toISOString(),
      });

      return res.status(200).json({
        message: "API key generated successfully",
        api_key: apiKey,
        api_key_created_at: createdAt,
      });
    } catch (error) {
      return res
        .status(500)
        .json({ message: "Error generating API key", error });
    }
  }
);

router.get(
  "/api-key",
  requireSignIn,
  async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          ok: false,
          error: "Unauthorized",
          code: "unauthorized"
        });
      }

      const user = await User.findById(req.user.id)
        .select('api_key api_key_created_at')
        .lean();

      if (!user) {
        return res.status(404).json({
          ok: false,
          error: "User not found",
          code: "not_found"
        });
      }

      return res.status(200).json({
        ok: true,
        message: "API key fetched successfully",
        api_key: user.api_key || null,
        api_key_created_at: user.api_key_created_at || null,
      });
    } catch (error) {
      console.error('API Key fetch error:', error);
      return res.status(500).json({
        ok: false,
        error: "Error fetching API key",
        code: "server",
      });
    }
  }
);

router.delete(
  "/delete-api-key",
  requireSignIn,
  async (req: AuthenticatedRequest, res) => {
    if (!req.user) {
      return res.status(401).send({ error: "Unauthorized" });
    }

    try {
      const user = await User.findById(req.user.id).lean();

      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      if (!user.api_key) {
        return res.status(404).json({ message: "API Key not found" });
      }

      await User.updateOne({ _id: req.user.id }, { api_key: null, api_key_created_at: null });

      capture("maxun-oss-api-key-deleted", {
        user_id: user._id,
        deleted_at: new Date().toISOString(),
      });

      return res.status(200).json({ message: "API Key deleted successfully" });
    } catch (error: any) {
      return res
        .status(500)
        .json({ message: "Error deleting API key", error: error.message });
    }
  }
);

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

// Step 1: Redirect to Google for authentication
router.get("/google", (req, res) => {
  const { robotId } = req.query;
  if (!robotId) {
    return res.status(400).json({ message: "Robot ID is required" });
  }
  const scopes = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/drive.readonly",
  ];
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // Ensures you get a refresh token on first login
    scope: scopes,
    state: robotId.toString(),
  });
  res.redirect(url);
});

// Step 2: Handle Google OAuth callback
router.get(
  "/google/callback",
  requireSignIn,
  async (req: AuthenticatedRequest, res) => {
    const { code, state } = req.query;
    try {
      if (!state) {
        return res.status(400).json({ message: "Robot ID is required" });
      }

      const robotId = state;

      // Get access and refresh tokens
      if (typeof code !== "string") {
        return res.status(400).json({ message: "Invalid code" });
      }
      const { tokens } = await oauth2Client.getToken(code);
      oauth2Client.setCredentials(tokens);

      // Get user profile from Google
      const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
      const {
        data: { email },
      } = await oauth2.userinfo.get();

      if (!email) {
        return res.status(400).json({ message: "Email not found" });
      }

      if (!req.user) {
        return res.status(401).send({ error: "Unauthorized" });
      }

      // Get the currently authenticated user (from `requireSignIn`)
      let user = await User.findById(req.user.id);

      if (!user) {
        return res.status(400).json({ message: "User not found" });
      }

      let robot = await Robot.findOne({
        "recording_meta.id": robotId,
      });

      if (!robot) {
        return res.status(400).json({ message: "Robot not found" });
      }

      robot.google_sheet_email = email;
      robot.google_access_token = tokens.access_token ?? null;
      robot.google_refresh_token = tokens.refresh_token ?? null;
      await robot.save();

      capture("maxun-oss-google-sheet-integration-created", {
        user_id: user._id,
        robot_id: robot.recording_meta.id,
        created_at: new Date().toISOString(),
      });

      // List user's Google Sheets from their Google Drive
      const drive = google.drive({ version: "v3", auth: oauth2Client });
      const response = await drive.files.list({
        q: "mimeType='application/vnd.google-apps.spreadsheet'", // List only Google Sheets files
        fields: "files(id, name)", // Retrieve the ID and name of each file
      });

      const files = response.data.files || [];
      if (files.length === 0) {
        return res.status(404).json({ message: "No spreadsheets found." });
      }

      // Generate JWT token for session
      const jwtToken = jwt.sign(
        { id: user._id },
        process.env.JWT_SECRET as string
      );
      res.cookie("token", jwtToken, jwtCookieOptions);

      res.cookie("robot_auth_status", "success", oauthStatusCookieOptions); // 1-minute expiration
      res.cookie('robot_auth_robotId', robotId, oauthStatusCookieOptions);

      const baseUrl = process.env.PUBLIC_URL || "http://localhost:5173";
      const redirectUrl = `${baseUrl}/scrapers/`;

      res.redirect(redirectUrl);
    } catch (error: any) {
      res.status(500).json({ message: `Google OAuth error: ${error.message}` });
    }
  }
);

// Step 3: Get data from Google Sheets
router.post(
  "/gsheets/data",
  requireSignIn,
  async (req: AuthenticatedRequest, res) => {
    const { spreadsheetId, robotId } = req.body;
    if (!req.user) {
      return res.status(401).send({ error: "Unauthorized" });
    }
    const user = await User.findById(req.user.id).lean();

    if (!user) {
      return res.status(400).json({ message: "User not found" });
    }

    const robot = await Robot.findOne({
      "recording_meta.id": robotId,
    }).lean();

    if (!robot) {
      return res.status(400).json({ message: "Robot not found" });
    }

    // Set Google OAuth credentials
    oauth2Client.setCredentials({
      access_token: robot.google_access_token,
      refresh_token: robot.google_refresh_token,
    });

    const sheets = google.sheets({ version: "v4", auth: oauth2Client });

    try {
      // Fetch data from the spreadsheet (you can let the user choose a specific range too)
      const sheetData = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: "Sheet1!A1:D5", // Default range, could be dynamic based on user input
      });
      res.json(sheetData.data);
    } catch (error: any) {
      res
        .status(500)
        .json({ message: `Error accessing Google Sheets: ${error.message}` });
    }
  }
);

// Step 4: Get user's Google Sheets files (new route)
router.get("/gsheets/files", requireSignIn, async (req, res) => {
  try {
    const robotId = req.query.robotId;
    const robot = await Robot.findOne({
      "recording_meta.id": robotId,
    }).lean();

    if (!robot) {
      return res.status(400).json({ message: "Robot not found" });
    }

    oauth2Client.setCredentials({
      access_token: robot.google_access_token,
      refresh_token: robot.google_refresh_token,
    });

    // List user's Google Sheets files from their Google Drive
    const drive = google.drive({ version: "v3", auth: oauth2Client });
    const response = await drive.files.list({
      q: "mimeType='application/vnd.google-apps.spreadsheet'",
      fields: "files(id, name)",
    });

    const files = response.data.files || [];
    if (files.length === 0) {
      return res.status(404).json({ message: "No spreadsheets found." });
    }

    res.json(files);
  } catch (error: any) {
    console.log("Error fetching Google Sheets files:", error);
    res
      .status(500)
      .json({
        message: `Error retrieving Google Sheets files: ${error.message}`,
      });
  }
});

// Step 5: Update robot's google_sheet_id when a Google Sheet is selected
router.post("/gsheets/update", requireSignIn, async (req, res) => {
  const { spreadsheetId, spreadsheetName, robotId } = req.body;

  if (!spreadsheetId || !robotId) {
    return res
      .status(400)
      .json({ message: "Spreadsheet ID and Robot ID are required" });
  }

  try {
    let robot = await Robot.findOne({
      "recording_meta.id": robotId,
    });

    if (!robot) {
      return res.status(404).json({ message: "Robot not found" });
    }

    robot.google_sheet_id = spreadsheetId;
    robot.google_sheet_name = spreadsheetName;
    await robot.save();

    res.json({ message: "Robot updated with selected Google Sheet ID" });
  } catch (error: any) {
    res.status(500).json({ message: `Error updating robot: ${error.message}` });
  }
});

router.post(
  "/gsheets/remove",
  requireSignIn,
  async (req: AuthenticatedRequest, res) => {
    const { robotId } = req.body;
    if (!robotId) {
      return res.status(400).json({ message: "Robot ID is required" });
    }

    if (!req.user) {
      return res.status(401).send({ error: "Unauthorized" });
    }

    try {
      let robot = await Robot.findOne({
        "recording_meta.id": robotId,
      });

      if (!robot) {
        return res.status(404).json({ message: "Robot not found" });
      }

      robot.google_sheet_id = null;
      robot.google_sheet_name = null;
      robot.google_sheet_email = null;
      robot.google_access_token = null;
      robot.google_refresh_token = null;
      await robot.save();

      capture("maxun-oss-google-sheet-integration-removed", {
        user_id: req.user.id,
        robot_id: robotId,
        deleted_at: new Date().toISOString(),
      });

      res.json({ message: "Google Sheets integration removed successfully" });
    } catch (error: any) {
      res
        .status(500)
        .json({
          message: `Error removing Google Sheets integration: ${error.message}`,
        });
    }
  }
);


// Airtable OAuth Routes
router.get("/airtable", requireSignIn, (req: Request, res) => {
  const authenticatedReq = req as AuthenticatedRequest;
  const { robotId } = authenticatedReq.query;
  if (!robotId) {
    return res.status(400).json({ message: "Robot ID is required" });
  }

  // Generate PKCE codes
  const code_verifier = crypto.randomBytes(64).toString('base64url');
  const code_challenge = crypto.createHash('sha256')
    .update(code_verifier)
    .digest('base64url');

  // Store in session
  authenticatedReq.session.code_verifier = code_verifier;
  authenticatedReq.session.robotId = robotId.toString();

  const params = new URLSearchParams({
    client_id: process.env.AIRTABLE_CLIENT_ID!,
    redirect_uri: process.env.AIRTABLE_REDIRECT_URI!,
    response_type: 'code',
    state: robotId.toString(),
    scope: 'data.records:read data.records:write schema.bases:read schema.bases:write',
    code_challenge: code_challenge,
    code_challenge_method: 'S256'
  });

  res.redirect(`https://airtable.com/oauth2/v1/authorize?${params}`);
});

router.get("/airtable/callback", requireSignIn, async (req: Request, res) => {
  const authenticatedReq = req as AuthenticatedRequest;
  const baseUrl = process.env.PUBLIC_URL || "http://localhost:5173";

  try {
    const { code, state, error } = authenticatedReq.query;

    if (error) {
      return res.redirect(
        `${baseUrl}/scrapers/${state}/integrate?error=${encodeURIComponent(error.toString())}`
      );
    }

    if (!code || !state) {
      return res.status(400).json({ message: "Missing authorization code or state" });
    }

    // Verify session data
    if (!authenticatedReq.session?.code_verifier || authenticatedReq.session.robotId !== state.toString()) {
      return res.status(400).json({
        message: "Session expired - please restart the OAuth flow"
      });
    }

    // Exchange code for tokens
    const tokenResponse = await fetch("https://airtable.com/oauth2/v1/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: code.toString(),
        client_id: process.env.AIRTABLE_CLIENT_ID!,
        redirect_uri: process.env.AIRTABLE_REDIRECT_URI!,
        code_verifier: authenticatedReq.session.code_verifier
      }),
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.json();
      console.error('Token exchange failed:', errorData);
      return res.redirect(
        `${baseUrl}/scrapers/${state}/integrate?error=${encodeURIComponent(errorData.error_description || 'Authentication failed')}`
      );
    }

    const tokens = await tokenResponse.json();

    // Update robot with credentials
    const robot = await Robot.findOne({
      "recording_meta.id": req.session.robotId
    });

    if (!robot) {
      return res.status(404).json({ message: "Robot not found" });
    }

    robot.airtable_access_token = tokens.access_token;
    robot.airtable_refresh_token = tokens.refresh_token;
    await robot.save();

    res.cookie("airtable_auth_status", "success", oauthStatusCookieOptions); // 1-minute expiration

    res.cookie('robot_auth_robotId', req.session.robotId, oauthStatusCookieOptions);

    // Clear session data
    authenticatedReq.session.destroy((err) => {
      if (err) console.error('Session cleanup error:', err);
    });

    const redirectUrl = `${baseUrl}/scrapers/`;

    res.redirect(redirectUrl);
  } catch (error: any) {
    console.error('Airtable callback error:', error);
    res.redirect(
      `${baseUrl}/scrapers/${req.session.robotId}/integrate?error=${encodeURIComponent(error.message)}`
    );
  }
});

// Get Airtable bases
router.get("/airtable/bases", requireSignIn, async (req: Request, res) => {
  const authenticatedReq = req as AuthenticatedRequest;
  try {
    const { robotId } = authenticatedReq.query;
    if (!robotId) {
      return res.status(400).json({ message: "Robot ID is required" });
    }

    const robot = await Robot.findOne({
      "recording_meta.id": robotId.toString(),
    }).lean();

    if (!robot?.airtable_access_token) {
      return res.status(400).json({ message: "Robot not authenticated with Airtable" });
    }

    const response = await fetch('https://api.airtable.com/v0/meta/bases', {
      headers: {
        'Authorization': `Bearer ${robot.airtable_access_token}`
      }
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error.message || 'Failed to fetch bases');
    }

    const data = await response.json();
    res.json(data.bases.map((base: any) => ({
      id: base.id,
      name: base.name
    })));

  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

// Update robot with selected base
router.post("/airtable/update", requireSignIn, async (req: Request, res) => {
  const authenticatedReq = req as AuthenticatedRequest;
  const { baseId, robotId, baseName, tableName, tableId } = req.body;

  if (!baseId || !robotId) {
    return res.status(400).json({ message: "Base ID and Robot ID are required" });
  }

  try {
    const robot = await Robot.findOne({
      "recording_meta.id": robotId
    });

    if (!robot) {
      return res.status(404).json({ message: "Robot not found" });
    }

    robot.airtable_base_id = baseId;
    robot.airtable_table_name = tableName;
    robot.airtable_table_id = tableId;
    robot.airtable_base_name = baseName;
    await robot.save();

    capture("maxun-oss-airtable-integration-created", {
      user_id: authenticatedReq.user?.id,
      robot_id: robotId,
      created_at: new Date().toISOString(),
    });

    res.json({ message: "Airtable base updated successfully" });

  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

// Remove Airtable integration
router.post("/airtable/remove", requireSignIn, async (req: Request, res) => {
  const authenticatedReq = req as AuthenticatedRequest;
  const { robotId } = authenticatedReq.body;
  if (!robotId) {
    return res.status(400).json({ message: "Robot ID is required" });
  }

  try {
    const robot = await Robot.findOne({
      "recording_meta.id": robotId
    });

    if (!robot) {
      return res.status(404).json({ message: "Robot not found" });
    }

    robot.airtable_access_token = null;
    robot.airtable_refresh_token = null;
    robot.airtable_base_id = null;
    robot.airtable_base_name = null;
    robot.airtable_table_name = null;
    robot.airtable_table_id = null;
    await robot.save();

    capture("maxun-oss-airtable-integration-removed", {
      user_id: authenticatedReq.user?.id,
      robot_id: robotId,
      deleted_at: new Date().toISOString(),
    });

    res.json({ message: "Airtable integration removed successfully" });

  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});



// Fetch tables from an Airtable base
router.get("/airtable/tables", requireSignIn, async (req: Request, res) => {
  const authenticatedReq = req as AuthenticatedRequest;
  try {
    const { baseId, robotId } = authenticatedReq.query;

    if (!baseId || !robotId) {
      return res.status(400).json({ message: "Base ID and Robot ID are required" });
    }

    const robot = await Robot.findOne({
      "recording_meta.id": robotId.toString(),
    }).lean();

    if (!robot?.airtable_access_token) {
      return res.status(400).json({ message: "Robot not authenticated with Airtable" });
    }

    const response = await fetch(`https://api.airtable.com/v0/meta/bases/${baseId}/tables`, {
      headers: {
        'Authorization': `Bearer ${robot.airtable_access_token}`
      }
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error.message || 'Failed to fetch tables');
    }

    const data = await response.json();
    res.json(data.tables.map((table: any) => ({
      id: table.id,
      name: table.name,
      fields: table.fields
    })));

  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});


