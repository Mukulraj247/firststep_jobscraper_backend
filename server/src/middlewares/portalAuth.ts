import { NextFunction, Response } from 'express';
import PortalUser, { IPortalUser } from '../models/PortalUser';
import {
  Auth0Request,
  requireAuth0AccessToken,
} from './auth0';
import {
  extractSubFromAuth0Payload,
  extractEmailFromAuth0Payload,
} from '../services/scoutxAuth0';

export type PortalRequest = Auth0Request & {
  portalUser?: IPortalUser;
  auth0Sub?: string;
};

/**
 * Validate Auth0 Bearer token and attach the matching PortalUser.
 * Portal APIs are bearer-authed (no ScoutX JWT cookie).
 */
export const requirePortalUser = (
  req: PortalRequest,
  res: Response,
  next: NextFunction
) => {
  requireAuth0AccessToken(req, res, async (err?: unknown) => {
    if (err) return; // requireAuth0AccessToken already sent the response

    try {
      const payload = (req.auth?.payload || {}) as Record<string, unknown>;
      const auth0Sub = extractSubFromAuth0Payload(payload);
      if (!auth0Sub) {
        return res.status(401).json({
          error: 'Auth0 token missing subject',
          code: 'portal.missing_sub',
        });
      }

      let portalUser = await PortalUser.findOne({ auth0Sub });
      if (!portalUser) {
        // Soft-create so first portal API call after exchange still works
        // if the client races ahead of the exchange upsert.
        const email = extractEmailFromAuth0Payload(payload);
        if (!email) {
          return res.status(404).json({
            error: 'Portal profile not found. Sign in again.',
            code: 'portal.user_not_found',
          });
        }
        portalUser = await PortalUser.findOneAndUpdate(
          { auth0Sub },
          {
            $setOnInsert: {
              auth0Sub,
              email,
              name: typeof payload.name === 'string' ? payload.name : null,
              scoutxRoles: ['ScoutX_User'],
            },
          },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
      }

      if (!portalUser) {
        return res.status(404).json({
          error: 'Portal profile not found',
          code: 'portal.user_not_found',
        });
      }

      req.auth0Sub = auth0Sub;
      req.portalUser = portalUser;
      return next();
    } catch (error) {
      console.error('requirePortalUser failed:', error);
      return res.status(503).json({
        error: 'Portal authentication temporarily unavailable',
        code: 'portal.auth_unavailable',
      });
    }
  });
};
