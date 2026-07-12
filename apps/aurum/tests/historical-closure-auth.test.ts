import { beforeEach, describe, expect, it, vi } from 'vitest';

const verifyIdToken = vi.fn();

vi.mock('../api/_firestoreAdmin.js', () => ({
  getAdminAuth: () => ({ verifyIdToken }),
}));

import { requireHistoricalAdmin } from '../api/admin/_historicalAuth.js';

const response = () => {
  const result = {
    statusCode: 0,
    payload: null as unknown,
    status: vi.fn((statusCode: number) => {
      result.statusCode = statusCode;
      return result;
    }),
    json: vi.fn((payload: unknown) => {
      result.payload = payload;
      return result;
    }),
  };
  return result;
};

const request = (token = 'valid', uid = 'owner-uid') => ({
  headers: token ? { authorization: `Bearer ${token}` } : {},
  body: { uid },
  query: {},
});

describe('historical closure server authorization', () => {
  beforeEach(() => {
    verifyIdToken.mockReset();
    verifyIdToken.mockResolvedValue({
      uid: 'owner-uid',
      email: 'diegorp.1978@gmail.com',
      email_verified: true,
    });
  });

  it('blocks a missing Firebase ID token', async () => {
    const res = response();
    expect(await requireHistoricalAdmin(request('') as never, res as never)).toBeNull();
    expect(res.statusCode).toBe(401);
    expect(verifyIdToken).not.toHaveBeenCalled();
  });

  it('blocks an invalid or revoked Firebase ID token', async () => {
    verifyIdToken.mockRejectedValue(new Error('revoked'));
    const res = response();
    expect(await requireHistoricalAdmin(request() as never, res as never)).toBeNull();
    expect(res.statusCode).toBe(401);
    expect(verifyIdToken).toHaveBeenCalledWith('valid', true);
  });

  it('blocks access to a different UID', async () => {
    const res = response();
    expect(await requireHistoricalAdmin(request('valid', 'other-uid') as never, res as never)).toBeNull();
    expect(res.statusCode).toBe(403);
  });

  it('blocks a different or unverified token email', async () => {
    verifyIdToken.mockResolvedValue({ uid: 'owner-uid', email: 'other@example.com', email_verified: true });
    let res = response();
    expect(await requireHistoricalAdmin(request() as never, res as never)).toBeNull();
    expect(res.statusCode).toBe(403);

    verifyIdToken.mockResolvedValue({ uid: 'owner-uid', email: 'diegorp.1978@gmail.com', email_verified: false });
    res = response();
    expect(await requireHistoricalAdmin(request() as never, res as never)).toBeNull();
    expect(res.statusCode).toBe(403);
  });

  it('allows only the matching verified administrative identity', async () => {
    const res = response();
    await expect(requireHistoricalAdmin(request() as never, res as never)).resolves.toEqual({
      uid: 'owner-uid',
      email: 'diegorp.1978@gmail.com',
    });
    expect(res.status).not.toHaveBeenCalled();
  });
});
