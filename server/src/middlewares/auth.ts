import { Request, Response } from "express";
import { verify, JwtPayload, sign } from "jsonwebtoken";
import crypto from "crypto";
import User from "../models/User";

interface UserRequest extends Request {
    user?: JwtPayload | string | { id: number };
    isAdmin?: boolean;
}

export const requireSignIn = (req: UserRequest, res: Response, next: any) => {
    const token = req.cookies && req.cookies.token ? req.cookies.token : null;

    if (token === null) return res.sendStatus(401);

    const secret = process.env.JWT_SECRET;
    if (!secret) {
        return res.sendStatus(500); // Internal Server Error if secret is not defined
    }

    verify(token, secret, (err: any, user: any) => {
        if (err) {
            console.log('JWT verification error:', err);
            return res.sendStatus(403);
        }
        // Normalize payload key
        if (user.userId && !user.id) {
            user.id = user.userId;
            delete user.userId; // temporary: del the old key for clarity
        }
        req.user = user;
        next();
    });
};

/**
 * For routes used by the browser app (JWT cookie) and the Chrome extension (`x-api-key`).
 * API key is checked first when the header is present; otherwise session cookie auth runs.
 */
export const requireSignInOrApiKey = async (req: UserRequest, res: Response, next: any) => {
    const rawKey = req.headers["x-api-key"];
    const apiKey = Array.isArray(rawKey) ? rawKey[0] : rawKey;

    if (apiKey && String(apiKey).trim()) {
        try {
            const user = await User.findOne({ api_key: String(apiKey).trim() });
            if (!user) {
                return res.status(403).json({ error: "Invalid API key" });
            }
            req.user = { id: user.id };
            return next();
        } catch (error) {
            console.error("API key authentication failed:", error);
            return res.status(503).json({ error: "Authentication service temporarily unavailable" });
        }
    }

    return requireSignIn(req, res, next);
};

const ADMIN_COOKIE = "admin_token";
const ADMIN_TOKEN_TTL_SEC = 60 * 60 * 12; // 12 hours

export function getAdminPasswordConfigured(): boolean {
    return !!(process.env.ADMIN_PASSWORD && String(process.env.ADMIN_PASSWORD).trim());
}

export function timingSafeEqualString(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) {
        // Still compare to keep timing roughly constant for wrong lengths.
        crypto.timingSafeEqual(bufA, Buffer.alloc(bufA.length));
        return false;
    }
    return crypto.timingSafeEqual(bufA, bufB);
}

export function signAdminToken(): string | null {
    const secret = process.env.JWT_SECRET;
    if (!secret) return null;
    return sign({ role: "admin", typ: "admin" }, secret, { expiresIn: ADMIN_TOKEN_TTL_SEC });
}

export function adminCookieOptions(isProduction: boolean, sameSite: "none" | "lax") {
    return {
        httpOnly: true,
        secure: isProduction,
        sameSite,
        path: "/",
        maxAge: ADMIN_TOKEN_TTL_SEC * 1000,
    };
}

export { ADMIN_COOKIE };

/**
 * Gate for `/api/admin/*` (except login). Uses `admin_token` cookie signed with JWT_SECRET.
 * Independent of normal user login so scout accounts stay scoped to their own runs.
 */
export const requireAdmin = (req: UserRequest, res: Response, next: any) => {
    if (!getAdminPasswordConfigured()) {
        return res.status(503).json({
            error: "Admin gate is not configured. Set ADMIN_PASSWORD on the server.",
        });
    }

    const token =
        (req.cookies && req.cookies[ADMIN_COOKIE]) ||
        (typeof req.headers["x-admin-token"] === "string" ? req.headers["x-admin-token"] : null);

    if (!token) {
        return res.status(401).json({ error: "Admin authentication required" });
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
        return res.status(500).json({ error: "Server misconfigured" });
    }

    verify(token, secret, (err: any, payload: any) => {
        if (err || !payload || payload.role !== "admin" || payload.typ !== "admin") {
            return res.status(403).json({ error: "Invalid or expired admin session" });
        }
        req.isAdmin = true;
        next();
    });
};
