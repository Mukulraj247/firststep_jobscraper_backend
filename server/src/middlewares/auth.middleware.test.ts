import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

vi.mock('../models/User', () => ({
  default: { findOne: vi.fn() },
}));

import User from '../models/User';
import { requireSignInOrApiKey } from './auth';

describe('requireSignInOrApiKey', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sets req.user and calls next when x-api-key matches a user', async () => {
    vi.mocked(User.findOne).mockResolvedValue({ id: 42 } as Awaited<ReturnType<typeof User.findOne>>);

    const next = vi.fn();
    const req = {
      headers: { 'x-api-key': 'secret-key' },
      cookies: {},
    } as unknown as Request;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      sendStatus: vi.fn(),
    } as unknown as Response;

    await requireSignInOrApiKey(req, res, next);

    expect(User.findOne).toHaveBeenCalledWith({ api_key: 'secret-key' });
    expect(next).toHaveBeenCalledTimes(1);
    expect((req as { user?: { id: number } }).user).toEqual({ id: 42 });
  });

  it('returns 403 when x-api-key is present but invalid', async () => {
    vi.mocked(User.findOne).mockResolvedValue(null);

    const next = vi.fn();
    const req = {
      headers: { 'x-api-key': 'wrong' },
      cookies: {},
    } as unknown as Request;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as unknown as Response;

    await requireSignInOrApiKey(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
