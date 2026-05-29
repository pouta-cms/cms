import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GET } from '../../../src/pages/api/images/list';
import { env } from 'cloudflare:workers';
import * as auth from '../../../src/utils/auth';

describe('Images List API', () => {
  const sessionSecret = 'default-fallback-pouta-key-32-chars-minimum';

  const mockBucket = {
    list: vi.fn(),
  };

  beforeEach(() => {
    Object.assign(env, {
      SESSION_SECRET: sessionSecret,
      MEDIA_BUCKET: mockBucket,
      R2_PUBLIC_URL_PREFIX: 'https://r2.pouta.local',
    });
    vi.clearAllMocks();
    mockBucket.list.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── Auth & config guards ────────────────────────────────────────────────────

  it('returns 500 if SESSION_SECRET is missing', async () => {
    Object.assign(env, { SESSION_SECRET: '' });
    const context = {
      request: new Request('https://cms.pouta.local/api/images/list?repo_owner=owner&repo_name=repo'),
    } as any;

    const response = await GET(context);
    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.error).toBe('Internal server error.');
  });

  it('returns 401 if session cookie is missing or invalid', async () => {
    vi.spyOn(auth, 'verifySession').mockRejectedValue(new Error('Invalid session'));

    const context = {
      request: new Request('https://cms.pouta.local/api/images/list?repo_owner=owner&repo_name=repo'),
    } as any;

    const response = await GET(context);
    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.error).toContain('Unauthorized');
  });

  // ─── Query param validation ──────────────────────────────────────────────────

  it('returns 400 if repo_owner query param is missing', async () => {
    vi.spyOn(auth, 'verifySession').mockResolvedValue('github-token');

    const context = {
      request: new Request('https://cms.pouta.local/api/images/list?repo_name=repo'),
    } as any;

    const response = await GET(context);
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.error).toContain('repo_owner');
  });

  it('returns 400 if repo_name query param is missing', async () => {
    vi.spyOn(auth, 'verifySession').mockResolvedValue('github-token');

    const context = {
      request: new Request('https://cms.pouta.local/api/images/list?repo_owner=owner'),
    } as any;

    const response = await GET(context);
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.error).toContain('repo_name');
  });

  it('returns 400 if both repo_owner and repo_name are missing', async () => {
    vi.spyOn(auth, 'verifySession').mockResolvedValue('github-token');

    const context = {
      request: new Request('https://cms.pouta.local/api/images/list'),
    } as any;

    const response = await GET(context);
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.success).toBe(false);
  });

  // ─── Tenancy / collaborator guard ───────────────────────────────────────────

  it('returns 403 if user is not a collaborator on the target repository', async () => {
    vi.spyOn(auth, 'verifySession').mockResolvedValue('github-token');
    vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(false);

    const context = {
      request: new Request('https://cms.pouta.local/api/images/list?repo_owner=owner&repo_name=repo'),
    } as any;

    const response = await GET(context);
    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.error).toContain('Forbidden');
  });

  // ─── Infrastructure guards ───────────────────────────────────────────────────

  it('returns 500 if MEDIA_BUCKET binding is missing', async () => {
    Object.assign(env, { MEDIA_BUCKET: undefined });
    vi.spyOn(auth, 'verifySession').mockResolvedValue('github-token');
    vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);

    const context = {
      request: new Request('https://cms.pouta.local/api/images/list?repo_owner=owner&repo_name=repo'),
    } as any;

    const response = await GET(context);
    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.error).toContain('MEDIA_BUCKET');
  });

  it('returns 500 if R2_PUBLIC_URL_PREFIX env var is missing', async () => {
    Object.assign(env, { R2_PUBLIC_URL_PREFIX: '' });
    vi.spyOn(auth, 'verifySession').mockResolvedValue('github-token');
    vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);

    const context = {
      request: new Request('https://cms.pouta.local/api/images/list?repo_owner=owner&repo_name=repo'),
    } as any;

    const response = await GET(context);
    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.error).toContain('R2_PUBLIC_URL_PREFIX');
  });

  // ─── Happy path ──────────────────────────────────────────────────────────────

  it('returns 200 with an empty images array when the bucket prefix has no objects', async () => {
    vi.spyOn(auth, 'verifySession').mockResolvedValue('github-token');
    vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
    mockBucket.list.mockResolvedValue({ objects: [] });

    const context = {
      request: new Request('https://cms.pouta.local/api/images/list?repo_owner=owner&repo_name=repo'),
    } as any;

    const response = await GET(context);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.images).toEqual([]);
  });

  it('returns 200 with mapped image objects including key, url, size, uploaded, and name', async () => {
    vi.spyOn(auth, 'verifySession').mockResolvedValue('github-token');
    vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);

    const now = new Date('2024-06-01T12:00:00.000Z');
    mockBucket.list.mockResolvedValue({
      objects: [
        {
          key: 'uploads/owner/repo/abc123-photo.png',
          size: 4096,
          uploaded: now,
        },
      ],
    });

    const context = {
      request: new Request('https://cms.pouta.local/api/images/list?repo_owner=owner&repo_name=repo'),
    } as any;

    const response = await GET(context);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.images).toHaveLength(1);

    const image = data.images[0];
    expect(image.key).toBe('uploads/owner/repo/abc123-photo.png');
    expect(image.url).toBe('https://r2.pouta.local/uploads/owner/repo/abc123-photo.png');
    expect(image.size).toBe(4096);
    expect(image.name).toBe('abc123-photo.png');
  });

  it('URL-encodes special characters in the object key when building the public URL', async () => {
    vi.spyOn(auth, 'verifySession').mockResolvedValue('github-token');
    vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);

    mockBucket.list.mockResolvedValue({
      objects: [
        {
          key: 'uploads/owner/repo/my file (1).png',
          size: 512,
          uploaded: new Date(),
        },
      ],
    });

    const context = {
      request: new Request('https://cms.pouta.local/api/images/list?repo_owner=owner&repo_name=repo'),
    } as any;

    const response = await GET(context);
    const data = await response.json();
    expect(data.images[0].url).toContain('my%20file%20(1).png');
  });

  it('trims a trailing slash from R2_PUBLIC_URL_PREFIX before constructing URLs', async () => {
    Object.assign(env, { R2_PUBLIC_URL_PREFIX: 'https://r2.pouta.local/' });
    vi.spyOn(auth, 'verifySession').mockResolvedValue('github-token');
    vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);

    mockBucket.list.mockResolvedValue({
      objects: [
        { key: 'uploads/owner/repo/image.png', size: 100, uploaded: new Date() },
      ],
    });

    const context = {
      request: new Request('https://cms.pouta.local/api/images/list?repo_owner=owner&repo_name=repo'),
    } as any;

    const response = await GET(context);
    const data = await response.json();
    // Should not have a double-slash between prefix and key
    expect(data.images[0].url).not.toContain('//uploads');
    expect(data.images[0].url).toMatch(/^https:\/\/r2\.pouta\.local\/uploads\//);
  });

  it('sorts images by upload date descending (newest first)', async () => {
    vi.spyOn(auth, 'verifySession').mockResolvedValue('github-token');
    vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);

    mockBucket.list.mockResolvedValue({
      objects: [
        { key: 'uploads/owner/repo/old.png', size: 100, uploaded: new Date('2024-01-01') },
        { key: 'uploads/owner/repo/new.png', size: 200, uploaded: new Date('2024-06-01') },
        { key: 'uploads/owner/repo/mid.png', size: 150, uploaded: new Date('2024-03-01') },
      ],
    });

    const context = {
      request: new Request('https://cms.pouta.local/api/images/list?repo_owner=owner&repo_name=repo'),
    } as any;

    const response = await GET(context);
    const data = await response.json();
    expect(data.images[0].name).toBe('new.png');
    expect(data.images[1].name).toBe('mid.png');
    expect(data.images[2].name).toBe('old.png');
  });

  it('falls back to object key as name when the key has no path segments or ends with a slash', async () => {
    vi.spyOn(auth, 'verifySession').mockResolvedValue('github-token');
    vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);

    const weirdKey1 = 'rootlevelobject';
    const weirdKey2 = 'uploads/owner/repo/';
    mockBucket.list.mockResolvedValue({
      objects: [
        { key: weirdKey1, size: 64, uploaded: new Date('2024-01-02') },
        { key: weirdKey2, size: 64, uploaded: new Date('2024-01-01') },
      ],
    });

    const context = {
      request: new Request('https://cms.pouta.local/api/images/list?repo_owner=owner&repo_name=repo'),
    } as any;

    const response = await GET(context);
    const data = await response.json();
    expect(data.images[0].name).toBe(weirdKey1);
    expect(data.images[1].name).toBe(weirdKey2);
  });

  it('handles objects with a null/undefined uploaded date without crashing (treated as epoch 0)', async () => {
    vi.spyOn(auth, 'verifySession').mockResolvedValue('github-token');
    vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);

    mockBucket.list.mockResolvedValue({
      objects: [
        { key: 'uploads/owner/repo/no-date.png', size: 50, uploaded: null },
        { key: 'uploads/owner/repo/dated.png', size: 50, uploaded: new Date('2024-01-01') },
      ],
    });

    const context = {
      request: new Request('https://cms.pouta.local/api/images/list?repo_owner=owner&repo_name=repo'),
    } as any;

    const response = await GET(context);
    expect(response.status).toBe(200);
    const data = await response.json();
    // 'dated.png' should sort before 'no-date.png'
    expect(data.images[0].name).toBe('dated.png');
    expect(data.images[1].name).toBe('no-date.png');
  });

  it('handles listed.objects being undefined/missing without crashing', async () => {
    vi.spyOn(auth, 'verifySession').mockResolvedValue('github-token');
    vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
    mockBucket.list.mockResolvedValue({}); // objects property is missing

    const context = {
      request: new Request('https://cms.pouta.local/api/images/list?repo_owner=owner&repo_name=repo'),
    } as any;

    const response = await GET(context);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.images).toEqual([]);
  });

  it('comprehensively tests all uploaded date branch sorting combinations', async () => {
    vi.spyOn(auth, 'verifySession').mockResolvedValue('github-token');
    vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);

    mockBucket.list.mockResolvedValue({
      objects: [
        { key: 'uploads/owner/repo/no-date1.png', size: 50, uploaded: null },
        { key: 'uploads/owner/repo/dated1.png', size: 50, uploaded: new Date('2024-01-01') },
        { key: 'uploads/owner/repo/no-date2.png', size: 50, uploaded: undefined },
        { key: 'uploads/owner/repo/dated2.png', size: 50, uploaded: new Date('2024-06-01') },
      ],
    });

    const context = {
      request: new Request('https://cms.pouta.local/api/images/list?repo_owner=owner&repo_name=repo'),
    } as any;

    const response = await GET(context);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.images[0].name).toBe('dated2.png');
    expect(data.images[1].name).toBe('dated1.png');
    expect(data.images[2].name).toBe('no-date1.png');
    expect(data.images[3].name).toBe('no-date2.png');
  });


  it('passes the correct repo-scoped prefix to bucket.list', async () => {
    vi.spyOn(auth, 'verifySession').mockResolvedValue('github-token');
    vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
    mockBucket.list.mockResolvedValue({ objects: [] });

    const context = {
      request: new Request('https://cms.pouta.local/api/images/list?repo_owner=myorg&repo_name=myrepo'),
    } as any;

    await GET(context);
    expect(mockBucket.list).toHaveBeenCalledWith({
      prefix: 'uploads/myorg/myrepo/',
      limit: 500,
    });
  });

  it('returns 500 if an unexpected error is thrown inside the handler', async () => {
    vi.spyOn(auth, 'verifySession').mockResolvedValue('github-token');
    vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
    mockBucket.list.mockRejectedValue(new Error('Unexpected R2 failure'));

    const context = {
      request: new Request('https://cms.pouta.local/api/images/list?repo_owner=owner&repo_name=repo'),
    } as any;

    const response = await GET(context);
    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.error).toBe('Internal server error.');
  });
});
