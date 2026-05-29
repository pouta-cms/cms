import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GET as loginGET } from '../../../src/pages/api/auth/login';
import { GET as logoutGET } from '../../../src/pages/api/auth/logout';
import { GET as meGET } from '../../../src/pages/api/auth/me';
import { GET as callbackGET } from '../../../src/pages/api/auth/callback';
import { env } from 'cloudflare:workers';
import { encryptToken } from '../../../src/utils/crypto';

// Setup environment overrides helper
const setEnv = (overrides: Record<string, any>) => {
  Object.assign(env, overrides);
};

describe('Auth API Routes', () => {
  beforeEach(() => {
    // Reset defaults before each test
    setEnv({
      GITHUB_CLIENT_ID: 'placeholder_github_client_id',
      GITHUB_CLIENT_SECRET: 'placeholder_github_client_secret',
      SESSION_SECRET: 'default-fallback-pouta-key-32-chars-minimum',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('login.ts', () => {
    it('returns 500 if GITHUB_CLIENT_ID is not configured', async () => {
      setEnv({ GITHUB_CLIENT_ID: 'placeholder_github_client_id' });
      const context = { request: new Request('https://cms.pouta.local/api/auth/login') } as any;
      
      const response = await loginGET(context);
      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('not configured');
    });

    it('redirects to GitHub OAuth authorize page if GITHUB_CLIENT_ID is configured', async () => {
      setEnv({ GITHUB_CLIENT_ID: 'real-client-id' });
      const context = { request: new Request('https://cms.pouta.local/api/auth/login') } as any;
      
      const response = await loginGET(context);
      expect(response.status).toBe(302);
      const location = response.headers.get('Location');
      expect(location).toContain('https://github.com/login/oauth/authorize');
      expect(location).toContain('client_id=real-client-id');
      expect(location).toContain('redirect_uri=https%3A%2F%2Fcms.pouta.local%2Fapi%2Fauth%2Fcallback');
    });
  });

  describe('logout.ts', () => {
    it('returns 302 and expires the pouta_session cookie', async () => {
      const context = { request: new Request('https://cms.pouta.local/api/auth/logout') } as any;
      
      const response = await logoutGET(context);
      expect(response.status).toBe(302);
      expect(response.headers.get('Location')).toBe('https://cms.pouta.local/');
      expect(response.headers.get('Set-Cookie')).toContain('pouta_session=;');
      expect(response.headers.get('Set-Cookie')).toContain('Max-Age=0');
    });
  });

  describe('me.ts', () => {
    it('returns authenticated false if no session cookie exists', async () => {
      const context = { request: new Request('https://cms.pouta.local/api/auth/me') } as any;
      
      const response = await meGET(context);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.authenticated).toBe(false);
    });

    it('returns authenticated false if some cookies exist but pouta_session is missing', async () => {
      const context = {
        request: new Request('https://cms.pouta.local/api/auth/me', {
          headers: { Cookie: 'some_other_cookie=value123; different_cookie=456' },
        }),
      } as any;

      const response = await meGET(context);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.authenticated).toBe(false);
    });

    it('returns authenticated false and error if session cookie is corrupted', async () => {
      const context = {
        request: new Request('https://cms.pouta.local/api/auth/me', {
          headers: { Cookie: 'pouta_session=corrupted_session_cookie' },
        }),
      } as any;
      
      const response = await meGET(context);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.authenticated).toBe(false);
      expect(data.error).toBe('Session cookie corrupted.');
    });

    it('returns authenticated false if oauth token is revoked or expired by GitHub', async () => {
      const token = 'gho_someexpiredtoken';
      const sealed = await encryptToken(token, 'default-fallback-pouta-key-32-chars-minimum');
      const context = {
        request: new Request('https://cms.pouta.local/api/auth/me', {
          headers: { Cookie: `pouta_session=${sealed}` },
        }),
      } as any;

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false,
      } as Response);

      const response = await meGET(context);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.authenticated).toBe(false);
      expect(data.error).toBe('OAuth session token expired.');

      fetchSpy.mockRestore();
    });

    it('returns user details if session cookie is valid and authorized by GitHub', async () => {
      const token = 'gho_validtoken';
      const sealed = await encryptToken(token, 'default-fallback-pouta-key-32-chars-minimum');
      const context = {
        request: new Request('https://cms.pouta.local/api/auth/me', {
          headers: { Cookie: `pouta_session=${sealed}` },
        }),
      } as any;

      const mockUser = {
        login: 'moha',
        name: 'Moha Developer',
        avatar_url: 'https://avatar.url',
        html_url: 'https://github.com/moha',
      };
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => mockUser,
      } as Response);

      const response = await meGET(context);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.authenticated).toBe(true);
      expect(data.username).toBe('moha');
      expect(data.name).toBe('Moha Developer');
      expect(data.avatar_url).toBe('https://avatar.url');

      fetchSpy.mockRestore();
    });

    it('returns 500 error if internal processing fails', async () => {
      const context = {
        request: {
          headers: {
            get: () => { throw new Error('Simulated internal request crash'); }
          }
        }
      } as any;

      const response = await meGET(context);
      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.authenticated).toBe(false);
      expect(data.error).toBe('Simulated internal request crash');
    });

    it('uses fallback session secret in me.ts when SESSION_SECRET is missing', async () => {
      setEnv({ SESSION_SECRET: undefined });
      const token = 'gho_validtoken';
      const sealed = await encryptToken(token, 'default-fallback-pouta-key-32-chars-minimum');
      const context = {
        request: new Request('https://cms.pouta.local/api/auth/me', {
          headers: { Cookie: `pouta_session=${sealed}` },
        }),
      } as any;

      const mockUser = { login: 'moha', name: 'Moha Developer' };
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => mockUser,
      } as Response);

      const response = await meGET(context);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.authenticated).toBe(true);

      fetchSpy.mockRestore();
    });

    it('uses login as fallback name in me.ts if name is missing from github user data', async () => {
      const token = 'gho_validtoken';
      const sealed = await encryptToken(token, 'default-fallback-pouta-key-32-chars-minimum');
      const context = {
        request: new Request('https://cms.pouta.local/api/auth/me', {
          headers: { Cookie: `pouta_session=${sealed}` },
        }),
      } as any;

      const mockUser = { login: 'moha_login', name: '' };
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => mockUser,
      } as Response);

      const response = await meGET(context);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.name).toBe('moha_login');

      fetchSpy.mockRestore();
    });

    it('returns internal error fallback error message when me GET throws a string', async () => {
      const context = {
        request: {
          headers: {
            get: () => { throw 'Simulated string profile crash'; }
          }
        }
      } as any;

      const response = await meGET(context);
      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.authenticated).toBe(false);
      expect(data.error).toBe('An internal error occurred during profile verification.');
    });
  });

  describe('callback.ts', () => {
    it('returns 400 if authorization code is missing', async () => {
      const context = { request: new Request('https://cms.pouta.local/api/auth/callback') } as any;
      const response = await callbackGET(context);
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('OAuth code missing');
    });

    it('returns 500 if github credentials are not configured', async () => {
      setEnv({ GITHUB_CLIENT_ID: '', GITHUB_CLIENT_SECRET: '' });
      const context = { request: new Request('https://cms.pouta.local/api/auth/callback?code=1234') } as any;
      const response = await callbackGET(context);
      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('not configured');
    });

    it('returns 400 if GitHub OAuth returns an error in response payload', async () => {
      setEnv({ GITHUB_CLIENT_ID: 'id', GITHUB_CLIENT_SECRET: 'secret' });
      const context = { request: new Request('https://cms.pouta.local/api/auth/callback?code=1234') } as any;

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          error: 'bad_verification_code',
          error_description: 'The code passed is incorrect or expired.',
        }),
      } as Response);

      const response = await callbackGET(context);
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('The code passed is incorrect or expired.');

      fetchSpy.mockRestore();
    });

    it('exchanges code for access token successfully and sets cookie', async () => {
      setEnv({ GITHUB_CLIENT_ID: 'id', GITHUB_CLIENT_SECRET: 'secret' });
      const context = { request: new Request('https://cms.pouta.local/api/auth/callback?code=1234') } as any;

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'gho_oauth_access_token_123',
        }),
      } as Response);

      const response = await callbackGET(context);
      expect(response.status).toBe(302);
      expect(response.headers.get('Location')).toBe('https://cms.pouta.local/');
      expect(response.headers.get('Set-Cookie')).toContain('pouta_session=');
      expect(response.headers.get('Set-Cookie')).toContain('Max-Age=');

      fetchSpy.mockRestore();
    });

    it('returns 500 error if token exchange HTTP response is not ok', async () => {
      setEnv({ GITHUB_CLIENT_ID: 'id', GITHUB_CLIENT_SECRET: 'secret' });
      const context = { request: new Request('https://cms.pouta.local/api/auth/callback?code=1234') } as any;

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false,
        text: async () => 'Internal oauth server error',
      } as Response);

      const response = await callbackGET(context);
      expect(response.status).toBe(500);
      const body = await response.text();
      expect(body).toContain('GitHub token exchange failed');

      fetchSpy.mockRestore();
    });

    it('returns 500 error if access token is missing from token response payload', async () => {
      setEnv({ GITHUB_CLIENT_ID: 'id', GITHUB_CLIENT_SECRET: 'secret' });
      const context = { request: new Request('https://cms.pouta.local/api/auth/callback?code=1234') } as any;

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({}),
      } as Response);

      const response = await callbackGET(context);
      expect(response.status).toBe(500);
      const body = await response.text();
      expect(body).toContain('Access Token was not returned by GitHub');

      fetchSpy.mockRestore();
    });

    it('uses fallback session secret when env.SESSION_SECRET is missing', async () => {
      setEnv({ GITHUB_CLIENT_ID: 'id', GITHUB_CLIENT_SECRET: 'secret', SESSION_SECRET: undefined });
      const context = { request: new Request('https://cms.pouta.local/api/auth/callback?code=1234') } as any;

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'gho_oauth_access_token_123',
        }),
      } as Response);

      const response = await callbackGET(context);
      expect(response.status).toBe(302);
      expect(response.headers.get('Set-Cookie')).toContain('pouta_session=');

      fetchSpy.mockRestore();
    });

    it('returns 400 if GitHub OAuth returns an error with no error_description', async () => {
      setEnv({ GITHUB_CLIENT_ID: 'id', GITHUB_CLIENT_SECRET: 'secret' });
      const context = { request: new Request('https://cms.pouta.local/api/auth/callback?code=1234') } as any;

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          error: 'custom_oauth_error_code',
        }),
      } as Response);

      const response = await callbackGET(context);
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('custom_oauth_error_code');

      fetchSpy.mockRestore();
    });

    it('returns html error response if an unexpected string error occurs', async () => {
      setEnv({ GITHUB_CLIENT_ID: 'id', GITHUB_CLIENT_SECRET: 'secret' });
      const context = { request: new Request('https://cms.pouta.local/api/auth/callback?code=1234') } as any;

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce('simulated string oauth crash');

      const response = await callbackGET(context);
      expect(response.status).toBe(500);
      const html = await response.text();
      expect(html).toContain('An unexpected error occurred during GitHub callback authentication.');

      fetchSpy.mockRestore();
    });
  });
});
