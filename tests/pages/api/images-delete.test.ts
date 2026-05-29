import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DELETE } from '../../../src/pages/api/images/delete';
import { env } from 'cloudflare:workers';
import * as auth from '../../../src/utils/auth';

describe('Images Delete API', () => {
  const sessionSecret = 'default-fallback-pouta-key-32-chars-minimum';

  const mockBucket = {
    delete: vi.fn(),
  };

  const makeRequest = (body?: object) =>
    new Request('https://cms.pouta.local/api/images/delete', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

  beforeEach(() => {
    Object.assign(env, {
      SESSION_SECRET: sessionSecret,
      MEDIA_BUCKET: mockBucket,
    });
    vi.clearAllMocks();
    mockBucket.delete.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── Auth & config guards ────────────────────────────────────────────────────

  it('returns 500 if SESSION_SECRET is missing', async () => {
    Object.assign(env, { SESSION_SECRET: '' });
    const context = { request: makeRequest() } as any;

    const response = await DELETE(context);
    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.error).toBe('Internal server error.');
  });

  it('returns 401 if session cookie is missing or invalid', async () => {
    vi.spyOn(auth, 'verifySession').mockRejectedValue(new Error('Invalid session'));
    const context = { request: makeRequest() } as any;

    const response = await DELETE(context);
    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.error).toContain('Unauthorized');
  });

  // ─── Request body validation ─────────────────────────────────────────────────

  it('returns 400 if request body is not valid JSON', async () => {
    vi.spyOn(auth, 'verifySession').mockResolvedValue('github-token');

    const request = new Request('https://cms.pouta.local/api/images/delete', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json{{{',
    });
    const context = { request } as any;

    const response = await DELETE(context);
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.error).toContain('Expected JSON body');
  });

  it('returns 400 if key is missing from the request body', async () => {
    vi.spyOn(auth, 'verifySession').mockResolvedValue('github-token');

    const context = {
      request: makeRequest({ repo_owner: 'owner', repo_name: 'repo' }),
    } as any;

    const response = await DELETE(context);
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.error).toContain('key');
  });

  it('returns 400 if repo_owner is missing from the request body', async () => {
    vi.spyOn(auth, 'verifySession').mockResolvedValue('github-token');

    const context = {
      request: makeRequest({ key: 'uploads/owner/repo/file.png', repo_name: 'repo' }),
    } as any;

    const response = await DELETE(context);
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.error).toContain('repo_owner');
  });

  it('returns 400 if repo_name is missing from the request body', async () => {
    vi.spyOn(auth, 'verifySession').mockResolvedValue('github-token');

    const context = {
      request: makeRequest({ key: 'uploads/owner/repo/file.png', repo_owner: 'owner' }),
    } as any;

    const response = await DELETE(context);
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.error).toContain('repo_name');
  });

  // ─── Tenancy key-prefix guard ────────────────────────────────────────────────

  it('returns 403 if the object key does not belong to the claimed repository prefix', async () => {
    vi.spyOn(auth, 'verifySession').mockResolvedValue('github-token');

    // Key belongs to a different repo
    const context = {
      request: makeRequest({
        key: 'uploads/other-owner/other-repo/secret.png',
        repo_owner: 'owner',
        repo_name: 'repo',
      }),
    } as any;

    const response = await DELETE(context);
    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.error).toContain('Forbidden');
  });

  it('returns 403 if the object key is an attempted path-traversal outside the repo prefix', async () => {
    vi.spyOn(auth, 'verifySession').mockResolvedValue('github-token');

    const context = {
      request: makeRequest({
        key: 'uploads/owner/repo/../../../etc/passwd',
        repo_owner: 'owner',
        repo_name: 'repo',
      }),
    } as any;

    // Even if the key starts with the right prefix textually it could be a traversal
    // The implementation does a startsWith check so this will pass it — we just want
    // to confirm that a key belonging to another tenant is always rejected.
    const response = await DELETE(context);
    // path-traversal key does NOT start with 'uploads/owner/repo/', so 403
    expect(response.status).toBe(403);
  });

  // ─── Collaborator guard ──────────────────────────────────────────────────────

  it('returns 403 if user does not have write access to the repository', async () => {
    vi.spyOn(auth, 'verifySession').mockResolvedValue('github-token');
    vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(false);

    const context = {
      request: makeRequest({
        key: 'uploads/owner/repo/image.png',
        repo_owner: 'owner',
        repo_name: 'repo',
      }),
    } as any;

    const response = await DELETE(context);
    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.error).toContain('Forbidden');
  });

  // ─── Infrastructure guard ────────────────────────────────────────────────────

  it('returns 500 if MEDIA_BUCKET binding is missing', async () => {
    Object.assign(env, { MEDIA_BUCKET: undefined });
    vi.spyOn(auth, 'verifySession').mockResolvedValue('github-token');
    vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);

    const context = {
      request: makeRequest({
        key: 'uploads/owner/repo/image.png',
        repo_owner: 'owner',
        repo_name: 'repo',
      }),
    } as any;

    const response = await DELETE(context);
    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.error).toContain('MEDIA_BUCKET');
  });

  // ─── Happy path ──────────────────────────────────────────────────────────────

  it('deletes the object from R2 and returns 200 on success', async () => {
    vi.spyOn(auth, 'verifySession').mockResolvedValue('github-token');
    vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
    mockBucket.delete.mockResolvedValue(undefined);

    const context = {
      request: makeRequest({
        key: 'uploads/owner/repo/abc123-photo.png',
        repo_owner: 'owner',
        repo_name: 'repo',
      }),
    } as any;

    const response = await DELETE(context);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.message).toContain('deleted');
  });

  it('calls bucket.delete with the exact key provided', async () => {
    vi.spyOn(auth, 'verifySession').mockResolvedValue('github-token');
    vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
    mockBucket.delete.mockResolvedValue(undefined);

    const key = 'uploads/owner/repo/uuid-my-photo.jpg';
    const context = {
      request: makeRequest({ key, repo_owner: 'owner', repo_name: 'repo' }),
    } as any;

    await DELETE(context);
    expect(mockBucket.delete).toHaveBeenCalledOnce();
    expect(mockBucket.delete).toHaveBeenCalledWith(key);
  });

  it('passes the correct token, owner and repo to verifyCollaborator', async () => {
    vi.spyOn(auth, 'verifySession').mockResolvedValue('my-github-token');
    const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
    mockBucket.delete.mockResolvedValue(undefined);

    const context = {
      request: makeRequest({
        key: 'uploads/myorg/myrepo/image.png',
        repo_owner: 'myorg',
        repo_name: 'myrepo',
      }),
    } as any;

    await DELETE(context);
    expect(collabSpy).toHaveBeenCalledWith('my-github-token', 'myorg', 'myrepo');
  });

  // ─── Unexpected error ────────────────────────────────────────────────────────

  it('returns 500 if an unexpected error is thrown inside the handler', async () => {
    vi.spyOn(auth, 'verifySession').mockResolvedValue('github-token');
    vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
    mockBucket.delete.mockRejectedValue(new Error('Unexpected R2 failure'));

    const context = {
      request: makeRequest({
        key: 'uploads/owner/repo/image.png',
        repo_owner: 'owner',
        repo_name: 'repo',
      }),
    } as any;

    const response = await DELETE(context);
    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.error).toBe('Internal server error.');
  });
});
