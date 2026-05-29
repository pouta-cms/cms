import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { POST as uploadPOST } from '../../../src/pages/api/images/upload';
import { env } from 'cloudflare:workers';
import * as auth from '../../../src/utils/auth';

describe('Images Upload API', () => {
  const sessionSecret = 'default-fallback-pouta-key-32-chars-minimum';

  const mockDb = {
    prepare: vi.fn().mockReturnThis(),
    bind: vi.fn().mockReturnThis(),
    first: vi.fn(),
  };

  const mockBucket = {
    put: vi.fn(),
  };

  const mockAi = {
    run: vi.fn(),
  };

  beforeEach(() => {
    Object.assign(env, {
      SESSION_SECRET: sessionSecret,
      PAYWALL_ENABLED: 'true',
      DB: mockDb,
      MEDIA_BUCKET: mockBucket,
      R2_PUBLIC_URL_PREFIX: 'https://r2.pouta.local',
      AI: mockAi,
    });
    vi.clearAllMocks();
    mockDb.prepare.mockClear();
    mockDb.bind.mockClear();
    mockDb.first.mockReset();
    mockBucket.put.mockReset();
    mockAi.run.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 500 if SESSION_SECRET is missing', async () => {
    Object.assign(env, { SESSION_SECRET: '' });
    const context = { request: new Request('https://cms.pouta.local/api/images/upload', { method: 'POST' }) } as any;

    const response = await uploadPOST(context);
    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.success).toBe(false);
  });

  it('returns 401 if session token is invalid', async () => {
    const verifySpy = vi.spyOn(auth, 'verifySession').mockRejectedValue(new Error('Session invalid'));
    const context = { request: new Request('https://cms.pouta.local/api/images/upload', { method: 'POST' }) } as any;

    const response = await uploadPOST(context);
    expect(response.status).toBe(401);

    verifySpy.mockRestore();
  });

  it('returns 400 if multipart form parsing fails', async () => {
    const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
    
    // Create request with invalid form data
    const request = new Request('https://cms.pouta.local/api/images/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'multipart/form-data; boundary=invalid' },
      body: 'invalid body',
    });
    const context = { request } as any;

    const response = await uploadPOST(context);
    expect(response.status).toBe(400);

    verifySpy.mockRestore();
  });

  it('returns 400 if required form fields are missing', async () => {
    const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
    
    const formData = new FormData();
    formData.append('repo_owner', 'owner');
    // missing file and repo_name

    const request = new Request('https://cms.pouta.local/api/images/upload', {
      method: 'POST',
      body: formData,
    });
    const context = { request } as any;

    const response = await uploadPOST(context);
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('Missing required parameters');

    verifySpy.mockRestore();
  });

  it('returns 403 if user does not have write access to repository', async () => {
    const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
    const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(false);

    const formData = new FormData();
    formData.append('file', new File(['test'], 'image.png', { type: 'image/png' }));
    formData.append('repo_owner', 'owner');
    formData.append('repo_name', 'repo');

    const request = new Request('https://cms.pouta.local/api/images/upload', {
      method: 'POST',
      body: formData,
    });
    const context = { request } as any;

    const response = await uploadPOST(context);
    expect(response.status).toBe(403);

    verifySpy.mockRestore();
    collabSpy.mockRestore();
  });

  it('returns 402 if premium storage paywall is active and user is not subscribed', async () => {
    const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
    const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);

    mockDb.first.mockResolvedValueOnce(null); // not subscribed

    const formData = new FormData();
    formData.append('file', new File(['test'], 'image.png', { type: 'image/png' }));
    formData.append('repo_owner', 'owner');
    formData.append('repo_name', 'repo');

    const request = new Request('https://cms.pouta.local/api/images/upload', {
      method: 'POST',
      body: formData,
    });
    const context = { request } as any;

    const response = await uploadPOST(context);
    expect(response.status).toBe(402);
    const data = await response.json();
    expect(data.error).toBe('PAYWALL_REQUIRED');

    verifySpy.mockRestore();
    collabSpy.mockRestore();
  });

  it('returns 500 if subscription database query fails during upload', async () => {
    const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
    const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);

    mockDb.first.mockRejectedValueOnce(new Error('D1 error'));

    const formData = new FormData();
    formData.append('file', new File(['test'], 'image.png', { type: 'image/png' }));
    formData.append('repo_owner', 'owner');
    formData.append('repo_name', 'repo');

    const request = new Request('https://cms.pouta.local/api/images/upload', {
      method: 'POST',
      body: formData,
    });
    const context = { request } as any;

    const response = await uploadPOST(context);
    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBe('SUBSCRIPTION_CHECK_FAILED');

    verifySpy.mockRestore();
    collabSpy.mockRestore();
  });

  it('returns 400 if image format or MIME type is forbidden', async () => {
    const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
    const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);

    mockDb.first.mockResolvedValueOnce({ status: 'active', expires_at: 9999999999 });

    const formData = new FormData();
    formData.append('file', new File(['test'], 'malicious.exe', { type: 'application/octet-stream' }));
    formData.append('repo_owner', 'owner');
    formData.append('repo_name', 'repo');

    const request = new Request('https://cms.pouta.local/api/images/upload', {
      method: 'POST',
      body: formData,
    });
    const context = { request } as any;

    const response = await uploadPOST(context);
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('Forbidden format');

    verifySpy.mockRestore();
    collabSpy.mockRestore();
  });

  it('returns 400 if file size exceeds maximum limit of 5MB', async () => {
    const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
    const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);

    mockDb.first.mockResolvedValueOnce({ status: 'active', expires_at: 9999999999 });

    // Create a 6MB dummy file
    const largeFile = new File([new Uint8Array(6 * 1024 * 1024)], 'huge.png', { type: 'image/png' });

    const formData = new FormData();
    formData.append('file', largeFile);
    formData.append('repo_owner', 'owner');
    formData.append('repo_name', 'repo');

    const request = new Request('https://cms.pouta.local/api/images/upload', {
      method: 'POST',
      body: formData,
    });
    const context = { request } as any;

    const response = await uploadPOST(context);
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('File size exceeds');

    verifySpy.mockRestore();
    collabSpy.mockRestore();
  });

  it('returns 500 if MEDIA_BUCKET binding is missing', async () => {
    Object.assign(env, { MEDIA_BUCKET: undefined });
    const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
    const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
    mockDb.first.mockResolvedValueOnce({ status: 'active', expires_at: 9999999999 });

    const formData = new FormData();
    formData.append('file', new File(['test'], 'image.png', { type: 'image/png' }));
    formData.append('repo_owner', 'owner');
    formData.append('repo_name', 'repo');

    const request = new Request('https://cms.pouta.local/api/images/upload', {
      method: 'POST',
      body: formData,
    });
    const context = { request } as any;

    const response = await uploadPOST(context);
    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toContain('bucket binding');

    verifySpy.mockRestore();
    collabSpy.mockRestore();
  });

  it('returns 500 if R2_PUBLIC_URL_PREFIX is missing', async () => {
    Object.assign(env, { R2_PUBLIC_URL_PREFIX: '' });
    const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
    const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
    mockDb.first.mockResolvedValueOnce({ status: 'active', expires_at: 9999999999 });

    const formData = new FormData();
    formData.append('file', new File(['test'], 'image.png', { type: 'image/png' }));
    formData.append('repo_owner', 'owner');
    formData.append('repo_name', 'repo');

    const request = new Request('https://cms.pouta.local/api/images/upload', {
      method: 'POST',
      body: formData,
    });
    const context = { request } as any;

    const response = await uploadPOST(context);
    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toContain('R2_PUBLIC_URL_PREFIX');

    verifySpy.mockRestore();
    collabSpy.mockRestore();
  });

  it('uploads file to R2 successfully and automatically generates alt-text via AI', async () => {
    const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
    const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
    mockDb.first.mockResolvedValueOnce({ status: 'active', expires_at: 9999999999 });

    // Mock bucket write
    mockBucket.put.mockResolvedValueOnce(undefined);

    // Mock AI Alt Text response (Llama 3.2 Vision)
    mockAi.run.mockResolvedValueOnce({
      description: 'A beautiful workspace image',
    });

    const formData = new FormData();
    formData.append('file', new File([new Uint8Array([1, 2, 3])], 'custom-workspace-photo.png', { type: 'image/png' }));
    formData.append('repo_owner', 'owner');
    formData.append('repo_name', 'repo');

    const request = new Request('https://cms.pouta.local/api/images/upload', {
      method: 'POST',
      body: formData,
    });
    const context = { request } as any;

    const response = await uploadPOST(context);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.url).toContain('https://r2.pouta.local/uploads/owner/repo');
    expect(data.altText).toBe('A beautiful workspace image');

    verifySpy.mockRestore();
    collabSpy.mockRestore();
  });

  it('uploads file to R2 successfully and falls back to LLaVA if Llama 3.2 Vision fails', async () => {
    const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
    const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
    mockDb.first.mockResolvedValueOnce({ status: 'active', expires_at: 9999999999 });

    mockBucket.put.mockResolvedValueOnce(undefined);

    // Mock AI fail on Llama and success on LLaVA
    mockAi.run
      .mockRejectedValueOnce(new Error('Llama model overload'))
      .mockResolvedValueOnce({ response: 'LLaVA workspace image' });

    const formData = new FormData();
    formData.append('file', new File([new Uint8Array([1, 2, 3])], 'custom-workspace-photo.png', { type: 'image/png' }));
    formData.append('repo_owner', 'owner');
    formData.append('repo_name', 'repo');

    const request = new Request('https://cms.pouta.local/api/images/upload', {
      method: 'POST',
      body: formData,
    });
    const context = { request } as any;

    const response = await uploadPOST(context);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.altText).toBe('LLaVA workspace image');

    verifySpy.mockRestore();
    collabSpy.mockRestore();
  });

  it('uploads file to R2 successfully and falls back to filename-based alt-text if AI fails completely', async () => {
    const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
    const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
    mockDb.first.mockResolvedValueOnce({ status: 'active', expires_at: 9999999999 });

    mockBucket.put.mockResolvedValueOnce(undefined);

    // Mock AI failing completely
    mockAi.run.mockRejectedValue(new Error('AI Service completely offline'));

    const formData = new FormData();
    formData.append('file', new File([new Uint8Array([1, 2, 3])], 'my_sunset-beach-photo.png', { type: 'image/png' }));
    formData.append('repo_owner', 'owner');
    formData.append('repo_name', 'repo');

    const request = new Request('https://cms.pouta.local/api/images/upload', {
      method: 'POST',
      body: formData,
    });
    const context = { request } as any;

    const response = await uploadPOST(context);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.altText).toBe('my sunset beach photo');

    verifySpy.mockRestore();
    collabSpy.mockRestore();
  });

  it('strips enclosing single quotes from generated alt-text', async () => {
    const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
    const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
    mockDb.first.mockResolvedValue({ status: 'active', expires_at: 9999999999 });

    mockBucket.put.mockResolvedValueOnce(undefined);
    mockAi.run.mockResolvedValueOnce({ description: "'A single quoted altText'" });

    const formData = new FormData();
    formData.append('file', new File(['test'], 'image.png', { type: 'image/png' }));
    formData.append('repo_owner', 'owner');
    formData.append('repo_name', 'repo');

    const context = { request: new Request('https://cms.pouta.local/api/images/upload', { method: 'POST', body: formData }) } as any;
    const response = await uploadPOST(context);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.altText).toBe('A single quoted altText');

    verifySpy.mockRestore();
    collabSpy.mockRestore();
  });

  it('falls back to default alt text uploaded image if file name resolves to empty string', async () => {
    const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
    const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
    mockDb.first.mockResolvedValue({ status: 'active', expires_at: 9999999999 });
    mockBucket.put.mockResolvedValueOnce(undefined);
    mockAi.run.mockRejectedValue(new Error('AI failed'));

    const file = new File([new Uint8Array([1, 2, 3])], 'image.png', { type: 'image/png' });
    let nameCallCount = 0;
    Object.defineProperty(file, 'name', {
      get() {
        nameCallCount++;
        return nameCallCount === 1 ? 'image.png' : '';
      },
      configurable: true,
    });

    const formData = new FormData();
    formData.append('file', file);
    formData.append('repo_owner', 'owner');
    formData.append('repo_name', 'repo');

    const request = new Request('https://cms.pouta.local/api/images/upload', { method: 'POST', body: formData });
    request.formData = async () => formData;
    const context = { request } as any;

    nameCallCount = 0;
    const response = await uploadPOST(context);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.altText).toBe('uploaded image');

    verifySpy.mockRestore();
    collabSpy.mockRestore();
  });

  it('returns 500 if an unexpected error occurs during image upload', async () => {
    const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
    const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockRejectedValue(new Error('Unexpected upload failure'));

    const formData = new FormData();
    formData.append('file', new File(['test'], 'image.png', { type: 'image/png' }));
    formData.append('repo_owner', 'owner');
    formData.append('repo_name', 'repo');

    const context = { request: new Request('https://cms.pouta.local/api/images/upload', { method: 'POST', body: formData }) } as any;
    const response = await uploadPOST(context);
    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBe('Internal server error.');

    verifySpy.mockRestore();
    collabSpy.mockRestore();
  });

  it('strips enclosing double quotes from generated alt-text', async () => {
    const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
    const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
    mockDb.first.mockResolvedValueOnce({ status: 'active', expires_at: 9999999999 });

    mockBucket.put.mockResolvedValueOnce(undefined);
    mockAi.run.mockResolvedValueOnce({ description: '"A double quoted altText"' });

    const formData = new FormData();
    formData.append('file', new File(['test'], 'image.png', { type: 'image/png' }));
    formData.append('repo_owner', 'owner');
    formData.append('repo_name', 'repo');

    const context = { request: new Request('https://cms.pouta.local/api/images/upload', { method: 'POST', body: formData }) } as any;
    const response = await uploadPOST(context);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.altText).toBe('A double quoted altText');

    verifySpy.mockRestore();
    collabSpy.mockRestore();
  });

  it('returns 500 if DB is missing under paywall check', async () => {
    const oldDb = env.DB;
    Object.assign(env, { DB: undefined });
    const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
    const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);

    const formData = new FormData();
    formData.append('file', new File(['test'], 'image.png', { type: 'image/png' }));
    formData.append('repo_owner', 'owner');
    formData.append('repo_name', 'repo');

    const context = { request: new Request('https://cms.pouta.local/api/images/upload', { method: 'POST', body: formData }) } as any;
    const response = await uploadPOST(context);
    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toContain('DB');

    Object.assign(env, { DB: oldDb });
    verifySpy.mockRestore();
    collabSpy.mockRestore();
  });

  it('returns 500 if R2 bucket write fails', async () => {
    const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
    const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
    mockDb.first.mockResolvedValueOnce({ status: 'active', expires_at: 9999999999 });

    mockBucket.put.mockRejectedValueOnce(new Error('R2 write error'));

    const formData = new FormData();
    formData.append('file', new File(['test'], 'image.png', { type: 'image/png' }));
    formData.append('repo_owner', 'owner');
    formData.append('repo_name', 'repo');

    const context = { request: new Request('https://cms.pouta.local/api/images/upload', { method: 'POST', body: formData }) } as any;
    const response = await uploadPOST(context);
    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBe('Internal server error.');

    verifySpy.mockRestore();
    collabSpy.mockRestore();
  });

  it('bypasses subscription check completely if PAYWALL_ENABLED is false', async () => {
    Object.assign(env, { PAYWALL_ENABLED: 'false' });
    const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
    const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
    mockBucket.put.mockResolvedValueOnce(undefined);
    mockAi.run.mockResolvedValueOnce({ description: 'A nice photo' });

    const formData = new FormData();
    formData.append('file', new File(['test'], 'image.png', { type: 'image/png' }));
    formData.append('repo_owner', 'owner');
    formData.append('repo_name', 'repo');

    const context = { request: new Request('https://cms.pouta.local/api/images/upload', { method: 'POST', body: formData }) } as any;
    const response = await uploadPOST(context);
    expect(response.status).toBe(200);

    verifySpy.mockRestore();
    collabSpy.mockRestore();
  });

  it('handles file names ending with a trailing dot gracefully', async () => {
    const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
    const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
    mockDb.first.mockResolvedValueOnce({ status: 'active', expires_at: 9999999999 });

    const formData = new FormData();
    formData.append('file', new File(['test'], 'image.', { type: 'image/png' }));
    formData.append('repo_owner', 'owner');
    formData.append('repo_name', 'repo');

    const context = { request: new Request('https://cms.pouta.local/api/images/upload', { method: 'POST', body: formData }) } as any;
    const response = await uploadPOST(context);
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('Forbidden format');

    verifySpy.mockRestore();
    collabSpy.mockRestore();
  });

  it('falls back to application/octet-stream if file type is empty', async () => {
    const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
    const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
    mockDb.first.mockResolvedValueOnce({ status: 'active', expires_at: 9999999999 });
    mockBucket.put.mockResolvedValueOnce(undefined);
    mockAi.run.mockResolvedValueOnce({ description: 'A nice photo' });

    const file = new File([new Uint8Array([1, 2, 3])], 'image.png', { type: 'image/png' });
    let typeCallCount = 0;
    Object.defineProperty(file, 'type', {
      get() {
        typeCallCount++;
        return typeCallCount === 1 ? 'image/png' : '';
      },
      configurable: true,
    });

    const formData = new FormData();
    formData.append('file', file);
    formData.append('repo_owner', 'owner');
    formData.append('repo_name', 'repo');

    const request = new Request('https://cms.pouta.local/api/images/upload', { method: 'POST', body: formData });
    request.formData = async () => formData;
    const context = { request } as any;

    typeCallCount = 0;
    const response = await uploadPOST(context);
    expect(response.status).toBe(200);

    expect(mockBucket.put).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(ArrayBuffer),
      expect.objectContaining({
        httpMetadata: expect.objectContaining({
          contentType: 'application/octet-stream'
        })
      })
    );

    verifySpy.mockRestore();
    collabSpy.mockRestore();
  });

  it('uses response and text fallbacks for AI description parsing', async () => {
    const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
    const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
    mockDb.first.mockResolvedValue({ status: 'active', expires_at: 9999999999 });
    mockBucket.put.mockResolvedValue(undefined);

    mockAi.run.mockResolvedValueOnce({ response: 'Response property description' });

    const formData = new FormData();
    formData.append('file', new File(['test'], 'image.png', { type: 'image/png' }));
    formData.append('repo_owner', 'owner');
    formData.append('repo_name', 'repo');

    let context = { request: new Request('https://cms.pouta.local/api/images/upload', { method: 'POST', body: formData }) } as any;
    let response = await uploadPOST(context);
    expect(response.status).toBe(200);
    let data = await response.json();
    expect(data.altText).toBe('Response property description');

    mockDb.first.mockResolvedValue({ status: 'active', expires_at: 9999999999 });
    mockBucket.put.mockResolvedValue(undefined);
    mockAi.run.mockResolvedValueOnce({ text: 'Text property description' });

    context = { request: new Request('https://cms.pouta.local/api/images/upload', { method: 'POST', body: formData }) } as any;
    response = await uploadPOST(context);
    expect(response.status).toBe(200);
    data = await response.json();
    expect(data.altText).toBe('Text property description');

    // Test case: AI returns empty object {}
    mockDb.first.mockResolvedValue({ status: 'active', expires_at: 9999999999 });
    mockBucket.put.mockResolvedValue(undefined);
    mockAi.run.mockResolvedValueOnce({});

    context = { request: new Request('https://cms.pouta.local/api/images/upload', { method: 'POST', body: formData }) } as any;
    response = await uploadPOST(context);
    expect(response.status).toBe(200);
    data = await response.json();
    expect(data.altText).toBe('image');

    // Test case: AI returns null
    mockDb.first.mockResolvedValue({ status: 'active', expires_at: 9999999999 });
    mockBucket.put.mockResolvedValue(undefined);
    mockAi.run.mockResolvedValueOnce(null);

    context = { request: new Request('https://cms.pouta.local/api/images/upload', { method: 'POST', body: formData }) } as any;
    response = await uploadPOST(context);
    expect(response.status).toBe(200);
    data = await response.json();
    expect(data.altText).toBe('image');

    verifySpy.mockRestore();
    collabSpy.mockRestore();
  });

  it('handles file name without extension for fallback baseName description', async () => {
    const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
    const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
    mockDb.first.mockResolvedValue({ status: 'active', expires_at: 9999999999 });
    mockBucket.put.mockResolvedValueOnce(undefined);
    mockAi.run.mockRejectedValue(new Error('AI failed'));

    const file = new File([new Uint8Array([1, 2, 3])], 'image.png', { type: 'image/png' });
    let nameCallCount = 0;
    Object.defineProperty(file, 'name', {
      get() {
        nameCallCount++;
        return nameCallCount === 1 ? 'image.png' : 'no-extension-filename';
      },
      configurable: true,
    });

    const formData = new FormData();
    formData.append('file', file);
    formData.append('repo_owner', 'owner');
    formData.append('repo_name', 'repo');

    const request = new Request('https://cms.pouta.local/api/images/upload', { method: 'POST', body: formData });
    request.formData = async () => formData;
    const context = { request } as any;

    nameCallCount = 0;
    const response = await uploadPOST(context);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.altText).toBe('no extension filename');

    verifySpy.mockRestore();
    collabSpy.mockRestore();
  });

  it('bypasses AI section if AI binding is completely missing from env', async () => {
    Object.assign(env, { AI: undefined });
    const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
    const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
    mockDb.first.mockResolvedValueOnce({ status: 'active', expires_at: 9999999999 });
    mockBucket.put.mockResolvedValueOnce(undefined);

    const formData = new FormData();
    formData.append('file', new File(['test'], 'image.png', { type: 'image/png' }));
    formData.append('repo_owner', 'owner');
    formData.append('repo_name', 'repo');

    const context = { request: new Request('https://cms.pouta.local/api/images/upload', { method: 'POST', body: formData }) } as any;
    const response = await uploadPOST(context);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.altText).toBe('image');

    verifySpy.mockRestore();
    collabSpy.mockRestore();
  });
});
