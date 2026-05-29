import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET as configGET } from '../../../src/pages/api/content/config';
import { GET as listGET } from '../../../src/pages/api/content/list';
import { POST as savePOST } from '../../../src/pages/api/content/save';
import { POST as deletePOST } from '../../../src/pages/api/content/delete';
import { POST as publishPOST } from '../../../src/pages/api/content/publish';
import { POST as aiAssistPOST } from '../../../src/pages/api/content/ai-assist';
import { POST as genCategoriesPOST } from '../../../src/pages/api/content/generate-categories';
import { POST as genDescriptionPOST } from '../../../src/pages/api/content/generate-description';
import { POST as genHeadlinesPOST } from '../../../src/pages/api/content/generate-headlines';

import { env } from 'cloudflare:workers';
import * as auth from '../../../src/utils/auth';
import * as githubApp from '../../../src/utils/githubApp';

describe('Content Management API Routes - Comprehensive Test Suite', () => {
  const sessionSecret = 'default-fallback-pouta-key-32-chars-minimum';

  const mockDb = {
    prepare: vi.fn().mockReturnThis(),
    bind: vi.fn().mockReturnThis(),
    first: vi.fn(),
    all: vi.fn(),
    run: vi.fn(),
  };

  const mockAi = {
    run: vi.fn(),
  };

  beforeEach(() => {
    // Reset all mock behaviors to prevent test pollution
    mockDb.prepare.mockReturnThis();
    mockDb.bind.mockReturnThis();
    mockDb.first.mockReset();
    mockDb.all.mockReset();
    mockDb.run.mockReset();
    mockAi.run.mockReset();

    Object.assign(env, {
      SESSION_SECRET: sessionSecret,
      PAYWALL_ENABLED: 'true',
      DB: mockDb,
      AI: mockAi,
      GITHUB_APP_ID: '12345',
      GITHUB_APP_PRIVATE_KEY_B64: 'key-base64',
    });
    vi.clearAllMocks();
  });

  describe('config.ts', () => {
    it('returns config successfully from GitHub', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
      const tokenSpy = vi.spyOn(githubApp, 'getInstallationAccessToken').mockResolvedValue('inst_token');

      const mockConfigFile = {
        content: btoa(JSON.stringify({ contentTypes: [] })),
      };

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => mockConfigFile,
      } as Response);

      const context = {
        request: new Request('https://cms.pouta.local/api/content/config?repo=owner/repo&installationId=123'),
      } as any;

      const response = await configGET(context);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);

      verifySpy.mockRestore();
      collabSpy.mockRestore();
      tokenSpy.mockRestore();
      fetchSpy.mockRestore();
    });

    it('returns 400 if required query params are missing', async () => {
      const context = { request: new Request('https://cms.pouta.local/api/content/config') } as any;
      const response = await configGET(context);
      expect(response.status).toBe(400);
    });

    it('returns 400 if repository format is invalid', async () => {
      const context = { request: new Request('https://cms.pouta.local/api/content/config?repo=invalid&installationId=123') } as any;
      const response = await configGET(context);
      expect(response.status).toBe(400);
    });

    it('returns 401 if session is unauthorized', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockRejectedValue(new Error('Session invalid'));
      const context = { request: new Request('https://cms.pouta.local/api/content/config?repo=owner/repo&installationId=123') } as any;
      
      const response = await configGET(context);
      expect(response.status).toBe(401);

      verifySpy.mockRestore();
    });

    it('returns 403 if user is not collaborator', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(false);
      const context = { request: new Request('https://cms.pouta.local/api/content/config?repo=owner/repo&installationId=123') } as any;

      const response = await configGET(context);
      expect(response.status).toBe(403);

      verifySpy.mockRestore();
      collabSpy.mockRestore();
    });

    it('returns 500 if github app variables are missing', async () => {
      Object.assign(env, { GITHUB_APP_ID: 'placeholder_github_app_id' });
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
      const context = { request: new Request('https://cms.pouta.local/api/content/config?repo=owner/repo&installationId=123') } as any;

      const response = await configGET(context);
      expect(response.status).toBe(500);

      verifySpy.mockRestore();
      collabSpy.mockRestore();
    });

    it('returns 500 if Installation token exchange fails', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
      const tokenSpy = vi.spyOn(githubApp, 'getInstallationAccessToken').mockRejectedValue(new Error('Exchange failed'));
      const context = { request: new Request('https://cms.pouta.local/api/content/config?repo=owner/repo&installationId=123') } as any;

      const response = await configGET(context);
      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toContain('Failed to exchange App JWT');

      verifySpy.mockRestore();
      collabSpy.mockRestore();
      tokenSpy.mockRestore();
    });

    it('returns 404 if config file is missing in repository', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
      const tokenSpy = vi.spyOn(githubApp, 'getInstallationAccessToken').mockResolvedValue('inst_token');

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false,
        status: 404,
      } as Response);

      const context = {
        request: new Request('https://cms.pouta.local/api/content/config?repo=owner/repo&installationId=123'),
      } as any;

      const response = await configGET(context);
      expect(response.status).toBe(404);

      verifySpy.mockRestore();
      collabSpy.mockRestore();
      tokenSpy.mockRestore();
      fetchSpy.mockRestore();
    });

    it('returns non-404 error if GitHub API config fetch fails', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
      const tokenSpy = vi.spyOn(githubApp, 'getInstallationAccessToken').mockResolvedValue('inst_token');
      
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false,
        status: 403,
        text: async () => 'Rate limit exceeded',
      } as Response);

      const context = { request: new Request('https://cms.pouta.local/api/content/config?repo=owner/repo&installationId=123') } as any;
      const response = await configGET(context);
      expect(response.status).toBe(403);

      verifySpy.mockRestore();
      collabSpy.mockRestore();
      tokenSpy.mockRestore();
      fetchSpy.mockRestore();
    });

    it('returns 500 if pouta.config.json parsing fails', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
      const tokenSpy = vi.spyOn(githubApp, 'getInstallationAccessToken').mockResolvedValue('inst_token');
      
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({ content: 'invalid-base64-text-not-json' }),
      } as Response);

      const context = { request: new Request('https://cms.pouta.local/api/content/config?repo=owner/repo&installationId=123') } as any;
      const response = await configGET(context);
      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toContain('Failed to parse "pouta.config.json"');

      verifySpy.mockRestore();
      collabSpy.mockRestore();
      tokenSpy.mockRestore();
      fetchSpy.mockRestore();
    });

    it('handles unexpected general exception with 500', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockRejectedValueOnce(new Error('Unexpected collab error'));
      const context = { request: new Request('https://cms.pouta.local/api/content/config?repo=owner/repo&installationId=123') } as any;
      const response = await configGET(context);
      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toBe('Unexpected collab error');

      verifySpy.mockRestore();
      collabSpy.mockRestore();
    });

    it('returns 500 if Installation token exchange fails with a non-Error exception', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
      const tokenSpy = vi.spyOn(githubApp, 'getInstallationAccessToken').mockRejectedValue('Exchange failed with raw string');
      const context = { request: new Request('https://cms.pouta.local/api/content/config?repo=owner/repo&installationId=123') } as any;

      const response = await configGET(context);
      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toContain('Exchange failed with raw string');

      verifySpy.mockRestore();
      collabSpy.mockRestore();
      tokenSpy.mockRestore();
    });

    it('returns 500 if pouta.config.json parsing fails with a non-Error exception', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
      const tokenSpy = vi.spyOn(githubApp, 'getInstallationAccessToken').mockResolvedValue('inst_token');
      
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({ content: 'some-base64-text' }),
      } as Response);

      const atobSpy = vi.spyOn(globalThis, 'atob').mockImplementationOnce(() => {
        throw 'atob threw raw string';
      });

      const context = { request: new Request('https://cms.pouta.local/api/content/config?repo=owner/repo&installationId=123') } as any;
      const response = await configGET(context);
      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toContain('atob threw raw string');

      verifySpy.mockRestore();
      collabSpy.mockRestore();
      tokenSpy.mockRestore();
      fetchSpy.mockRestore();
      atobSpy.mockRestore();
    });

    it('handles unexpected general exception with 500 when error is a non-Error object', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockRejectedValueOnce('Collab raw string error');
      const context = { request: new Request('https://cms.pouta.local/api/content/config?repo=owner/repo&installationId=123') } as any;
      const response = await configGET(context);
      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toBe('An internal server error occurred while loading schema configurations.');

      verifySpy.mockRestore();
      collabSpy.mockRestore();
    });

    it('returns config successfully from GitHub with default session secret when SESSION_SECRET is missing', async () => {
      Object.assign(env, { SESSION_SECRET: undefined });
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
      const tokenSpy = vi.spyOn(githubApp, 'getInstallationAccessToken').mockResolvedValue('inst_token');

      const mockConfigFile = {
        content: btoa(JSON.stringify({ contentTypes: [] })),
      };

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => mockConfigFile,
      } as Response);

      const context = {
        request: new Request('https://cms.pouta.local/api/content/config?repo=owner/repo&installationId=123'),
      } as any;

      const response = await configGET(context);
      console.log('[DEBUG config GET]', await response.clone().text());
      expect(response.status).toBe(200);

      verifySpy.mockRestore();
      collabSpy.mockRestore();
      tokenSpy.mockRestore();
      fetchSpy.mockRestore();
    });

    it('returns 500 if exchanging App JWT for Installation token fails with a non-Error exception', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
      const tokenSpy = vi.spyOn(githubApp, 'getInstallationAccessToken').mockRejectedValue('Raw token exchange error string');
      mockDb.first.mockResolvedValueOnce({
        id: 'doc-1',
        type: 'post',
        repo_owner: 'owner',
        repo_name: 'repo',
        github_installation_id: '123',
      });

      const context = {
        request: new Request('https://cms.pouta.local/api/content/publish', {
          method: 'POST',
          headers: { Cookie: 'pouta_session=token' },
          body: JSON.stringify({ id: 'doc-1' }),
        }),
      } as any;
      const response = await publishPOST(context);
      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toContain('Raw token exchange error string');

      verifySpy.mockRestore();
      collabSpy.mockRestore();
      tokenSpy.mockRestore();
    });

    it('returns 500 if config JSON parsing fails with a non-Error exception', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
      const tokenSpy = vi.spyOn(githubApp, 'getInstallationAccessToken').mockResolvedValue('inst_token');
      mockDb.first.mockResolvedValueOnce({
        id: 'doc-1',
        type: 'post',
        repo_owner: 'owner',
        repo_name: 'repo',
        github_installation_id: '123',
        content_json: '[]',
      });

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({ content: 'some-base64-text' }),
      } as Response);

      const atobSpy = vi.spyOn(globalThis, 'atob').mockImplementationOnce(() => {
        throw 'atob threw raw string in publish';
      });

      const context = {
        request: new Request('https://cms.pouta.local/api/content/publish', {
          method: 'POST',
          headers: { Cookie: 'pouta_session=token' },
          body: JSON.stringify({ id: 'doc-1' }),
        }),
      } as any;
      const response = await publishPOST(context);
      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toContain('atob threw raw string in publish');

      verifySpy.mockRestore();
      collabSpy.mockRestore();
      tokenSpy.mockRestore();
      fetchSpy.mockRestore();
      atobSpy.mockRestore();
    });

    it('publishes document successfully with default session secret when SESSION_SECRET is missing', async () => {
      Object.assign(env, { SESSION_SECRET: undefined });
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
      const tokenSpy = vi.spyOn(githubApp, 'getInstallationAccessToken').mockResolvedValue('inst_token');

      const mockDoc = {
        id: 'doc-1',
        type: 'post',
        slug: 'hello',
        title: 'Hello Post',
        metadata_json: JSON.stringify({}),
        content_json: JSON.stringify([]),
        repo_owner: 'owner',
        repo_name: 'repo',
        repo_branch: 'main',
        github_installation_id: '123',
        created_at: '2026-05-29T10:00:00Z',
      };
      mockDb.first.mockResolvedValueOnce(mockDoc);

      const mockConfig = { contentTypes: [{ type: 'post', writePath: 'src/pages/posts/{slug}.md', fields: [] }] };

      let fetchCount = 0;
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        fetchCount++;
        if (fetchCount === 1) {
          return { ok: true, json: async () => ({ content: btoa(JSON.stringify(mockConfig)) }) } as Response;
        }
        if (fetchCount === 2) {
          return { ok: true, json: async () => ({ sha: 'abcdef123456' }) } as Response;
        }
        if (fetchCount === 3) {
          return { ok: true } as Response;
        }
        return { ok: false } as Response;
      });

      mockDb.run.mockResolvedValueOnce({ success: true });

      const context = {
        request: new Request('https://cms.pouta.local/api/content/publish', {
          method: 'POST',
          headers: { Cookie: 'pouta_session=valid-session-cookie' },
          body: JSON.stringify({ id: 'doc-1' }),
        }),
      } as any;

      const response = await publishPOST(context);
      expect(response.status).toBe(200);

      verifySpy.mockRestore();
      collabSpy.mockRestore();
      tokenSpy.mockRestore();
      fetchSpy.mockRestore();
    });

    it('returns 500 if content_json parsed value is not an array', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
      const tokenSpy = vi.spyOn(githubApp, 'getInstallationAccessToken').mockResolvedValue('inst_token');

      const mockDoc = {
        id: 'doc-1',
        type: 'post',
        slug: 'hello',
        title: 'Hello Post',
        metadata_json: JSON.stringify({}),
        content_json: JSON.stringify({}),
        repo_owner: 'owner',
        repo_name: 'repo',
        repo_branch: 'main',
        github_installation_id: '123',
        created_at: '2026-05-29T10:00:00Z',
      };
      mockDb.first.mockResolvedValueOnce(mockDoc);

      const mockConfig = { contentTypes: [{ type: 'post', writePath: 'src/pages/posts/{slug}.md', fields: [] }] };

      let fetchCount = 0;
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        fetchCount++;
        if (fetchCount === 1) {
          return { ok: true, json: async () => ({ content: btoa(JSON.stringify(mockConfig)) }) } as Response;
        }
        if (fetchCount === 2) {
          return { ok: true, json: async () => ({ sha: 'abcdef123456' }) } as Response;
        }
        if (fetchCount === 3) {
          return { ok: true } as Response;
        }
        return { ok: false } as Response;
      });

      mockDb.run.mockResolvedValueOnce({ success: true });

      const context = {
        request: new Request('https://cms.pouta.local/api/content/publish', {
          method: 'POST',
          headers: { Cookie: 'pouta_session=valid-session-cookie' },
          body: JSON.stringify({ id: 'doc-1' }),
        }),
      } as any;

      const response = await publishPOST(context);
      expect(response.status).toBe(200);

      verifySpy.mockRestore();
      collabSpy.mockRestore();
      tokenSpy.mockRestore();
      fetchSpy.mockRestore();
    });

    it('returns 200 and publishes empty body if content_json is null', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
      const tokenSpy = vi.spyOn(githubApp, 'getInstallationAccessToken').mockResolvedValue('inst_token');

      const mockDoc = {
        id: 'doc-1',
        type: 'post',
        slug: 'hello',
        title: 'Hello Post',
        metadata_json: JSON.stringify({}),
        content_json: 'null',
        repo_owner: 'owner',
        repo_name: 'repo',
        repo_branch: 'main',
        github_installation_id: '123',
        created_at: '2026-05-29T10:00:00Z',
      };
      mockDb.first.mockResolvedValueOnce(mockDoc);

      const mockConfig = { contentTypes: [{ type: 'post', writePath: 'src/pages/posts/{slug}.md', fields: [] }] };

      let fetchCount = 0;
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        fetchCount++;
        if (fetchCount === 1) {
          return { ok: true, json: async () => ({ content: btoa(JSON.stringify(mockConfig)) }) } as Response;
        }
        if (fetchCount === 2) {
          return { ok: true, json: async () => ({ sha: 'abcdef123456' }) } as Response;
        }
        if (fetchCount === 3) {
          return { ok: true } as Response;
        }
        return { ok: false } as Response;
      });

      mockDb.run.mockResolvedValueOnce({ success: true });

      const context = {
        request: new Request('https://cms.pouta.local/api/content/publish', {
          method: 'POST',
          headers: { Cookie: 'pouta_session=valid-session-cookie' },
          body: JSON.stringify({ id: 'doc-1' }),
        }),
      } as any;

      const response = await publishPOST(context);
      expect(response.status).toBe(200);

      verifySpy.mockRestore();
      collabSpy.mockRestore();
      tokenSpy.mockRestore();
      fetchSpy.mockRestore();
    });
  });

  describe('list.ts', () => {
    it('returns documents successfully', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);

      mockDb.all.mockResolvedValueOnce({
        results: [{ id: '1', title: 'Test Draft' }],
      });

      const context = {
        request: new Request('https://cms.pouta.local/api/content/list?repo=owner/repo'),
      } as any;

      const response = await listGET(context);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.documents.length).toBe(1);

      verifySpy.mockRestore();
      collabSpy.mockRestore();
    });

    it('returns 400 if repo param is missing', async () => {
      const context = { request: new Request('https://cms.pouta.local/api/content/list') } as any;
      const response = await listGET(context);
      expect(response.status).toBe(400);
    });

    it('returns 400 if repo param format is invalid', async () => {
      const context = { request: new Request('https://cms.pouta.local/api/content/list?repo=invalid') } as any;
      const response = await listGET(context);
      expect(response.status).toBe(400);
    });

    it('returns 500 if DB is missing', async () => {
      Object.assign(env, { DB: undefined });
      const context = { request: new Request('https://cms.pouta.local/api/content/list?repo=owner/repo') } as any;
      const response = await listGET(context);
      expect(response.status).toBe(500);
    });

    it('returns 401 if session is invalid', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockRejectedValue(new Error('Session invalid'));
      const context = { request: new Request('https://cms.pouta.local/api/content/list?repo=owner/repo') } as any;
      const response = await listGET(context);
      expect(response.status).toBe(401);
      verifySpy.mockRestore();
    });

    it('returns 403 if user is not collaborator', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(false);
      const context = { request: new Request('https://cms.pouta.local/api/content/list?repo=owner/repo') } as any;
      const response = await listGET(context);
      expect(response.status).toBe(403);
      verifySpy.mockRestore();
      collabSpy.mockRestore();
    });

    it('returns 500 if DB query prepare throws', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
      mockDb.all.mockRejectedValueOnce(new Error('D1 Query error'));

      const context = { request: new Request('https://cms.pouta.local/api/content/list?repo=owner/repo') } as any;
      const response = await listGET(context);
      expect(response.status).toBe(500);

      verifySpy.mockRestore();
      collabSpy.mockRestore();
    });

    it('returns empty documents array successfully if results property is missing', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);

      mockDb.all.mockResolvedValueOnce({}); // no results property

      const context = {
        request: new Request('https://cms.pouta.local/api/content/list?repo=owner/repo'),
      } as any;

      const response = await listGET(context);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.documents).toEqual([]);

      verifySpy.mockRestore();
      collabSpy.mockRestore();
    });

    it('returns documents successfully with default session secret when SESSION_SECRET is missing', async () => {
      Object.assign(env, { SESSION_SECRET: undefined });
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);

      mockDb.all.mockResolvedValueOnce({
        results: [{ id: '1', title: 'Test Draft' }],
      });

      const context = {
        request: new Request('https://cms.pouta.local/api/content/list?repo=owner/repo'),
      } as any;

      const response = await listGET(context);
      expect(response.status).toBe(200);

      verifySpy.mockRestore();
      collabSpy.mockRestore();
    });

    it('returns 500 with default message if unexpected error is a non-Error object during list', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockRejectedValue('Non-Error object string exception');

      const context = {
        request: new Request('https://cms.pouta.local/api/content/list?repo=owner/repo'),
      } as any;

      const response = await listGET(context);
      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toBe('An internal server error occurred while retrieving documents.');

      verifySpy.mockRestore();
      collabSpy.mockRestore();
    });
  });

  describe('save.ts', () => {
    const validSaveBody = {
      id: 'doc-1',
      type: 'post',
      slug: 'hello-world',
      title: 'Hello World',
      content_json: [],
      metadata_json: {},
      repo_owner: 'owner',
      repo_name: 'repo',
      github_installation_id: '123',
    };

    it('saves/upserts document successfully', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);

      const context = {
        request: new Request('https://cms.pouta.local/api/content/save', {
          method: 'POST',
          body: JSON.stringify(validSaveBody),
        }),
      } as any;

      mockDb.run.mockResolvedValueOnce({ success: true });

      const response = await savePOST(context);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);

      verifySpy.mockRestore();
      collabSpy.mockRestore();
    });

    it('returns 409 if unique constraint failed on slug/type', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);

      const context = {
        request: new Request('https://cms.pouta.local/api/content/save', {
          method: 'POST',
          body: JSON.stringify(validSaveBody),
        }),
      } as any;

      mockDb.run.mockRejectedValueOnce(new Error('UNIQUE constraint failed: slug, type'));

      const response = await savePOST(context);
      expect(response.status).toBe(409);

      verifySpy.mockRestore();
      collabSpy.mockRestore();
    });

    it('returns 400 if required body parameter is missing', async () => {
      const context = {
        request: new Request('https://cms.pouta.local/api/content/save', {
          method: 'POST',
          body: JSON.stringify({ id: 'doc-1' }), // missing parameters
        }),
      } as any;
      const response = await savePOST(context);
      expect(response.status).toBe(400);
    });

    it('returns 500 if DB binding is missing', async () => {
      Object.assign(env, { DB: undefined });
      const context = {
        request: new Request('https://cms.pouta.local/api/content/save', {
          method: 'POST',
          body: JSON.stringify(validSaveBody),
        }),
      } as any;
      const response = await savePOST(context);
      expect(response.status).toBe(500);
    });

    it('returns 401 if session is invalid', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockRejectedValue(new Error('Session invalid'));
      const context = {
        request: new Request('https://cms.pouta.local/api/content/save', {
          method: 'POST',
          body: JSON.stringify(validSaveBody),
        }),
      } as any;
      const response = await savePOST(context);
      expect(response.status).toBe(401);
      verifySpy.mockRestore();
    });

    it('returns 403 if user is not collaborator', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(false);
      const context = {
        request: new Request('https://cms.pouta.local/api/content/save', {
          method: 'POST',
          body: JSON.stringify(validSaveBody),
        }),
      } as any;
      const response = await savePOST(context);
      expect(response.status).toBe(403);
      verifySpy.mockRestore();
      collabSpy.mockRestore();
    });

    it('returns 500 if generic DB error occurs', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
      mockDb.run.mockRejectedValueOnce(new Error('D1 crash'));

      const context = {
        request: new Request('https://cms.pouta.local/api/content/save', {
          method: 'POST',
          body: JSON.stringify(validSaveBody),
        }),
      } as any;
      const response = await savePOST(context);
      expect(response.status).toBe(500);

      verifySpy.mockRestore();
      collabSpy.mockRestore();
    });

    it('saves/upserts document successfully with metadata_json and content_json as strings', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);

      const context = {
        request: new Request('https://cms.pouta.local/api/content/save', {
          method: 'POST',
          body: JSON.stringify({
            ...validSaveBody,
            content_json: '[]',
            metadata_json: '{}',
          }),
        }),
      } as any;

      mockDb.run.mockResolvedValueOnce({ success: true });

      const response = await savePOST(context);
      expect(response.status).toBe(200);

      verifySpy.mockRestore();
      collabSpy.mockRestore();
    });

    it('saves/upserts document successfully with default session secret when SESSION_SECRET is missing', async () => {
      Object.assign(env, { SESSION_SECRET: undefined });
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);

      const context = {
        request: new Request('https://cms.pouta.local/api/content/save', {
          method: 'POST',
          body: JSON.stringify(validSaveBody),
        }),
      } as any;

      mockDb.run.mockResolvedValueOnce({ success: true });

      const response = await savePOST(context);
      expect(response.status).toBe(200);

      verifySpy.mockRestore();
      collabSpy.mockRestore();
    });

    it('returns 500 with default message if unexpected error is a non-Error object during save', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockRejectedValue('Non-Error object string exception');

      const context = {
        request: new Request('https://cms.pouta.local/api/content/save', {
          method: 'POST',
          body: JSON.stringify(validSaveBody),
        }),
      } as any;

      const response = await savePOST(context);
      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toBe('An internal server error occurred while saving content.');

      verifySpy.mockRestore();
      collabSpy.mockRestore();
    });
  });

  describe('delete.ts', () => {
    it('deletes document successfully', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);

      const context = {
        request: new Request('https://cms.pouta.local/api/content/delete', {
          method: 'POST',
          body: JSON.stringify({ id: 'doc-1', repo_owner: 'owner', repo_name: 'repo' }),
        }),
      } as any;

      mockDb.run.mockResolvedValueOnce({ success: true });

      const response = await deletePOST(context);
      expect(response.status).toBe(200);

      verifySpy.mockRestore();
      collabSpy.mockRestore();
    });

    it('returns 400 if required param is missing', async () => {
      const context = {
        request: new Request('https://cms.pouta.local/api/content/delete', {
          method: 'POST',
          body: JSON.stringify({ id: 'doc-1' }), // missing repo_owner / repo_name
        }),
      } as any;
      const response = await deletePOST(context);
      expect(response.status).toBe(400);
    });

    it('returns 500 if DB is missing', async () => {
      Object.assign(env, { DB: undefined });
      const context = {
        request: new Request('https://cms.pouta.local/api/content/delete', {
          method: 'POST',
          body: JSON.stringify({ id: 'doc-1', repo_owner: 'owner', repo_name: 'repo' }),
        }),
      } as any;
      const response = await deletePOST(context);
      expect(response.status).toBe(500);
    });

    it('returns 401 if session is invalid', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockRejectedValue(new Error('Session invalid'));
      const context = {
        request: new Request('https://cms.pouta.local/api/content/delete', {
          method: 'POST',
          body: JSON.stringify({ id: 'doc-1', repo_owner: 'owner', repo_name: 'repo' }),
        }),
      } as any;
      const response = await deletePOST(context);
      expect(response.status).toBe(401);
      verifySpy.mockRestore();
    });

    it('returns 403 if user is not collaborator', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(false);
      const context = {
        request: new Request('https://cms.pouta.local/api/content/delete', {
          method: 'POST',
          body: JSON.stringify({ id: 'doc-1', repo_owner: 'owner', repo_name: 'repo' }),
        }),
      } as any;
      const response = await deletePOST(context);
      expect(response.status).toBe(403);
      verifySpy.mockRestore();
      collabSpy.mockRestore();
    });

    it('returns 500 if an unexpected error occurs during delete', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockRejectedValue(new Error('Generic failure'));

      const context = {
        request: new Request('https://cms.pouta.local/api/content/delete', {
          method: 'POST',
          body: JSON.stringify({ id: 'doc-1', repo_owner: 'owner', repo_name: 'repo' }),
        }),
      } as any;

      const response = await deletePOST(context);
      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toBe('Generic failure');

      verifySpy.mockRestore();
      collabSpy.mockRestore();
    });

    it('deletes document successfully with default fallback session secret when SESSION_SECRET is missing', async () => {
      Object.assign(env, { SESSION_SECRET: undefined });
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);

      const context = {
        request: new Request('https://cms.pouta.local/api/content/delete', {
          method: 'POST',
          body: JSON.stringify({ id: 'doc-1', repo_owner: 'owner', repo_name: 'repo' }),
        }),
      } as any;

      mockDb.run.mockResolvedValueOnce({ success: true });

      const response = await deletePOST(context);
      expect(response.status).toBe(200);

      verifySpy.mockRestore();
      collabSpy.mockRestore();
    });

    it('returns 500 with default message if unexpected error is not an Error object', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockRejectedValue('Non-Error object string exception');

      const context = {
        request: new Request('https://cms.pouta.local/api/content/delete', {
          method: 'POST',
          body: JSON.stringify({ id: 'doc-1', repo_owner: 'owner', repo_name: 'repo' }),
        }),
      } as any;

      const response = await deletePOST(context);
      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toBe('An internal server error occurred while deleting content.');

      verifySpy.mockRestore();
      collabSpy.mockRestore();
    });
  });

  describe('publish.ts', () => {
    it('commits markdown to GitHub successfully and updates D1', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
      const tokenSpy = vi.spyOn(githubApp, 'getInstallationAccessToken').mockResolvedValue('inst_token');

      // 1. Mock document retrieval
      const mockDoc = {
        id: 'doc-1',
        type: 'post',
        slug: 'hello',
        title: 'Hello Post',
        metadata_json: JSON.stringify({
          date: '2026-05-29',
          tags: ['hello', 'world'],
          categories: 'tech, cloud',
          reading_time: 5,
          custom_slug: 'My Custom Slug',
          slug: ''
        }),
        content_json: JSON.stringify([
          { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: 'Subheading' }] },
          { type: 'heading', props: {}, content: [{ type: 'text', text: 'Default Heading' }] },
          { type: 'paragraph', content: [
            { type: 'text', text: 'Some body text ', styles: { bold: true } },
            { type: 'text', text: 'italic ', styles: { italic: true } },
            { type: 'text', text: 'underline ', styles: { underline: true } },
            { type: 'text', text: 'strike ', styles: { strike: true } },
            { type: 'text', text: 'code ', styles: { code: true } },
            { type: 'link', href: 'https://link.url', content: [{ type: 'text', text: 'link text' }] },
            { type: 'link', href: 'https://nocontent.url' },
            { type: 'unknown_inline_type' }
          ] },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Parent paragraph' }],
            children: [
              { type: 'paragraph', content: [{ type: 'text', text: 'Child paragraph' }] }
            ]
          },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Non-array children parent' }],
            children: { length: 1 } as any
          },
          { type: 'bulletListItem', content: [{ type: 'text', text: 'Bullet item' }] },
          { type: 'heading', props: { level: 3 }, content: [{ type: 'text', text: 'Heading After Bullet' }] },
          {
            type: 'bulletListItem',
            content: [{ type: 'text', text: 'Parent bullet' }],
            children: [
              { type: 'bulletListItem', content: [{ type: 'text', text: 'Child bullet' }] }
            ]
          },
          { type: 'numberedListItem', content: [{ type: 'text', text: 'Numbered item' }] },
          { type: 'checkListItem', props: { checked: true }, content: [{ type: 'text', text: 'Checked item' }] },
          { type: 'checkListItem', props: { checked: false }, content: [{ type: 'text', text: 'Unchecked item' }] },
          { type: 'blockQuote', content: [{ type: 'text', text: 'Quote me' }] },
          { type: 'codeBlock', props: { language: 'js' }, content: [{ type: 'text', text: 'const a = 1;' }] },
          { type: 'codeBlock', props: {}, content: [{ type: 'text', text: 'const b = 2;' }] },
          { type: 'image', props: { url: 'https://img.url/1', name: 'Cool Image' } },
          { type: 'image', props: { url: 'https://img.url/2', caption: 'Image Caption' } },
          { type: 'image', props: { url: 'https://img.url/3' } },
          { type: 'image', props: { name: 'No URL Image' } },
          { type: 'custom_fancy_block', content: [{ type: 'text', text: 'Fancy fallback text' }] },
          { type: 'paragraph', content: [{ type: 'text' }] }
        ]),
        repo_owner: 'owner',
        repo_name: 'repo',
        repo_branch: 'main',
        github_installation_id: '123',
        created_at: '2026-05-29T10:00:00Z',
      };
      mockDb.first.mockResolvedValueOnce(mockDoc);

      // 2. Mock Config retrieval
      const mockConfig = {
        contentTypes: [
          {
            type: 'post',
            writePath: 'src/pages/posts/{year}-{month}-{day}-{slug}.md',
            fields: [
              { name: 'date', type: 'string' },
              { name: 'tags', type: 'tags' },
              { name: 'categories', type: 'list' },
              { name: 'reading_time', type: 'number' },
              { name: 'custom_slug', type: 'slug' },
              { name: 'slug', type: 'slug' }
            ],
          },
        ],
      };

      // 3. Mock fetch responses (for pouta.config.json, git file SHA query, and git file PUT commit)
      let fetchCount = 0;
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        fetchCount++;
        if (fetchCount === 1) {
          // config fetch
          return { ok: true, json: async () => ({ content: btoa(JSON.stringify(mockConfig)) }) } as Response;
        }
        if (fetchCount === 2) {
          // get existing file sha
          return { ok: true, json: async () => ({ sha: 'abcdef123456' }) } as Response;
        }
        if (fetchCount === 3) {
          // put commit
          return { ok: true } as Response;
        }
        return { ok: false } as Response;
      });

      mockDb.run.mockResolvedValueOnce({ success: true });

      const context = {
        request: new Request('https://cms.pouta.local/api/content/publish', {
          method: 'POST',
          headers: { Cookie: 'pouta_session=valid-session-cookie' },
          body: JSON.stringify({ id: 'doc-1' }),
        }),
      } as any;

      const response = await publishPOST(context);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.path).toBe('src/pages/posts/2026-05-29-hello.md');

      verifySpy.mockRestore();
      collabSpy.mockRestore();
      tokenSpy.mockRestore();
      fetchSpy.mockRestore();
    });

    it('correctly escapes backslashes and double quotes in frontmatter values during publish', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
      const tokenSpy = vi.spyOn(githubApp, 'getInstallationAccessToken').mockResolvedValue('inst_token');

      // Document with backslashes and double quotes in title
      const mockDoc = {
        id: 'doc-escaped',
        type: 'post',
        slug: 'escaping-test',
        title: 'Title with \\Backslash\\ and "Quotes"',
        metadata_json: JSON.stringify({
          description: 'A description with \\ and " inside.'
        }),
        content_json: JSON.stringify([
          { type: 'paragraph', content: [{ type: 'text', text: 'Normal text' }] }
        ]),
        repo_owner: 'owner',
        repo_name: 'repo',
        repo_branch: 'main',
        github_installation_id: '123',
        created_at: '2026-05-29T10:00:00Z',
      };
      mockDb.first.mockResolvedValueOnce(mockDoc);

      const mockConfig = {
        contentTypes: [
          {
            type: 'post',
            writePath: 'src/pages/posts/{slug}.md',
            fields: [
              { name: 'description', type: 'string' }
            ],
          },
        ],
      };

      let putBody = '';
      let fetchCount = 0;
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
        fetchCount++;
        if (fetchCount === 1) {
          return { ok: true, json: async () => ({ content: btoa(JSON.stringify(mockConfig)) }) } as Response;
        }
        if (fetchCount === 2) {
          return { ok: true, json: async () => ({ sha: 'abcdef123456' }) } as Response;
        }
        if (fetchCount === 3) {
          if (init && init.body) {
            putBody = JSON.parse(init.body as string).content;
          }
          return { ok: true } as Response;
        }
        return { ok: false } as Response;
      });

      mockDb.run.mockResolvedValueOnce({ success: true });

      const context = {
        request: new Request('https://cms.pouta.local/api/content/publish', {
          method: 'POST',
          headers: { Cookie: 'pouta_session=valid-session-cookie' },
          body: JSON.stringify({ id: 'doc-escaped' }),
        }),
      } as any;

      const response = await publishPOST(context);
      expect(response.status).toBe(200);

      // Decode the generated commit content and check frontmatter escaping
      const commitContent = atob(putBody);
      expect(commitContent).toContain('title: "Title with \\\\Backslash\\\\ and \\"Quotes\\""');
      expect(commitContent).toContain('description: "A description with \\\\ and \\" inside."');

      verifySpy.mockRestore();
      collabSpy.mockRestore();
      tokenSpy.mockRestore();
      fetchSpy.mockRestore();
    });

    it('returns 400 if id param is missing', async () => {
      const context = {
        request: new Request('https://cms.pouta.local/api/content/publish', {
          method: 'POST',
          body: JSON.stringify({}),
        }),
      } as any;
      const response = await publishPOST(context);
      expect(response.status).toBe(400);
    });

    it('returns 401 if session cookie is missing', async () => {
      const context = {
        request: new Request('https://cms.pouta.local/api/content/publish', {
          method: 'POST',
          headers: { Cookie: 'some_other_cookie=value' },
          body: JSON.stringify({ id: 'doc-1' }),
        }),
      } as any;
      const response = await publishPOST(context);
      expect(response.status).toBe(401);
    });

    it('returns 401 if Cookie header is completely missing', async () => {
      const context = {
        request: new Request('https://cms.pouta.local/api/content/publish', {
          method: 'POST',
          body: JSON.stringify({ id: 'doc-1' }),
        }),
      } as any;
      const response = await publishPOST(context);
      expect(response.status).toBe(401);
    });

    it('returns 500 if DB is missing', async () => {
      Object.assign(env, { DB: undefined });
      const context = {
        request: new Request('https://cms.pouta.local/api/content/publish', {
          method: 'POST',
          headers: { Cookie: 'pouta_session=token' },
          body: JSON.stringify({ id: 'doc-1' }),
        }),
      } as any;
      const response = await publishPOST(context);
      expect(response.status).toBe(500);
    });

    it('returns 401 if verifySession throws', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockRejectedValue(new Error('Session invalid'));
      const context = {
        request: new Request('https://cms.pouta.local/api/content/publish', {
          method: 'POST',
          headers: { Cookie: 'pouta_session=token' },
          body: JSON.stringify({ id: 'doc-1' }),
        }),
      } as any;
      const response = await publishPOST(context);
      expect(response.status).toBe(401);
      verifySpy.mockRestore();
    });

    it('returns 404 if document is not found in database', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      mockDb.first.mockResolvedValueOnce(null); // document missing

      const context = {
        request: new Request('https://cms.pouta.local/api/content/publish', {
          method: 'POST',
          headers: { Cookie: 'pouta_session=token' },
          body: JSON.stringify({ id: 'doc-1' }),
        }),
      } as any;
      const response = await publishPOST(context);
      expect(response.status).toBe(404);
      verifySpy.mockRestore();
    });

    it('returns 400 if document lacks repository mapping details', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      mockDb.first.mockResolvedValueOnce({ id: 'doc-1', repo_owner: '' }); // missing repo data

      const context = {
        request: new Request('https://cms.pouta.local/api/content/publish', {
          method: 'POST',
          headers: { Cookie: 'pouta_session=token' },
          body: JSON.stringify({ id: 'doc-1' }),
        }),
      } as any;
      const response = await publishPOST(context);
      expect(response.status).toBe(400);
      verifySpy.mockRestore();
    });

    it('returns 403 if user is not collaborator', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(false);
      mockDb.first.mockResolvedValueOnce({ id: 'doc-1', repo_owner: 'owner', repo_name: 'repo', github_installation_id: '123' });

      const context = {
        request: new Request('https://cms.pouta.local/api/content/publish', {
          method: 'POST',
          headers: { Cookie: 'pouta_session=token' },
          body: JSON.stringify({ id: 'doc-1' }),
        }),
      } as any;
      const response = await publishPOST(context);
      expect(response.status).toBe(403);

      verifySpy.mockRestore();
      collabSpy.mockRestore();
    });

    it('returns 500 if github app integration is not configured', async () => {
      Object.assign(env, { GITHUB_APP_ID: 'placeholder_github_app_id' });
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
      mockDb.first.mockResolvedValueOnce({ id: 'doc-1', repo_owner: 'owner', repo_name: 'repo', github_installation_id: '123' });

      const context = {
        request: new Request('https://cms.pouta.local/api/content/publish', {
          method: 'POST',
          headers: { Cookie: 'pouta_session=token' },
          body: JSON.stringify({ id: 'doc-1' }),
        }),
      } as any;
      const response = await publishPOST(context);
      expect(response.status).toBe(500);

      verifySpy.mockRestore();
      collabSpy.mockRestore();
    });

    it('returns 500 if config JSON parsing fails on GitHub file data', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
      const tokenSpy = vi.spyOn(githubApp, 'getInstallationAccessToken').mockResolvedValue('inst_token');
      mockDb.first.mockResolvedValueOnce({ id: 'doc-1', repo_owner: 'owner', repo_name: 'repo', github_installation_id: '123' });

      // config response returns invalid JSON Base64
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({ content: 'invalidbase64content' }),
      } as Response);

      const context = {
        request: new Request('https://cms.pouta.local/api/content/publish', {
          method: 'POST',
          headers: { Cookie: 'pouta_session=token' },
          body: JSON.stringify({ id: 'doc-1' }),
        }),
      } as any;
      const response = await publishPOST(context);
      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toContain('Failed to parse pouta.config.json');

      verifySpy.mockRestore();
      collabSpy.mockRestore();
      tokenSpy.mockRestore();
      fetchSpy.mockRestore();
    });

    it('returns 500 if document type is not in connectivity profile config', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
      const tokenSpy = vi.spyOn(githubApp, 'getInstallationAccessToken').mockResolvedValue('inst_token');
      mockDb.first.mockResolvedValueOnce({ id: 'doc-1', type: 'page', repo_owner: 'owner', repo_name: 'repo', github_installation_id: '123' });

      const mockConfig = { contentTypes: [{ type: 'post' }] }; // lacks type 'page'
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({ content: btoa(JSON.stringify(mockConfig)) }),
      } as Response);

      const context = {
        request: new Request('https://cms.pouta.local/api/content/publish', {
          method: 'POST',
          headers: { Cookie: 'pouta_session=token' },
          body: JSON.stringify({ id: 'doc-1' }),
        }),
      } as any;
      const response = await publishPOST(context);
      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toContain('is not defined in the Connected Repository');

      verifySpy.mockRestore();
      collabSpy.mockRestore();
      tokenSpy.mockRestore();
      fetchSpy.mockRestore();
    });

    it('returns 500 if content_json contains invalid non-parsable content blocks', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
      const tokenSpy = vi.spyOn(githubApp, 'getInstallationAccessToken').mockResolvedValue('inst_token');
      mockDb.first.mockResolvedValueOnce({
        id: 'doc-1',
        type: 'post',
        repo_owner: 'owner',
        repo_name: 'repo',
        github_installation_id: '123',
        content_json: '{invalid-json',
      });

      const mockConfig = { contentTypes: [{ type: 'post', writePath: 'post.md', fields: [] }] };
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({ content: btoa(JSON.stringify(mockConfig)) }),
      } as Response);

      const context = {
        request: new Request('https://cms.pouta.local/api/content/publish', {
          method: 'POST',
          headers: { Cookie: 'pouta_session=token' },
          body: JSON.stringify({ id: 'doc-1' }),
        }),
      } as any;
      const response = await publishPOST(context);
      expect(response.status).toBe(500);

      verifySpy.mockRestore();
      collabSpy.mockRestore();
      tokenSpy.mockRestore();
      fetchSpy.mockRestore();
    });

    it('returns non-ok status if GitHub PUT commit fails', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
      const tokenSpy = vi.spyOn(githubApp, 'getInstallationAccessToken').mockResolvedValue('inst_token');
      mockDb.first.mockResolvedValueOnce({
        id: 'doc-1',
        type: 'post',
        repo_owner: 'owner',
        repo_name: 'repo',
        github_installation_id: '123',
        content_json: '[]',
      });

      const mockConfig = { contentTypes: [{ type: 'post', writePath: 'post.md', fields: [] }] };
      let fetchCount = 0;
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        fetchCount++;
        if (fetchCount === 1) {
          return { ok: true, json: async () => ({ content: btoa(JSON.stringify(mockConfig)) }) } as Response;
        }
        if (fetchCount === 2) {
          // get SHA returns 404 (new file)
          return { ok: false } as Response;
        }
        if (fetchCount === 3) {
          // PUT fails with 422
          return { ok: false, status: 422, text: async () => 'Unprocessable commit' } as Response;
        }
        return { ok: false } as Response;
      });

      const context = {
        request: new Request('https://cms.pouta.local/api/content/publish', {
          method: 'POST',
          headers: { Cookie: 'pouta_session=token' },
          body: JSON.stringify({ id: 'doc-1' }),
        }),
      } as any;
      const response = await publishPOST(context);
      expect(response.status).toBe(422);

      verifySpy.mockRestore();
      collabSpy.mockRestore();
      tokenSpy.mockRestore();
      fetchSpy.mockRestore();
    });

    it('uses fallback Base64 encoding when Buffer is undefined', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
      const tokenSpy = vi.spyOn(githubApp, 'getInstallationAccessToken').mockResolvedValue('inst_token');

      const mockDoc = {
        id: 'doc-1',
        type: 'post',
        slug: 'hello',
        title: 'Hello Post',
        metadata_json: JSON.stringify({}),
        content_json: JSON.stringify([]),
        repo_owner: 'owner',
        repo_name: 'repo',
        repo_branch: 'main',
        github_installation_id: '123',
        created_at: '2026-05-29T10:00:00Z',
      };
      mockDb.first.mockResolvedValueOnce(mockDoc);

      const mockConfig = { contentTypes: [{ type: 'post', writePath: 'src/pages/posts/{slug}.md', fields: [] }] };

      const originalBuffer = globalThis.Buffer;
      let fetchCount = 0;
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        fetchCount++;
        if (fetchCount === 1) {
          return { ok: true, json: async () => ({ content: btoa(JSON.stringify(mockConfig)) }) } as Response;
        }
        if (fetchCount === 2) {
          // Temporarily nullify global Buffer right before encoding
          Object.defineProperty(globalThis, 'Buffer', {
            value: undefined,
            writable: true,
            configurable: true,
          });
          return { ok: true, json: async () => ({ sha: 'abcdef123456' }) } as Response;
        }
        if (fetchCount === 3) {
          // Restore global Buffer immediately
          Object.defineProperty(globalThis, 'Buffer', {
            value: originalBuffer,
            writable: true,
            configurable: true,
          });
          return { ok: true } as Response;
        }
        return { ok: false } as Response;
      });

      mockDb.run.mockResolvedValueOnce({ success: true });

      const context = {
        request: new Request('https://cms.pouta.local/api/content/publish', {
          method: 'POST',
          headers: { Cookie: 'pouta_session=valid-session-cookie' },
          body: JSON.stringify({ id: 'doc-1' }),
        }),
      } as any;

      try {
        const response = await publishPOST(context);
        expect(response.status).toBe(200);
      } finally {
        // Ensure Buffer is always restored in case of failures
        Object.defineProperty(globalThis, 'Buffer', {
          value: originalBuffer,
          writable: true,
          configurable: true,
        });
      }

      verifySpy.mockRestore();
      collabSpy.mockRestore();
      tokenSpy.mockRestore();
      fetchSpy.mockRestore();
    });

    it('returns 500 when an unexpected error occurs during publish', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockRejectedValue(new Error('Unexpected publish error'));
      mockDb.first.mockResolvedValueOnce({ id: 'doc-1', repo_owner: 'owner', repo_name: 'repo', github_installation_id: '123' });

      const context = {
        request: new Request('https://cms.pouta.local/api/content/publish', {
          method: 'POST',
          headers: { Cookie: 'pouta_session=valid-session-cookie' },
          body: JSON.stringify({ id: 'doc-1' }),
        }),
      } as any;

      const response = await publishPOST(context);
      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toBe('Unexpected publish error');

      verifySpy.mockRestore();
      collabSpy.mockRestore();
    });

    it('handles exception when fetching file SHA from GitHub', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
      const tokenSpy = vi.spyOn(githubApp, 'getInstallationAccessToken').mockResolvedValue('inst_token');

      const mockDoc = {
        id: 'doc-1',
        type: 'post',
        slug: 'hello',
        title: 'Hello Post',
        metadata_json: JSON.stringify({}),
        content_json: JSON.stringify([]),
        repo_owner: 'owner',
        repo_name: 'repo',
        repo_branch: 'main',
        github_installation_id: '123',
        created_at: '2026-05-29T10:00:00Z',
      };
      mockDb.first.mockResolvedValueOnce(mockDoc);

      const mockConfig = { contentTypes: [{ type: 'post', writePath: 'src/pages/posts/{slug}.md', fields: [] }] };

      let fetchCount = 0;
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        fetchCount++;
        if (fetchCount === 1) {
          return { ok: true, json: async () => ({ content: btoa(JSON.stringify(mockConfig)) }) } as Response;
        }
        if (fetchCount === 2) {
          // get SHA throws an exception
          throw new Error('Network failure when fetching SHA');
        }
        if (fetchCount === 3) {
          return { ok: true } as Response;
        }
        return { ok: false } as Response;
      });

      mockDb.run.mockResolvedValueOnce({ success: true });

      const context = {
        request: new Request('https://cms.pouta.local/api/content/publish', {
          method: 'POST',
          headers: { Cookie: 'pouta_session=valid-session-cookie' },
          body: JSON.stringify({ id: 'doc-1' }),
        }),
      } as any;

      const response = await publishPOST(context);
      expect(response.status).toBe(200);

      verifySpy.mockRestore();
      collabSpy.mockRestore();
      tokenSpy.mockRestore();
      fetchSpy.mockRestore();
    });

    it('returns non-ok status if config file retrieval fails', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
      const tokenSpy = vi.spyOn(githubApp, 'getInstallationAccessToken').mockResolvedValue('inst_token');
      mockDb.first.mockResolvedValueOnce({
        id: 'doc-1',
        type: 'post',
        repo_owner: 'owner',
        repo_name: 'repo',
        github_installation_id: '123',
        content_json: '[]',
      });

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => 'Not Found',
      } as Response);

      const context = {
        request: new Request('https://cms.pouta.local/api/content/publish', {
          method: 'POST',
          headers: { Cookie: 'pouta_session=token' },
          body: JSON.stringify({ id: 'doc-1' }),
        }),
      } as any;
      const response = await publishPOST(context);
      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toContain('Failed to read pouta.config.json');

      verifySpy.mockRestore();
      collabSpy.mockRestore();
      tokenSpy.mockRestore();
      fetchSpy.mockRestore();
    });

    it('returns 500 if exchanging App JWT for Installation token fails', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
      const tokenSpy = vi.spyOn(githubApp, 'getInstallationAccessToken').mockRejectedValue(new Error('Token exchange error'));
      mockDb.first.mockResolvedValueOnce({
        id: 'doc-1',
        type: 'post',
        repo_owner: 'owner',
        repo_name: 'repo',
        github_installation_id: '123',
      });

      const context = {
        request: new Request('https://cms.pouta.local/api/content/publish', {
          method: 'POST',
          headers: { Cookie: 'pouta_session=token' },
          body: JSON.stringify({ id: 'doc-1' }),
        }),
      } as any;
      const response = await publishPOST(context);
      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toContain('Failed to exchange App JWT for Installation token');

      verifySpy.mockRestore();
      collabSpy.mockRestore();
      tokenSpy.mockRestore();
    });

    it('handles invalid metadata JSON gracefully by falling back to empty object', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
      const tokenSpy = vi.spyOn(githubApp, 'getInstallationAccessToken').mockResolvedValue('inst_token');

      const mockDoc = {
        id: 'doc-1',
        type: 'post',
        slug: 'hello',
        title: 'Hello Post',
        metadata_json: '{invalid-json',
        content_json: JSON.stringify([]),
        repo_owner: 'owner',
        repo_name: 'repo',
        repo_branch: 'main',
        github_installation_id: '123',
        created_at: '2026-05-29T10:00:00Z',
      };
      mockDb.first.mockResolvedValueOnce(mockDoc);

      const mockConfig = { contentTypes: [{ type: 'post', writePath: 'src/pages/posts/{slug}.md', fields: [] }] };

      let fetchCount = 0;
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        fetchCount++;
        if (fetchCount === 1) {
          return { ok: true, json: async () => ({ content: btoa(JSON.stringify(mockConfig)) }) } as Response;
        }
        if (fetchCount === 2) {
          return { ok: true, json: async () => ({ sha: 'abcdef123456' }) } as Response;
        }
        if (fetchCount === 3) {
          return { ok: true } as Response;
        }
        return { ok: false } as Response;
      });

      mockDb.run.mockResolvedValueOnce({ success: true });

      const context = {
        request: new Request('https://cms.pouta.local/api/content/publish', {
          method: 'POST',
          headers: { Cookie: 'pouta_session=valid-session-cookie' },
          body: JSON.stringify({ id: 'doc-1' }),
        }),
      } as any;

      const response = await publishPOST(context);
      expect(response.status).toBe(200);

      verifySpy.mockRestore();
      collabSpy.mockRestore();
      tokenSpy.mockRestore();
      fetchSpy.mockRestore();
    });

    it('publishes document successfully with frontmatter number fallback and non-string/non-array tags value', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
      const tokenSpy = vi.spyOn(githubApp, 'getInstallationAccessToken').mockResolvedValue('inst_token');

      const mockDoc = {
        id: 'doc-1',
        type: 'post',
        slug: 'hello',
        title: 'Hello Post',
        metadata_json: JSON.stringify({
          reading_time: 'not-a-number',
          tags: 123,
        }),
        content_json: JSON.stringify([]),
        repo_owner: 'owner',
        repo_name: 'repo',
        repo_branch: 'main',
        github_installation_id: '123',
        created_at: '2026-05-29T10:00:00Z',
      };
      mockDb.first.mockResolvedValueOnce(mockDoc);

      const mockConfig = {
        contentTypes: [
          {
            type: 'post',
            writePath: 'src/pages/posts/{slug}.md',
            fields: [
              { name: 'reading_time', type: 'number' },
              { name: 'tags', type: 'tags' },
            ],
          },
        ],
      };

      let fetchCount = 0;
      let requestBody: any = null;
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any, init: any) => {
        fetchCount++;
        if (fetchCount === 1) {
          return { ok: true, json: async () => ({ content: btoa(JSON.stringify(mockConfig)) }) } as Response;
        }
        if (fetchCount === 2) {
          return { ok: true, json: async () => ({ sha: 'abcdef123456' }) } as Response;
        }
        if (fetchCount === 3) {
          requestBody = init?.body ? JSON.parse(init.body) : null;
          return { ok: true } as Response;
        }
        return { ok: false } as Response;
      });

      mockDb.run.mockResolvedValueOnce({ success: true });

      const context = {
        request: new Request('https://cms.pouta.local/api/content/publish', {
          method: 'POST',
          headers: { Cookie: 'pouta_session=valid-session-cookie' },
          body: JSON.stringify({ id: 'doc-1' }),
        }),
      } as any;

      const response = await publishPOST(context);
      expect(response.status).toBe(200);

      if (requestBody && requestBody.content) {
        const decoded = atob(requestBody.content);
        expect(decoded).toContain('reading_time: 0');
        expect(decoded).toContain('tags: []');
      }

      verifySpy.mockRestore();
      collabSpy.mockRestore();
      tokenSpy.mockRestore();
      fetchSpy.mockRestore();
    });

    it('returns 500 with default message if unexpected error is a non-Error object during publish', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockRejectedValueOnce('Publish raw string error');
      mockDb.first.mockResolvedValueOnce({ id: 'doc-1', repo_owner: 'owner', repo_name: 'repo', github_installation_id: '123' });

      const context = {
        request: new Request('https://cms.pouta.local/api/content/publish', {
          method: 'POST',
          headers: { Cookie: 'pouta_session=valid-session-cookie' },
          body: JSON.stringify({ id: 'doc-1' }),
        }),
      } as any;

      const response = await publishPOST(context);
      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toBe('An internal server error occurred while publishing to Git.');

      verifySpy.mockRestore();
      collabSpy.mockRestore();
    });
  });

  describe('ai-assist.ts', () => {
    it('adjusts text tone using Workers AI', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);

      mockDb.first.mockResolvedValueOnce({ status: 'active', expires_at: 9999999999 });

      // Mock AI run
      mockAi.run.mockResolvedValueOnce({
        response: 'Rewritten tone adjusted text',
      });

      const context = {
        request: new Request('https://cms.pouta.local/api/content/ai-assist', {
          method: 'POST',
          body: JSON.stringify({
            text: 'Original text',
            action: 'tone',
            tone: 'Professional',
            repo_owner: 'owner',
            repo_name: 'repo',
          }),
        }),
      } as any;

      const response = await aiAssistPOST(context);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.result).toBe('Rewritten tone adjusted text');

      verifySpy.mockRestore();
      collabSpy.mockRestore();
    });

    it('translates text using Workers AI', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
      mockDb.first.mockResolvedValueOnce({ status: 'active', expires_at: 9999999999 });

      mockAi.run.mockResolvedValueOnce({
        response: '"Bonjour le monde"', // text wrapped in quotes to test stripping
      });

      const context = {
        request: new Request('https://cms.pouta.local/api/content/ai-assist', {
          method: 'POST',
          body: JSON.stringify({
            text: 'Hello world',
            action: 'translate',
            targetLanguage: 'French',
            repo_owner: 'owner',
            repo_name: 'repo',
          }),
        }),
      } as any;

      const response = await aiAssistPOST(context);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.result).toBe('Bonjour le monde');

      verifySpy.mockRestore();
      collabSpy.mockRestore();
    });

    it('returns 500 if SESSION_SECRET is missing', async () => {
      Object.assign(env, { SESSION_SECRET: '' });
      const context = { request: new Request('https://cms.pouta.local/api/content/ai-assist', { method: 'POST' }) } as any;
      const response = await aiAssistPOST(context);
      expect(response.status).toBe(500);
    });

    it('returns 400 if repo coordinates are missing in post body', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const context = {
        request: new Request('https://cms.pouta.local/api/content/ai-assist', {
          method: 'POST',
          body: JSON.stringify({ text: 'text' }), // missing repo coordinates
        }),
      } as any;
      const response = await aiAssistPOST(context);
      expect(response.status).toBe(400);
      verifySpy.mockRestore();
    });

    it('returns 500 if DB lookup fails with exception during subscription check', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
      mockDb.first.mockRejectedValueOnce(new Error('D1 failure'));

      const context = {
        request: new Request('https://cms.pouta.local/api/content/ai-assist', {
          method: 'POST',
          body: JSON.stringify({ text: 'text', repo_owner: 'owner', repo_name: 'repo' }),
        }),
      } as any;
      const response = await aiAssistPOST(context);
      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toBe('DATABASE_ERROR');

      verifySpy.mockRestore();
      collabSpy.mockRestore();
    });

    it('returns 402 paywall if paywall is enabled and repository is not premium active', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
      mockDb.first.mockResolvedValueOnce(null); // not active

      const context = {
        request: new Request('https://cms.pouta.local/api/content/ai-assist', {
          method: 'POST',
          body: JSON.stringify({ text: 'text', repo_owner: 'owner', repo_name: 'repo' }),
        }),
      } as any;
      const response = await aiAssistPOST(context);
      expect(response.status).toBe(402);

      verifySpy.mockRestore();
      collabSpy.mockRestore();
    });

    it('returns 400 if text is missing', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
      mockDb.first.mockResolvedValueOnce({ status: 'active', expires_at: 9999999999 });

      const context = {
        request: new Request('https://cms.pouta.local/api/content/ai-assist', {
          method: 'POST',
          body: JSON.stringify({ text: '', repo_owner: 'owner', repo_name: 'repo' }),
        }),
      } as any;
      const response = await aiAssistPOST(context);
      expect(response.status).toBe(400);

      verifySpy.mockRestore();
      collabSpy.mockRestore();
    });

    it('returns 500 if Workers AI binding is missing', async () => {
      Object.assign(env, { AI: undefined });
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
      mockDb.first.mockResolvedValueOnce({ status: 'active', expires_at: 9999999999 });

      const context = {
        request: new Request('https://cms.pouta.local/api/content/ai-assist', {
          method: 'POST',
          body: JSON.stringify({ text: 'text', action: 'grammar', repo_owner: 'owner', repo_name: 'repo' }),
        }),
      } as any;
      const response = await aiAssistPOST(context);
      expect(response.status).toBe(500);

      verifySpy.mockRestore();
      collabSpy.mockRestore();
    });

    it('returns 400 if required action arguments (tone or translate) are missing', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
      
      // Persistent mock for DB subscription record to cover multiple calls
      mockDb.first.mockResolvedValue({ status: 'active', expires_at: 9999999999 });

      // missing tone for tone action
      const context1 = {
        request: new Request('https://cms.pouta.local/api/content/ai-assist', {
          method: 'POST',
          body: JSON.stringify({ text: 'text', action: 'tone', repo_owner: 'owner', repo_name: 'repo' }),
        }),
      } as any;
      expect((await aiAssistPOST(context1)).status).toBe(400);

      // missing targetLanguage for translate action
      const context2 = {
        request: new Request('https://cms.pouta.local/api/content/ai-assist', {
          method: 'POST',
          body: JSON.stringify({ text: 'text', action: 'translate', repo_owner: 'owner', repo_name: 'repo' }),
        }),
      } as any;
      expect((await aiAssistPOST(context2)).status).toBe(400);

      verifySpy.mockRestore();
      collabSpy.mockRestore();
    });

    it('returns 400 for invalid action names', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
      mockDb.first.mockResolvedValueOnce({ status: 'active', expires_at: 9999999999 });

      const context = {
        request: new Request('https://cms.pouta.local/api/content/ai-assist', {
          method: 'POST',
          body: JSON.stringify({ text: 'text', action: 'invalid-action', repo_owner: 'owner', repo_name: 'repo' }),
        }),
      } as any;
      expect((await aiAssistPOST(context)).status).toBe(400);

      verifySpy.mockRestore();
      collabSpy.mockRestore();
    });

    it('returns 500 if AI model execution fails completely', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
      mockDb.first.mockResolvedValueOnce({ status: 'active', expires_at: 9999999999 });

      mockAi.run.mockRejectedValue(new Error('AI crash'));

      const context = {
        request: new Request('https://cms.pouta.local/api/content/ai-assist', {
          method: 'POST',
          body: JSON.stringify({ text: 'text', action: 'grammar', repo_owner: 'owner', repo_name: 'repo' }),
        }),
      } as any;
      expect((await aiAssistPOST(context)).status).toBe(500);

      verifySpy.mockRestore();
      collabSpy.mockRestore();
    });

    it('covers summarize, expand, single-quote stripping, and missing DB under paywall for ai-assist', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
      
      // 1. Missing DB under paywall gate
      const oldDb = env.DB;
      Object.assign(env, { DB: undefined });
      const contextNoDb = {
        request: new Request('https://cms.pouta.local/api/content/ai-assist', {
          method: 'POST',
          body: JSON.stringify({ text: 'text', action: 'grammar', repo_owner: 'owner', repo_name: 'repo' }),
        }),
      } as any;
      expect((await aiAssistPOST(contextNoDb)).status).toBe(500);
      Object.assign(env, { DB: oldDb });

      // 2. Active premium subscription for summarize and expand
      mockDb.first.mockResolvedValue({ status: 'active', expires_at: 9999999999 });

      // Test summarize
      mockAi.run.mockReset();
      mockAi.run.mockResolvedValueOnce({ response: 'Summary result' });
      const contextSummarize = {
        request: new Request('https://cms.pouta.local/api/content/ai-assist', {
          method: 'POST',
          body: JSON.stringify({ text: 'Long text to summarize', action: 'summarize', repo_owner: 'owner', repo_name: 'repo' }),
        }),
      } as any;
      const resSummarize = await aiAssistPOST(contextSummarize);
      expect(resSummarize.status).toBe(200);
      const dataSummarize = await resSummarize.json();
      expect(dataSummarize.result).toBe('Summary result');

      // Test expand
      mockAi.run.mockReset();
      mockAi.run.mockResolvedValueOnce({ response: 'Expanded continuation' });
      const contextExpand = {
        request: new Request('https://cms.pouta.local/api/content/ai-assist', {
          method: 'POST',
          body: JSON.stringify({ text: 'Short text', action: 'expand', repo_owner: 'owner', repo_name: 'repo' }),
        }),
      } as any;
      const resExpand = await aiAssistPOST(contextExpand);
      expect(resExpand.status).toBe(200);
      const dataExpand = await resExpand.json();
      expect(dataExpand.result).toBe('Expanded continuation');

      // Test single quote stripping
      mockAi.run.mockReset();
      mockAi.run.mockResolvedValueOnce({ response: "'Single quoted response'" });
      const contextQuotes = {
        request: new Request('https://cms.pouta.local/api/content/ai-assist', {
          method: 'POST',
          body: JSON.stringify({ text: 'Short text', action: 'grammar', repo_owner: 'owner', repo_name: 'repo' }),
        }),
      } as any;
      const resQuotes = await aiAssistPOST(contextQuotes);
      expect(resQuotes.status).toBe(200);
      const dataQuotes = await resQuotes.json();
      expect(dataQuotes.result).toBe('Single quoted response');

      verifySpy.mockRestore();
      collabSpy.mockRestore();
    });

    it('bypasses subscription check completely if PAYWALL_ENABLED is false', async () => {
      Object.assign(env, { PAYWALL_ENABLED: 'false' });
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
      mockAi.run.mockResolvedValueOnce({ response: 'Processed without paywall' });

      const context = {
        request: new Request('https://cms.pouta.local/api/content/ai-assist', {
          method: 'POST',
          body: JSON.stringify({ text: 'text', action: 'grammar', repo_owner: 'owner', repo_name: 'repo' }),
        }),
      } as any;

      const response = await aiAssistPOST(context);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.result).toBe('Processed without paywall');

      verifySpy.mockRestore();
      collabSpy.mockRestore();
    });

    it('uses text property of AI response if response property is missing', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
      mockDb.first.mockResolvedValueOnce({ status: 'active', expires_at: 9999999999 });
      mockAi.run.mockResolvedValueOnce({ text: 'AI output using text property' });

      const context = {
        request: new Request('https://cms.pouta.local/api/content/ai-assist', {
          method: 'POST',
          body: JSON.stringify({ text: 'text', action: 'grammar', repo_owner: 'owner', repo_name: 'repo' }),
        }),
      } as any;

      const response = await aiAssistPOST(context);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.result).toBe('AI output using text property');

      verifySpy.mockRestore();
      collabSpy.mockRestore();
    });

    it('uses empty string as fallback if both response and text properties are missing in AI response', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
      mockDb.first.mockResolvedValueOnce({ status: 'active', expires_at: 9999999999 });
      mockAi.run.mockResolvedValueOnce({}); // empty object

      const context = {
        request: new Request('https://cms.pouta.local/api/content/ai-assist', {
          method: 'POST',
          body: JSON.stringify({ text: 'text', action: 'grammar', repo_owner: 'owner', repo_name: 'repo' }),
        }),
      } as any;

      const response = await aiAssistPOST(context);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.result).toBe('');

      verifySpy.mockRestore();
      collabSpy.mockRestore();
    });

    it('returns 500 with default message if unexpected error is a non-Error object during AI assist', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockRejectedValueOnce('Collab raw string error');
      const context = {
        request: new Request('https://cms.pouta.local/api/content/ai-assist', {
          method: 'POST',
          body: JSON.stringify({ text: 'text', action: 'grammar', repo_owner: 'owner', repo_name: 'repo' }),
        }),
      } as any;

      const response = await aiAssistPOST(context);
      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toBe('An internal error occurred during AI assistance.');

      verifySpy.mockRestore();
      collabSpy.mockRestore();
    });
  });

  describe('generate-categories/description/headlines', () => {
    it('generates keywords, descriptions, and headlines', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
      mockDb.first.mockResolvedValue({ status: 'active', expires_at: 9999999999 });

      // Intelligent, robust mock for the AI service
      mockAi.run.mockImplementation(async (model: string, options: any) => {
        const messages = options?.messages || [];
        const systemMessage = (messages.find((m: any) => m.role === 'system')?.content || options?.prompt || '').toLowerCase();
        const modelLower = model.toLowerCase();

        if (systemMessage.includes('seo specialist') || systemMessage.includes('description') || modelLower.includes('description')) {
          return { response: 'This is a beautifully generated SEO meta description for our blog post.' };
        }
        if (systemMessage.includes('category tags') || systemMessage.includes('comma-separated') || modelLower.includes('categories')) {
          return { response: 'tech, edge-computing, serverless' };
        }
        if (systemMessage.includes('headlines') || systemMessage.includes('titles') || modelLower.includes('headlines') || modelLower.includes('title')) {
          return { response: 'First Title Headline\nSecond Title Headline\nThird Title Headline\nFourth Title Headline\nFifth Title Headline' };
        }
        return { response: 'result data' };
      });

      const body = JSON.stringify({
        title: 'Title',
        content: 'CMS writing software on the edge',
        repo_owner: 'owner',
        repo_name: 'repo',
      });

      // 1. Categories
      const contextCat = { request: new Request('https://cms.pouta.local/api/content/generate-categories', { method: 'POST', body }) } as any;
      const resCat = await genCategoriesPOST(contextCat);
      expect(resCat.status).toBe(200);
      const catData = await resCat.json();
      expect(catData.success).toBe(true);
      expect(catData.categories).toEqual(['tech', 'edge-computing', 'serverless']);

      // 2. Description
      const contextDesc = { request: new Request('https://cms.pouta.local/api/content/generate-description', { method: 'POST', body }) } as any;
      const resDesc = await genDescriptionPOST(contextDesc);
      expect(resDesc.status).toBe(200);
      const descData = await resDesc.json();
      expect(descData.success).toBe(true);
      expect(descData.description).toBe('This is a beautifully generated SEO meta description for our blog post.');

      // 3. Headlines
      const contextHead = { request: new Request('https://cms.pouta.local/api/content/generate-headlines', { method: 'POST', body }) } as any;
      const resHead = await genHeadlinesPOST(contextHead);
      expect(resHead.status).toBe(200);
      const headData = await resHead.json();
      expect(headData.success).toBe(true);
      expect(headData.headlines.length).toBe(5);

      verifySpy.mockRestore();
      collabSpy.mockRestore();
    });

    it('returns 400/500 validation failures for missing parameters or bindings across all generate endpoints', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
      mockDb.first.mockResolvedValue({ status: 'active', expires_at: 9999999999 });

      const missingRepoBody = JSON.stringify({ content: 'Article text' });
      const missingContentBody = JSON.stringify({ content: '', repo_owner: 'owner', repo_name: 'repo' });
      const validBody = JSON.stringify({ content: 'valid article content', repo_owner: 'owner', repo_name: 'repo' });

      // missing repo coords -> returns 400
      expect((await genCategoriesPOST({ request: new Request('https://cms.pouta.local/api/content/generate-categories', { method: 'POST', body: missingRepoBody }) } as any)).status).toBe(400);
      expect((await genDescriptionPOST({ request: new Request('https://cms.pouta.local/api/content/generate-description', { method: 'POST', body: missingRepoBody }) } as any)).status).toBe(400);
      expect((await genHeadlinesPOST({ request: new Request('https://cms.pouta.local/api/content/generate-headlines', { method: 'POST', body: missingRepoBody }) } as any)).status).toBe(400);

      // missing content -> returns 400
      expect((await genCategoriesPOST({ request: new Request('https://cms.pouta.local/api/content/generate-categories', { method: 'POST', body: missingContentBody }) } as any)).status).toBe(400);
      expect((await genDescriptionPOST({ request: new Request('https://cms.pouta.local/api/content/generate-description', { method: 'POST', body: missingContentBody }) } as any)).status).toBe(400);
      expect((await genHeadlinesPOST({ request: new Request('https://cms.pouta.local/api/content/generate-headlines', { method: 'POST', body: missingContentBody }) } as any)).status).toBe(400);

      // missing AI binding -> returns 500
      const oldAi = env.AI;
      Object.assign(env, { AI: undefined });
      expect((await genCategoriesPOST({ request: new Request('https://cms.pouta.local/api/content/generate-categories', { method: 'POST', body: validBody }) } as any)).status).toBe(500);
      expect((await genDescriptionPOST({ request: new Request('https://cms.pouta.local/api/content/generate-description', { method: 'POST', body: validBody }) } as any)).status).toBe(500);
      expect((await genHeadlinesPOST({ request: new Request('https://cms.pouta.local/api/content/generate-headlines', { method: 'POST', body: validBody }) } as any)).status).toBe(500);
      Object.assign(env, { AI: oldAi });

      verifySpy.mockRestore();
      collabSpy.mockRestore();
    });

    it('returns 500 if DB binding is missing under paywall gate check across all generate endpoints', async () => {
      const oldDb = env.DB;
      Object.assign(env, { DB: undefined });
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
      
      const body = JSON.stringify({ content: 'content', repo_owner: 'owner', repo_name: 'repo' });
      
      expect((await genCategoriesPOST({ request: new Request('https://cms.pouta.local/api/content/generate-categories', { method: 'POST', body }) } as any)).status).toBe(500);
      expect((await genDescriptionPOST({ request: new Request('https://cms.pouta.local/api/content/generate-description', { method: 'POST', body }) } as any)).status).toBe(500);
      expect((await genHeadlinesPOST({ request: new Request('https://cms.pouta.local/api/content/generate-headlines', { method: 'POST', body }) } as any)).status).toBe(500);

      Object.assign(env, { DB: oldDb });
      verifySpy.mockRestore();
      collabSpy.mockRestore();
    });

    it('returns 503/500 if D1 database query preparation throws during paywall check across all generate endpoints', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
      mockDb.first.mockRejectedValue(new Error('D1 read error'));
      
      const body = JSON.stringify({ content: 'content', repo_owner: 'owner', repo_name: 'repo' });
      
      expect((await genCategoriesPOST({ request: new Request('https://cms.pouta.local/api/content/generate-categories', { method: 'POST', body }) } as any)).status).toBe(503);
      expect((await genDescriptionPOST({ request: new Request('https://cms.pouta.local/api/content/generate-description', { method: 'POST', body }) } as any)).status).toBe(500);
      expect((await genHeadlinesPOST({ request: new Request('https://cms.pouta.local/api/content/generate-headlines', { method: 'POST', body }) } as any)).status).toBe(500);

      verifySpy.mockRestore();
      collabSpy.mockRestore();
    });

    it('returns 403 if user is not a collaborator across all generate endpoints', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(false);
      mockDb.first.mockResolvedValue({ status: 'active', expires_at: 9999999999 });

      const body = JSON.stringify({ content: 'content', repo_owner: 'owner', repo_name: 'repo' });

      expect((await genCategoriesPOST({ request: new Request('https://cms.pouta.local/api/content/generate-categories', { method: 'POST', body }) } as any)).status).toBe(403);
      expect((await genDescriptionPOST({ request: new Request('https://cms.pouta.local/api/content/generate-description', { method: 'POST', body }) } as any)).status).toBe(403);
      expect((await genHeadlinesPOST({ request: new Request('https://cms.pouta.local/api/content/generate-headlines', { method: 'POST', body }) } as any)).status).toBe(403);
      expect((await aiAssistPOST({ request: new Request('https://cms.pouta.local/api/content/ai-assist', { method: 'POST', body }) } as any)).status).toBe(403);

      verifySpy.mockRestore();
      collabSpy.mockRestore();
    });

    it('returns 402 if repository paywall plan is inactive or expired across all generate endpoints', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
      
      // Inactive subscription
      mockDb.first.mockResolvedValueOnce({ status: 'inactive', expires_at: 9999999999 });
      const body = JSON.stringify({ content: 'content', repo_owner: 'owner', repo_name: 'repo' });
      expect((await genCategoriesPOST({ request: new Request('https://cms.pouta.local/api/content/generate-categories', { method: 'POST', body }) } as any)).status).toBe(402);

      // Expired subscription
      mockDb.first.mockResolvedValueOnce({ status: 'active', expires_at: 1000 });
      expect((await genDescriptionPOST({ request: new Request('https://cms.pouta.local/api/content/generate-description', { method: 'POST', body }) } as any)).status).toBe(402);

      // Record not found in DB
      mockDb.first.mockResolvedValueOnce(undefined);
      expect((await genCategoriesPOST({ request: new Request('https://cms.pouta.local/api/content/generate-categories', { method: 'POST', body }) } as any)).status).toBe(402);

      mockDb.first.mockResolvedValueOnce(undefined);
      expect((await genDescriptionPOST({ request: new Request('https://cms.pouta.local/api/content/generate-description', { method: 'POST', body }) } as any)).status).toBe(402);

      mockDb.first.mockResolvedValueOnce(undefined);
      expect((await genHeadlinesPOST({ request: new Request('https://cms.pouta.local/api/content/generate-headlines', { method: 'POST', body }) } as any)).status).toBe(402);

      verifySpy.mockRestore();
      collabSpy.mockRestore();
    });

    it('returns 400 contract validation failure for category tags formatting constraints', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
      mockDb.first.mockResolvedValue({ status: 'active', expires_at: 9999999999 });
      
      // Mock AI to return too many categories (exceeding maximum 5 contract)
      mockAi.run.mockResolvedValueOnce({ response: 'one, two, three, four, five, six' });

      const body = JSON.stringify({
        content: 'content text',
        repo_owner: 'owner',
        repo_name: 'repo',
      });
      const context = { request: new Request('https://cms.pouta.local/api/content/generate-categories', { method: 'POST', body }) } as any;
      const response = await genCategoriesPOST(context);
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('invalid number of categories');

      verifySpy.mockRestore();
      collabSpy.mockRestore();
    });

    it('returns 400 contract validation failure for category length constraints (too long tag)', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
      mockDb.first.mockResolvedValue({ status: 'active', expires_at: 9999999999 });
      
      // Suggested category tag exceeds length 50
      mockAi.run.mockResolvedValueOnce({ response: 'this-is-a-super-long-category-name-exceeding-fifty-characters' });

      const body = JSON.stringify({
        content: 'content text',
        repo_owner: 'owner',
        repo_name: 'repo',
      });
      const context = { request: new Request('https://cms.pouta.local/api/content/generate-categories', { method: 'POST', body }) } as any;
      const response = await genCategoriesPOST(context);
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('exceeds length constraints');

      verifySpy.mockRestore();
      collabSpy.mockRestore();
    });

    it('returns 400 contract validation failure for category tags word count constraints (too many words)', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
      mockDb.first.mockResolvedValue({ status: 'active', expires_at: 9999999999 });
      
      // Suggested category tag has too many words (> 4 words)
      mockAi.run.mockResolvedValueOnce({ response: 'one two three four five' });

      const body = JSON.stringify({
        content: 'content text',
        repo_owner: 'owner',
        repo_name: 'repo',
      });
      const context = { request: new Request('https://cms.pouta.local/api/content/generate-categories', { method: 'POST', body }) } as any;
      const response = await genCategoriesPOST(context);
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('too many words');

      verifySpy.mockRestore();
      collabSpy.mockRestore();
    });

    it('returns 400 contract validation failure for headlines count (fewer than 3 headlines)', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
      mockDb.first.mockResolvedValue({ status: 'active', expires_at: 9999999999 });
      
      // Clean previous implementations explicitly
      mockAi.run.mockReset();
      // Mock AI to return only 2 headlines (contract requires at least 3)
      mockAi.run.mockResolvedValueOnce({ response: 'Headline One\nHeadline Two' });

      const body = JSON.stringify({
        content: 'content text',
        repo_owner: 'owner',
        repo_name: 'repo',
      });
      const context = { request: new Request('https://cms.pouta.local/api/content/generate-headlines', { method: 'POST', body }) } as any;
      const response = await genHeadlinesPOST(context);
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Expected at least 3');

      verifySpy.mockRestore();
      collabSpy.mockRestore();
    });

    it('returns 400 contract validation failure for SEO description length constraint (too long description)', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
      mockDb.first.mockResolvedValue({ status: 'active', expires_at: 9999999999 });
      
      // Clean previous implementations explicitly
      mockAi.run.mockReset();
      // Mock AI to return a description > 300 characters
      mockAi.run.mockResolvedValueOnce({ response: 'a'.repeat(301) });

      const body = JSON.stringify({
        title: 'Title',
        content: 'content text',
        repo_owner: 'owner',
        repo_name: 'repo',
      });
      const context = { request: new Request('https://cms.pouta.local/api/content/generate-description', { method: 'POST', body }) } as any;
      const response = await genDescriptionPOST(context);
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('outside the allowed 20-300 character range');

      verifySpy.mockRestore();
      collabSpy.mockRestore();
    });

    it('handles headlines stripped of enclosing single quotes correctly', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
      mockDb.first.mockResolvedValue({ status: 'active', expires_at: 9999999999 });
      
      // Clean previous implementations explicitly
      mockAi.run.mockReset();
      // Mock AI to return headlines enclosed in single quotes
      mockAi.run.mockResolvedValueOnce({ response: "'Headline One'\n'Headline Two'\n'Headline Three'" });

      const body = JSON.stringify({
        content: 'content text',
        repo_owner: 'owner',
        repo_name: 'repo',
      });
      const context = { request: new Request('https://cms.pouta.local/api/content/generate-headlines', { method: 'POST', body }) } as any;
      const response = await genHeadlinesPOST(context);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.headlines).toEqual(['Headline One', 'Headline Two', 'Headline Three']);

      verifySpy.mockRestore();
      collabSpy.mockRestore();
    });

    it('covers fallback to Llama-2 when Llama-3 fails for categories, description, and headlines', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
      mockDb.first.mockResolvedValue({ status: 'active', expires_at: 9999999999 });

      const body = JSON.stringify({
        content: 'This is some long content text for my article.',
        repo_owner: 'owner',
        repo_name: 'repo',
      });

      // Test categories fallback
      mockAi.run.mockReset();
      mockAi.run
        .mockRejectedValueOnce(new Error('Llama-3 failed for categories'))
        .mockResolvedValueOnce({ text: 'fallback, category, tags' });

      const contextCat = { request: new Request('https://cms.pouta.local/api/content/generate-categories', { method: 'POST', body }) } as any;
      const resCat = await genCategoriesPOST(contextCat);
      expect(resCat.status).toBe(200);
      const catData = await resCat.json();
      expect(catData.categories).toEqual(['fallback', 'category', 'tags']);

      // Test description fallback
      mockAi.run.mockReset();
      mockAi.run
        .mockRejectedValueOnce(new Error('Llama-3 failed for description'))
        .mockResolvedValueOnce({ response: 'This is a beautifully generated fallback SEO meta description.' });

      const contextDesc = { request: new Request('https://cms.pouta.local/api/content/generate-description', { method: 'POST', body }) } as any;
      const resDesc = await genDescriptionPOST(contextDesc);
      expect(resDesc.status).toBe(200);
      const descData = await resDesc.json();
      expect(descData.description).toBe('This is a beautifully generated fallback SEO meta description.');

      // Test headlines fallback
      mockAi.run.mockReset();
      mockAi.run
        .mockRejectedValueOnce(new Error('Llama-3 failed for headlines'))
        .mockResolvedValueOnce({ response: 'Headline One\nHeadline Two\nHeadline Three' });

      const contextHead = { request: new Request('https://cms.pouta.local/api/content/generate-headlines', { method: 'POST', body }) } as any;
      const resHead = await genHeadlinesPOST(contextHead);
      expect(resHead.status).toBe(200);
      const headData = await resHead.json();
      expect(headData.headlines).toEqual(['Headline One', 'Headline Two', 'Headline Three']);

      verifySpy.mockRestore();
      collabSpy.mockRestore();
    });

    it('covers stripping enclosing double and single quotes from categories, description, and headlines', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
      mockDb.first.mockResolvedValue({ status: 'active', expires_at: 9999999999 });

      const body = JSON.stringify({
        title: 'My Title',
        content: 'This is some long content text for my article.',
        repo_owner: 'owner',
        repo_name: 'repo',
      });

      // Categories with double quotes
      mockAi.run.mockReset();
      mockAi.run.mockResolvedValueOnce({ response: '"tech, databases"' });
      const contextCatDouble = { request: new Request('https://cms.pouta.local/api/content/generate-categories', { method: 'POST', body }) } as any;
      const resCatDouble = await genCategoriesPOST(contextCatDouble);
      expect(resCatDouble.status).toBe(200);
      const catDoubleData = await resCatDouble.json();
      expect(catDoubleData.categories).toEqual(['tech', 'databases']);

      // Categories with single quotes
      mockAi.run.mockReset();
      mockAi.run.mockResolvedValueOnce({ response: "'tech, databases'" });
      const contextCatSingle = { request: new Request('https://cms.pouta.local/api/content/generate-categories', { method: 'POST', body }) } as any;
      const resCatSingle = await genCategoriesPOST(contextCatSingle);
      expect(resCatSingle.status).toBe(200);
      const catSingleData = await resCatSingle.json();
      expect(catSingleData.categories).toEqual(['tech', 'databases']);

      // Description with double quotes
      mockAi.run.mockReset();
      mockAi.run.mockResolvedValueOnce({ response: '"This is a beautifully generated fallback SEO meta description."' });
      const contextDescDouble = { request: new Request('https://cms.pouta.local/api/content/generate-description', { method: 'POST', body }) } as any;
      const resDescDouble = await genDescriptionPOST(contextDescDouble);
      expect(resDescDouble.status).toBe(200);
      const descDoubleData = await resDescDouble.json();
      expect(descDoubleData.description).toBe('This is a beautifully generated fallback SEO meta description.');

      // Description with single quotes
      mockAi.run.mockReset();
      mockAi.run.mockResolvedValueOnce({ response: "'This is a beautifully generated fallback SEO meta description.'" });
      const contextDescSingle = { request: new Request('https://cms.pouta.local/api/content/generate-description', { method: 'POST', body }) } as any;
      const resDescSingle = await genDescriptionPOST(contextDescSingle);
      expect(resDescSingle.status).toBe(200);
      const descSingleData = await resDescSingle.json();
      expect(descSingleData.description).toBe('This is a beautifully generated fallback SEO meta description.');

      // Headlines with double quotes
      mockAi.run.mockReset();
      mockAi.run.mockResolvedValueOnce({ response: '"Headline One"\n"Headline Two"\n"Headline Three"' });
      const contextHeadDouble = { request: new Request('https://cms.pouta.local/api/content/generate-headlines', { method: 'POST', body }) } as any;
      const resHeadDouble = await genHeadlinesPOST(contextHeadDouble);
      expect(resHeadDouble.status).toBe(200);
      const headDoubleData = await resHeadDouble.json();
      expect(headDoubleData.headlines).toEqual(['Headline One', 'Headline Two', 'Headline Three']);

      verifySpy.mockRestore();
      collabSpy.mockRestore();
    });

    it('returns 500 when headlines count is 0', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
      mockDb.first.mockResolvedValue({ status: 'active', expires_at: 9999999999 });

      mockAi.run.mockReset();
      mockAi.run.mockResolvedValueOnce({ response: '' });

      const body = JSON.stringify({
        content: 'content text',
        repo_owner: 'owner',
        repo_name: 'repo',
      });
      const context = { request: new Request('https://cms.pouta.local/api/content/generate-headlines', { method: 'POST', body }) } as any;
      const response = await genHeadlinesPOST(context);
      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toContain('AI generated empty or malformed headlines');

      verifySpy.mockRestore();
      collabSpy.mockRestore();
    });

    it('returns 500 if SESSION_SECRET is missing across all generate endpoints', async () => {
      const oldSecret = env.SESSION_SECRET;
      Object.assign(env, { SESSION_SECRET: undefined });

      const body = JSON.stringify({ content: 'content', repo_owner: 'owner', repo_name: 'repo' });
      expect((await genCategoriesPOST({ request: new Request('https://cms.pouta.local/api/content/generate-categories', { method: 'POST', body }) } as any)).status).toBe(500);
      expect((await genDescriptionPOST({ request: new Request('https://cms.pouta.local/api/content/generate-description', { method: 'POST', body }) } as any)).status).toBe(500);
      expect((await genHeadlinesPOST({ request: new Request('https://cms.pouta.local/api/content/generate-headlines', { method: 'POST', body }) } as any)).status).toBe(500);

      Object.assign(env, { SESSION_SECRET: oldSecret });
    });

    it('returns 401 if verifySession throws (unauthorized login session) across all generate endpoints', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockRejectedValue(new Error('Invalid token'));
      const body = JSON.stringify({ content: 'content', repo_owner: 'owner', repo_name: 'repo' });

      expect((await genCategoriesPOST({ request: new Request('https://cms.pouta.local/api/content/generate-categories', { method: 'POST', body }) } as any)).status).toBe(401);
      expect((await genDescriptionPOST({ request: new Request('https://cms.pouta.local/api/content/generate-description', { method: 'POST', body }) } as any)).status).toBe(401);
      expect((await genHeadlinesPOST({ request: new Request('https://cms.pouta.local/api/content/generate-headlines', { method: 'POST', body }) } as any)).status).toBe(401);
      expect((await aiAssistPOST({ request: new Request('https://cms.pouta.local/api/content/ai-assist', { method: 'POST', body }) } as any)).status).toBe(401);

      verifySpy.mockRestore();
    });

    it('returns 400 for malformed JSON request in generate headlines', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const context = { request: new Request('https://cms.pouta.local/api/content/generate-headlines', { method: 'POST', body: 'not-a-json' }) } as any;
      const response = await genHeadlinesPOST(context);
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Malformed JSON');
      verifySpy.mockRestore();
    });

    it('handles general exceptions in POST handlers returning 500 status', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockRejectedValue(new Error('Unexpected collab crash'));
      mockDb.first.mockResolvedValue({ status: 'active', expires_at: 9999999999 });

      const body = JSON.stringify({
        content: 'content text',
        repo_owner: 'owner',
        repo_name: 'repo',
      });

      const contextHead = { request: new Request('https://cms.pouta.local/api/content/generate-headlines', { method: 'POST', body }) } as any;
      const responseHead = await genHeadlinesPOST(contextHead);
      expect(responseHead.status).toBe(500);

      const contextCat = { request: new Request('https://cms.pouta.local/api/content/generate-categories', { method: 'POST', body }) } as any;
      const responseCat = await genCategoriesPOST(contextCat);
      expect(responseCat.status).toBe(500);

      const contextDesc = { request: new Request('https://cms.pouta.local/api/content/generate-description', { method: 'POST', body }) } as any;
      const responseDesc = await genDescriptionPOST(contextDesc);
      expect(responseDesc.status).toBe(500);

      verifySpy.mockRestore();
      collabSpy.mockRestore();
    });

    it('covers missing PAYWALL_ENABLED, fallback title, AI response fallbacks, and non-Error exceptions across categories, description, and headlines', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);

      // 1. Paywall bypass (PAYWALL_ENABLED is not true)
      Object.assign(env, { PAYWALL_ENABLED: 'false' });
      mockAi.run.mockReset();
      mockAi.run
        .mockResolvedValueOnce({ text: 'tag1, tag2' })
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce(null);

      const bodyWithoutTitle = JSON.stringify({
        content: 'Article body text',
        repo_owner: 'owner',
        repo_name: 'repo',
      });

      // Categories with text property and missing title
      const contextCat = { request: new Request('https://cms.pouta.local/api/content/generate-categories', { method: 'POST', body: bodyWithoutTitle }) } as any;
      const resCat = await genCategoriesPOST(contextCat);
      expect(resCat.status).toBe(200);
      const catData = await resCat.json();
      expect(catData.categories).toEqual(['tag1', 'tag2']);

      // Description with empty object (should fail character length check since empty is < 20 characters)
      const contextDesc = { request: new Request('https://cms.pouta.local/api/content/generate-description', { method: 'POST', body: bodyWithoutTitle }) } as any;
      const resDesc = await genDescriptionPOST(contextDesc);
      expect(resDesc.status).toBe(400); // fails validation because generated SEO description is empty (< 20 chars)

      // Headlines with null (should fail with 500 since empty headlines)
      const contextHead = { request: new Request('https://cms.pouta.local/api/content/generate-headlines', { method: 'POST', body: bodyWithoutTitle }) } as any;
      const resHead = await genHeadlinesPOST(contextHead);
      expect(resHead.status).toBe(500);

      // Categories with empty object response (covers || '' fallback branch and returns 400)
      mockAi.run.mockReset();
      mockAi.run.mockResolvedValueOnce({});
      const contextCatEmpty = { request: new Request('https://cms.pouta.local/api/content/generate-categories', { method: 'POST', body: bodyWithoutTitle }) } as any;
      const resCatEmpty = await genCategoriesPOST(contextCatEmpty);
      expect(resCatEmpty.status).toBe(400);
      const catEmptyData = await resCatEmpty.json();
      expect(catEmptyData.error).toContain('invalid number of categories');

      // 2. Non-Error objects thrown in POST handlers
      const contextCat2 = { request: new Request('https://cms.pouta.local/api/content/generate-categories', { method: 'POST', body: bodyWithoutTitle }) } as any;
      collabSpy.mockRejectedValueOnce('Non-Error object categories crash');
      expect((await genCategoriesPOST(contextCat2)).status).toBe(500);

      const contextDesc2 = { request: new Request('https://cms.pouta.local/api/content/generate-description', { method: 'POST', body: bodyWithoutTitle }) } as any;
      collabSpy.mockRejectedValueOnce('Non-Error object description crash');
      expect((await genDescriptionPOST(contextDesc2)).status).toBe(500);

      const contextHead2 = { request: new Request('https://cms.pouta.local/api/content/generate-headlines', { method: 'POST', body: bodyWithoutTitle }) } as any;
      collabSpy.mockRejectedValueOnce('Non-Error object headlines crash');
      expect((await genHeadlinesPOST(contextHead2)).status).toBe(500);

      Object.assign(env, { PAYWALL_ENABLED: 'true' });
      verifySpy.mockRestore();
      collabSpy.mockRestore();
    });
  });
});
