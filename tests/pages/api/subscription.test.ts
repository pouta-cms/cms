import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GET as reposGET } from '../../../src/pages/api/github/repos';
import { GET as statusGET } from '../../../src/pages/api/subscription/status';
import { POST as stripePOST } from '../../../src/pages/api/webhooks/stripe';
import { env } from 'cloudflare:workers';
import * as auth from '../../../src/utils/auth';

describe('Subscription, Repositories, and Stripe Webhook APIs', () => {
  const sessionSecret = 'default-fallback-pouta-key-32-chars-minimum';
  
  // DB Mock setup
  const mockDb = {
    prepare: vi.fn().mockReturnThis(),
    bind: vi.fn().mockReturnThis(),
    first: vi.fn(),
    run: vi.fn(),
  };

  beforeEach(() => {
    Object.assign(env, {
      SESSION_SECRET: sessionSecret,
      PAYWALL_ENABLED: 'true',
      STRIPE_PAYMENT_LINK: 'https://stripe.com/pay',
      STRIPE_PORTAL_LINK: 'https://stripe.com/portal',
      STRIPE_WEBHOOK_SECRET: 'whsec_testsecret',
      DB: mockDb,
    });
    vi.clearAllMocks();
  });

  describe('repos.ts', () => {
    it('returns 401 if session is invalid', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockRejectedValue(new Error('Session invalid'));
      const context = { request: new Request('https://cms.pouta.local/api/github/repos') } as any;

      const response = await reposGET(context);
      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('Session invalid');

      verifySpy.mockRestore();
    });

    it('returns connected repositories successfully', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('gho_valid_user_token');
      
      const mockInstallations = {
        installations: [
          { id: 1111 },
          { id: 2222 },
        ],
      };

      const mockRepos1 = {
        repositories: [
          { id: 123, name: 'repo1', full_name: 'owner1/repo1', owner: { login: 'owner1' }, default_branch: 'main' },
        ],
      };

      const mockRepos2 = {
        repositories: [
          { id: 456, name: 'repo2', full_name: 'owner2/repo2', owner: { login: 'owner2' } },
        ],
      };

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
        if (url === 'https://api.github.com/user/installations') {
          return { ok: true, json: async () => mockInstallations } as Response;
        }
        if (url === 'https://api.github.com/user/installations/1111/repositories') {
          return { ok: true, json: async () => mockRepos1 } as Response;
        }
        if (url === 'https://api.github.com/user/installations/2222/repositories') {
          return { ok: true, json: async () => mockRepos2 } as Response;
        }
        return { ok: false } as Response;
      });

      const context = { request: new Request('https://cms.pouta.local/api/github/repos') } as any;
      const response = await reposGET(context);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.repos.length).toBe(2);
      expect(data.repos[0]).toEqual({
        id: 123,
        name: 'repo1',
        full_name: 'owner1/repo1',
        owner: 'owner1',
        default_branch: 'main',
        github_installation_id: '1111',
      });
      expect(data.repos[1]).toEqual({
        id: 456,
        name: 'repo2',
        full_name: 'owner2/repo2',
        owner: 'owner2',
        default_branch: 'main',
        github_installation_id: '2222',
      });

      verifySpy.mockRestore();
      fetchSpy.mockRestore();
    });

    it('returns error if GitHub Installations API returns an error status', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('gho_valid_user_token');
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false,
        status: 403,
        text: async () => 'GitHub rate limit exceeded',
      } as Response);

      const context = { request: new Request('https://cms.pouta.local/api/github/repos') } as any;
      const response = await reposGET(context);
      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('GitHub Installations API error');

      verifySpy.mockRestore();
      fetchSpy.mockRestore();
    });

    it('handles generic exception error with 500 status', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Simulated repository fetch crash'));
      const context = { request: new Request('https://cms.pouta.local/api/github/repos') } as any;
      const response = await reposGET(context);
      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('Simulated repository fetch crash');

      verifySpy.mockRestore();
      fetchSpy.mockRestore();
    });

    it('uses default session secret fallback and handles verifySession string rejection in repos.ts', async () => {
      Object.assign(env, { SESSION_SECRET: undefined });
      const verifySpy = vi.spyOn(auth, 'verifySession').mockRejectedValue('Custom string error');
      const context = { request: new Request('https://cms.pouta.local/api/github/repos') } as any;

      const response = await reposGET(context);
      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('Unauthorized.');

      verifySpy.mockRestore();
    });

    it('handles missing installations, missing repositories, and missing default_branch keys in repos.ts', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      
      const mockInstallations = {
        // installations key is missing!
      };

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
        if (url === 'https://api.github.com/user/installations') {
          return { ok: true, json: async () => mockInstallations } as Response;
        }
        return { ok: false } as Response;
      });

      const context = { request: new Request('https://cms.pouta.local/api/github/repos') } as any;
      const response = await reposGET(context);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.repos.length).toBe(0);

      verifySpy.mockRestore();
      fetchSpy.mockRestore();
    });

    it('handles installations list with missing repositories key and default_branch omission in repos.ts', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      
      const mockInstallations = {
        installations: [{ id: 1111 }]
      };

      const mockRepos1 = {
        // repositories key is missing!
      };

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
        if (url === 'https://api.github.com/user/installations') {
          return { ok: true, json: async () => mockInstallations } as Response;
        }
        if (url === 'https://api.github.com/user/installations/1111/repositories') {
          return { ok: true, json: async () => mockRepos1 } as Response;
        }
        return { ok: false } as Response;
      });

      const context = { request: new Request('https://cms.pouta.local/api/github/repos') } as any;
      const response = await reposGET(context);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.success).toBe(true);

      verifySpy.mockRestore();
      fetchSpy.mockRestore();
    });

    it('handles repo default_branch omission and hits line 71 in repos.ts', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      
      const mockInstallations = {
        installations: [{ id: 1111 }]
      };

      const mockRepos1 = {
        repositories: [
          { id: 123, name: 'repo1', full_name: 'owner1/repo1', owner: { login: 'owner1' } } // default_branch is missing!
        ]
      };

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
        if (url === 'https://api.github.com/user/installations') {
          return { ok: true, json: async () => mockInstallations } as Response;
        }
        if (url === 'https://api.github.com/user/installations/1111/repositories') {
          return { ok: true, json: async () => mockRepos1 } as Response;
        }
        return { ok: false } as Response;
      });

      const context = { request: new Request('https://cms.pouta.local/api/github/repos') } as any;
      const response = await reposGET(context);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.repos[0].default_branch).toBe('main');

      verifySpy.mockRestore();
      fetchSpy.mockRestore();
    });

    it('returns internal error fallback error message when repos GET throws a string', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce('Simulated string repos crash');
      const context = { request: new Request('https://cms.pouta.local/api/github/repos') } as any;
      const response = await reposGET(context);
      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('An internal server error occurred while retrieving connected repositories.');

      verifySpy.mockRestore();
      fetchSpy.mockRestore();
    });

    it('handles case where repository fetch for some installations fails and hits line 61 else in repos.ts', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      
      const mockInstallations = {
        installations: [
          { id: 1111 },
          { id: 2222 },
        ],
      };

      const mockRepos1 = {
        repositories: [
          { id: 123, name: 'repo1', full_name: 'owner1/repo1', owner: { login: 'owner1' } },
        ],
      };

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
        if (url === 'https://api.github.com/user/installations') {
          return { ok: true, json: async () => mockInstallations } as Response;
        }
        if (url === 'https://api.github.com/user/installations/1111/repositories') {
          return { ok: true, json: async () => mockRepos1 } as Response;
        }
        if (url === 'https://api.github.com/user/installations/2222/repositories') {
          return { ok: false, status: 500 } as Response;
        }
        return { ok: false } as Response;
      });

      const context = { request: new Request('https://cms.pouta.local/api/github/repos') } as any;
      const response = await reposGET(context);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.repos.length).toBe(1);

      verifySpy.mockRestore();
      fetchSpy.mockRestore();
    });
  });

  describe('status.ts', () => {
    it('returns 500 if SESSION_SECRET is missing', async () => {
      Object.assign(env, { SESSION_SECRET: '' });
      const context = { request: new Request('https://cms.pouta.local/api/subscription/status') } as any;

      const response = await statusGET(context);
      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('SESSION_SECRET not set');
    });

    it('returns 401 if session cookie is missing or invalid', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockRejectedValue(new Error('Session expired'));
      const context = { request: new Request('https://cms.pouta.local/api/subscription/status') } as any;

      const response = await statusGET(context);
      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Unauthorized');

      verifySpy.mockRestore();
    });

    it('returns 400 if repo path parameter is missing or invalid', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const context = { request: new Request('https://cms.pouta.local/api/subscription/status?repo=invalidpath') } as any;

      const response = await statusGET(context);
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Missing or invalid "repo"');

      verifySpy.mockRestore();
    });

    it('returns 403 if the user is not a push-collaborator on the repository', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(false);
      const context = { request: new Request('https://cms.pouta.local/api/subscription/status?repo=owner/repo') } as any;

      const response = await statusGET(context);
      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Forbidden');

      verifySpy.mockRestore();
      collabSpy.mockRestore();
    });

    it('bypasses D1 lookup and returns active status if PAYWALL_ENABLED is false', async () => {
      Object.assign(env, { PAYWALL_ENABLED: 'false' });
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
      const context = { request: new Request('https://cms.pouta.local/api/subscription/status?repo=owner/repo') } as any;

      const response = await statusGET(context);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.active).toBe(true);

      verifySpy.mockRestore();
      collabSpy.mockRestore();
    });

    it('returns 500 if DB binding is missing when PAYWALL_ENABLED is true', async () => {
      Object.assign(env, { DB: undefined });
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
      const context = { request: new Request('https://cms.pouta.local/api/subscription/status?repo=owner/repo') } as any;

      const response = await statusGET(context);
      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('Missing DB binding');

      verifySpy.mockRestore();
      collabSpy.mockRestore();
    });

    it('queries D1 database and returns subscription details when active', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
      
      const expiresAt = Math.floor(Date.now() / 1000) + 10000;
      mockDb.first.mockResolvedValueOnce({
        status: 'active',
        expires_at: expiresAt,
      });

      const context = { request: new Request('https://cms.pouta.local/api/subscription/status?repo=owner/repo') } as any;
      const response = await statusGET(context);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.active).toBe(true);
      expect(data.tier).toBe('pro');
      expect(data.expiresAt).toBe(expiresAt);
      expect(data.checkoutUrl).toContain('client_reference_id=b3duZXIvcmVwbw'); // owner/repo in base64url

      verifySpy.mockRestore();
      collabSpy.mockRestore();
    });

    it('returns 530/503 if D1 database lookup fails with an exception', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
      
      mockDb.first.mockRejectedValueOnce(new Error('D1 connection failure'));

      const context = { request: new Request('https://cms.pouta.local/api/subscription/status?repo=owner/repo') } as any;
      const response = await statusGET(context);
      expect(response.status).toBe(503);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('D1 lookup failed');

      verifySpy.mockRestore();
      collabSpy.mockRestore();
    });

    it('returns 500 if Stripe configurations are missing', async () => {
      Object.assign(env, { STRIPE_PAYMENT_LINK: '', STRIPE_PORTAL_LINK: '' });
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
      mockDb.first.mockResolvedValueOnce({ status: 'active', expires_at: 999999999 });

      const context = { request: new Request('https://cms.pouta.local/api/subscription/status?repo=owner/repo') } as any;
      const response = await statusGET(context);
      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('Missing Stripe configuration');

      verifySpy.mockRestore();
      collabSpy.mockRestore();
    });

    it('uses fallback checkout URL logic when STRIPE_PAYMENT_LINK is not a valid URL', async () => {
      Object.assign(env, { STRIPE_PAYMENT_LINK: 'invalid-payment-link' });
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
      mockDb.first.mockResolvedValueOnce({ status: 'active', expires_at: 9999999999 });

      const context = { request: new Request('https://cms.pouta.local/api/subscription/status?repo=owner/repo') } as any;
      const response = await statusGET(context);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.checkoutUrl).toBe('invalid-payment-link?client_reference_id=b3duZXIvcmVwbw');

      verifySpy.mockRestore();
      collabSpy.mockRestore();
    });

    it('returns 500 when an unexpected error occurs in status handler', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockRejectedValue(new Error('Unexpected status crash'));

      const context = { request: new Request('https://cms.pouta.local/api/subscription/status?repo=owner/repo') } as any;
      const response = await statusGET(context);
      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toBe('Unexpected status crash');

      verifySpy.mockRestore();
      collabSpy.mockRestore();
    });

    it('returns free tier and active false if no subscription queryResult is found in D1', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockResolvedValue(true);
      
      mockDb.first.mockResolvedValueOnce(null);

      const context = { request: new Request('https://cms.pouta.local/api/subscription/status?repo=owner/repo') } as any;
      const response = await statusGET(context);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.active).toBe(false);
      expect(data.tier).toBe('free');
      expect(data.expiresAt).toBeNull();

      verifySpy.mockRestore();
      collabSpy.mockRestore();
    });

    it('returns internal error fallback error message when status GET throws a string', async () => {
      const verifySpy = vi.spyOn(auth, 'verifySession').mockResolvedValue('token');
      const collabSpy = vi.spyOn(auth, 'verifyCollaborator').mockRejectedValueOnce('Simulated string status crash');

      const context = { request: new Request('https://cms.pouta.local/api/subscription/status?repo=owner/repo') } as any;
      const response = await statusGET(context);
      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('Failed to retrieve subscription status.');

      verifySpy.mockRestore();
      collabSpy.mockRestore();
    });
  });

  describe('stripe.ts', () => {
    const validRawBody = JSON.stringify({
      type: 'checkout.session.completed',
      data: {
        object: {
          client_reference_id: 'b3duZXIvcmVwbw==', // 'owner/repo' in base64
          customer: 'cus_123',
          subscription: 'sub_456',
        },
      },
    });

    it('returns 500 if DB is missing', async () => {
      Object.assign(env, { DB: undefined });
      const context = { request: new Request('https://cms.pouta.local/api/webhooks/stripe', { method: 'POST' }) } as any;
      const response = await stripePOST(context);
      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.success).toBe(false);
    });

    it('returns 401 if Stripe-Signature or STRIPE_WEBHOOK_SECRET are missing', async () => {
      Object.assign(env, { STRIPE_WEBHOOK_SECRET: '' });
      const context = {
        request: new Request('https://cms.pouta.local/api/webhooks/stripe', {
          method: 'POST',
          body: validRawBody,
        }),
      } as any;
      const response = await stripePOST(context);
      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Unauthorized');
    });

    it('returns 401 if signature validation fails', async () => {
      const now = Math.floor(Date.now() / 1000);
      const context = {
        request: new Request('https://cms.pouta.local/api/webhooks/stripe', {
          method: 'POST',
          headers: { 'Stripe-Signature': `t=${now},v1=${'0'.repeat(64)}` },
          body: validRawBody,
        }),
      } as any;
      const response = await stripePOST(context);
      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('Unauthorized: Invalid Stripe signature.');
    });

    it('returns 401 if signature is expired outside tolerance', async () => {
      const context = {
        request: new Request('https://cms.pouta.local/api/webhooks/stripe', {
          method: 'POST',
          headers: { 'Stripe-Signature': `t=123,v1=${'0'.repeat(64)}` },
          body: validRawBody,
        }),
      } as any;
      const response = await stripePOST(context);
      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('Unauthorized: Invalid Stripe signature.');
    });

    it('processes checkout.session.completed event successfully', async () => {
      // Mock signature validation to return true
      const now = Math.floor(Date.now() / 1000);
      const cryptoSpy = vi.spyOn(crypto.subtle, 'importKey').mockResolvedValue({} as CryptoKey);
      const verifySpy = vi.spyOn(crypto.subtle, 'verify').mockResolvedValue(true);

      const context = {
        request: new Request('https://cms.pouta.local/api/webhooks/stripe', {
          method: 'POST',
          headers: { 'Stripe-Signature': `t=${now},v1=validsig` },
          body: validRawBody,
        }),
      } as any;

      mockDb.run.mockResolvedValueOnce({ success: true });

      const response = await stripePOST(context);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);

      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO subscriptions'));

      cryptoSpy.mockRestore();
      verifySpy.mockRestore();
    });

    it('processes checkout.session.completed with fallback repository locations', async () => {
      const now = Math.floor(Date.now() / 1000);
      const cryptoSpy = vi.spyOn(crypto.subtle, 'importKey').mockResolvedValue({} as CryptoKey);
      const verifySpy = vi.spyOn(crypto.subtle, 'verify').mockResolvedValue(true);

      const fallbackBody = JSON.stringify({
        type: 'checkout.session.completed',
        data: {
          object: {
            metadata: {
              repo_path: 'owner/metadata-repo',
            },
            customer: 'cus_123',
            subscription: 'sub_456',
          },
        },
      });

      const context = {
        request: new Request('https://cms.pouta.local/api/webhooks/stripe', {
          method: 'POST',
          headers: { 'Stripe-Signature': `t=${now},v1=validsig` },
          body: fallbackBody,
        }),
      } as any;

      const response = await stripePOST(context);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);

      cryptoSpy.mockRestore();
      verifySpy.mockRestore();
    });

    it('skips checkout upgrade warning if no repository path is resolved at all', async () => {
      const now = Math.floor(Date.now() / 1000);
      const cryptoSpy = vi.spyOn(crypto.subtle, 'importKey').mockResolvedValue({} as CryptoKey);
      const verifySpy = vi.spyOn(crypto.subtle, 'verify').mockResolvedValue(true);

      const noRepoBody = JSON.stringify({
        type: 'checkout.session.completed',
        data: {
          object: {
            custom_fields: [
              {
                key: 'some_random_key',
                label: { custom: 'Some Custom Field' },
                text: { value: 'some value' },
              },
            ],
            customer: 'cus_123',
            subscription: 'sub_456',
          },
        },
      });

      const context = {
        request: new Request('https://cms.pouta.local/api/webhooks/stripe', {
          method: 'POST',
          headers: { 'Stripe-Signature': `t=${now},v1=validsig` },
          body: noRepoBody,
        }),
      } as any;

      const response = await stripePOST(context);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.warning).toContain('Missing client_reference_id');

      cryptoSpy.mockRestore();
      verifySpy.mockRestore();
    });

    it('processes customer.subscription.updated and customer.subscription.deleted events', async () => {
      const now = Math.floor(Date.now() / 1000);
      const cryptoSpy = vi.spyOn(crypto.subtle, 'importKey').mockResolvedValue({} as CryptoKey);
      const verifySpy = vi.spyOn(crypto.subtle, 'verify').mockResolvedValue(true);

      const updateBody = JSON.stringify({
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_456',
            status: 'active',
            current_period_end: now + 86400,
          },
        },
      });

      const deleteBody = JSON.stringify({
        type: 'customer.subscription.deleted',
        data: {
          object: {
            id: 'sub_456',
          },
        },
      });

      // Test subscription updated
      const contextUpdate = {
        request: new Request('https://cms.pouta.local/api/webhooks/stripe', {
          method: 'POST',
          headers: { 'Stripe-Signature': `t=${now},v1=validsig` },
          body: updateBody,
        }),
      } as any;
      let response = await stripePOST(contextUpdate);
      expect(response.status).toBe(200);

      // Test subscription deleted
      const contextDelete = {
        request: new Request('https://cms.pouta.local/api/webhooks/stripe', {
          method: 'POST',
          headers: { 'Stripe-Signature': `t=${now},v1=validsig` },
          body: deleteBody,
        }),
      } as any;
      response = await stripePOST(contextDelete);
      expect(response.status).toBe(200);

      cryptoSpy.mockRestore();
      verifySpy.mockRestore();
    });

    it('handles base64 decoding errors for client_reference_id during checkout completion', async () => {
      const now = Math.floor(Date.now() / 1000);
      const cryptoSpy = vi.spyOn(crypto.subtle, 'importKey').mockResolvedValue({} as CryptoKey);
      const verifySpy = vi.spyOn(crypto.subtle, 'verify').mockResolvedValue(true);

      const invalidBase64Body = JSON.stringify({
        type: 'checkout.session.completed',
        data: {
          object: {
            client_reference_id: 'invalidbase64!!!',
            customer: 'cus_123',
            subscription: 'sub_456',
          },
        },
      });

      const context = {
        request: new Request('https://cms.pouta.local/api/webhooks/stripe', {
          method: 'POST',
          headers: { 'Stripe-Signature': `t=${now},v1=validsig` },
          body: invalidBase64Body,
        }),
      } as any;

      mockDb.run.mockResolvedValueOnce({ success: true });

      const response = await stripePOST(context);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);

      cryptoSpy.mockRestore();
      verifySpy.mockRestore();
    });

    it('returns 500 when an unexpected exception occurs during webhook processing', async () => {
      const now = Math.floor(Date.now() / 1000);
      const cryptoSpy = vi.spyOn(crypto.subtle, 'importKey').mockResolvedValue({} as CryptoKey);
      const verifySpy = vi.spyOn(crypto.subtle, 'verify').mockResolvedValue(true);

      mockDb.prepare.mockImplementationOnce(() => {
        throw new Error('Database connection lost');
      });

      const context = {
        request: new Request('https://cms.pouta.local/api/webhooks/stripe', {
          method: 'POST',
          headers: { 'Stripe-Signature': `t=${now},v1=validsig` },
          body: validRawBody,
        }),
      } as any;

      const response = await stripePOST(context);
      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('Database connection lost');

      cryptoSpy.mockRestore();
      verifySpy.mockRestore();
    });

    it('processes checkout.session.completed with custom fields fallback repository path', async () => {
      const now = Math.floor(Date.now() / 1000);
      const cryptoSpy = vi.spyOn(crypto.subtle, 'importKey').mockResolvedValue({} as CryptoKey);
      const verifySpy = vi.spyOn(crypto.subtle, 'verify').mockResolvedValue(true);

      const customFieldsBody = JSON.stringify({
        type: 'checkout.session.completed',
        data: {
          object: {
            custom_fields: [
              {
                key: 'repo_path',
                text: {
                  value: 'owner/custom-fields-repo',
                },
              },
            ],
            customer: 'cus_123',
            subscription: 'sub_456',
          },
        },
      });

      const context = {
        request: new Request('https://cms.pouta.local/api/webhooks/stripe', {
          method: 'POST',
          headers: { 'Stripe-Signature': `t=${now},v1=validsig` },
          body: customFieldsBody,
        }),
      } as any;

      mockDb.run.mockResolvedValueOnce({ success: true });

      const response = await stripePOST(context);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);

      cryptoSpy.mockRestore();
      verifySpy.mockRestore();
    });

    it('decodes base64url client_reference_id successfully even if padding is missing', async () => {
      const now = Math.floor(Date.now() / 1000);
      const cryptoSpy = vi.spyOn(crypto.subtle, 'importKey').mockResolvedValue({} as CryptoKey);
      const verifySpy = vi.spyOn(crypto.subtle, 'verify').mockResolvedValue(true);

      // 'owner/repo' base64 without padding '==' is 'b3duZXIvcmVwbw' (length 14)
      const paddingMissingBody = JSON.stringify({
        type: 'checkout.session.completed',
        data: {
          object: {
            client_reference_id: 'b3duZXIvcmVwbw',
            customer: 'cus_123',
            subscription: 'sub_456',
          },
        },
      });

      const context = {
        request: new Request('https://cms.pouta.local/api/webhooks/stripe', {
          method: 'POST',
          headers: { 'Stripe-Signature': `t=${now},v1=validsig` },
          body: paddingMissingBody,
        }),
      } as any;

      mockDb.run.mockResolvedValueOnce({ success: true });

      const response = await stripePOST(context);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);

      cryptoSpy.mockRestore();
      verifySpy.mockRestore();
    });

    it('handles signature verification errors by returning false', async () => {
      const now = Math.floor(Date.now() / 1000);
      const cryptoSpy = vi.spyOn(crypto.subtle, 'importKey').mockRejectedValueOnce(new Error('Import key crash'));

      const context = {
        request: new Request('https://cms.pouta.local/api/webhooks/stripe', {
          method: 'POST',
          headers: { 'Stripe-Signature': `t=${now},v1=validsig` },
          body: validRawBody,
        }),
      } as any;

      const response = await stripePOST(context);
      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('Unauthorized: Invalid Stripe signature.');

      cryptoSpy.mockRestore();
    });

    it('processes checkout.session.completed with client_reference_id and repo fallbacks in metadata and custom fields', async () => {
      const now = Math.floor(Date.now() / 1000);
      const cryptoSpy = vi.spyOn(crypto.subtle, 'importKey').mockResolvedValue({} as CryptoKey);
      const verifySpy = vi.spyOn(crypto.subtle, 'verify').mockResolvedValue(true);

      const metadataRefBody = JSON.stringify({
        type: 'checkout.session.completed',
        data: {
          object: {
            metadata: {
              client_reference_id: 'owner/metadata-ref-repo',
            },
            customer: 'cus_123',
            subscription: 'sub_456',
          },
        },
      });

      const context1 = {
        request: new Request('https://cms.pouta.local/api/webhooks/stripe', {
          method: 'POST',
          headers: { 'Stripe-Signature': `t=${now},v1=validsig` },
          body: metadataRefBody,
        }),
      } as any;

      mockDb.run.mockResolvedValueOnce({ success: true });
      let response = await stripePOST(context1);
      expect(response.status).toBe(200);

      const metadataRepoBody = JSON.stringify({
        type: 'checkout.session.completed',
        data: {
          object: {
            metadata: {
              repo: 'owner/metadata-repo-fallback',
            },
            customer: 'cus_123',
            subscription: 'sub_456',
          },
        },
      });

      const context2 = {
        request: new Request('https://cms.pouta.local/api/webhooks/stripe', {
          method: 'POST',
          headers: { 'Stripe-Signature': `t=${now},v1=validsig` },
          body: metadataRepoBody,
        }),
      } as any;

      mockDb.run.mockResolvedValueOnce({ success: true });
      response = await stripePOST(context2);
      expect(response.status).toBe(200);

      const customFieldRepoBody = JSON.stringify({
        type: 'checkout.session.completed',
        data: {
          object: {
            custom_fields: [
              {
                key: 'repository',
                text: { value: 'owner/custom-fields-repository' },
              },
            ],
            customer: 'cus_123',
            subscription: 'sub_456',
          },
        },
      });

      const context3 = {
        request: new Request('https://cms.pouta.local/api/webhooks/stripe', {
          method: 'POST',
          headers: { 'Stripe-Signature': `t=${now},v1=validsig` },
          body: customFieldRepoBody,
        }),
      } as any;

      mockDb.run.mockResolvedValueOnce({ success: true });
      response = await stripePOST(context3);
      expect(response.status).toBe(200);

      const customFieldLabelBody = JSON.stringify({
        type: 'checkout.session.completed',
        data: {
          object: {
            custom_fields: [
              {
                key: 'alternative_key',
                label: { custom: 'Repository' },
                text: { value: 'owner/custom-label-repo' },
              },
            ],
            customer: 'cus_123',
            subscription: 'sub_456',
          },
        },
      });

      const context4 = {
        request: new Request('https://cms.pouta.local/api/webhooks/stripe', {
          method: 'POST',
          headers: { 'Stripe-Signature': `t=${now},v1=validsig` },
          body: customFieldLabelBody,
        }),
      } as any;

      mockDb.run.mockResolvedValueOnce({ success: true });
      response = await stripePOST(context4);
      expect(response.status).toBe(200);

      const customFieldEmptyBody = JSON.stringify({
        type: 'checkout.session.completed',
        data: {
          object: {
            custom_fields: [
              {
                key: 'repository',
              },
            ],
            customer: 'cus_123',
            subscription: 'sub_456',
          },
        },
      });

      const context5 = {
        request: new Request('https://cms.pouta.local/api/webhooks/stripe', {
          method: 'POST',
          headers: { 'Stripe-Signature': `t=${now},v1=validsig` },
          body: customFieldEmptyBody,
        }),
      } as any;

      response = await stripePOST(context5);
      expect(response.status).toBe(200);

      cryptoSpy.mockRestore();
      verifySpy.mockRestore();
    });

    it('processes customer.subscription.updated with non-active status (past_due)', async () => {
      const now = Math.floor(Date.now() / 1000);
      const cryptoSpy = vi.spyOn(crypto.subtle, 'importKey').mockResolvedValue({} as CryptoKey);
      const verifySpy = vi.spyOn(crypto.subtle, 'verify').mockResolvedValue(true);

      const pastDueBody = JSON.stringify({
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_456',
            status: 'past_due',
            current_period_end: now + 86400,
          },
        },
      });

      const context = {
        request: new Request('https://cms.pouta.local/api/webhooks/stripe', {
          method: 'POST',
          headers: { 'Stripe-Signature': `t=${now},v1=validsig` },
          body: pastDueBody,
        }),
      } as any;

      mockDb.run.mockResolvedValueOnce({ success: true });
      const response = await stripePOST(context);
      expect(response.status).toBe(200);

      cryptoSpy.mockRestore();
      verifySpy.mockRestore();
    });

    it('returns internal error fallback error message when Stripe webhook GET throws a string', async () => {
      const now = Math.floor(Date.now() / 1000);
      const cryptoSpy = vi.spyOn(crypto.subtle, 'importKey').mockResolvedValue({} as CryptoKey);
      const verifySpy = vi.spyOn(crypto.subtle, 'verify').mockResolvedValue(true);

      mockDb.prepare.mockImplementationOnce(() => {
        throw 'Simulated string stripe crash';
      });

      const context = {
        request: new Request('https://cms.pouta.local/api/webhooks/stripe', {
          method: 'POST',
          headers: { 'Stripe-Signature': `t=${now},v1=validsig` },
          body: validRawBody,
        }),
      } as any;

      const response = await stripePOST(context);
      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('Webhook processing failed.');

      cryptoSpy.mockRestore();
      verifySpy.mockRestore();
    });

    it('returns 401 if Stripe-Signature lacks v1 signature parts', async () => {
      const now = Math.floor(Date.now() / 1000);
      const context = {
        request: new Request('https://cms.pouta.local/api/webhooks/stripe', {
          method: 'POST',
          headers: { 'Stripe-Signature': `t=${now}` },
          body: validRawBody,
        }),
      } as any;
      const response = await stripePOST(context);
      expect(response.status).toBe(401);
    });

    it('returns 401 if Stripe-Signature contains empty v1 parts', async () => {
      const now = Math.floor(Date.now() / 1000);
      const context = {
        request: new Request('https://cms.pouta.local/api/webhooks/stripe', {
          method: 'POST',
          headers: { 'Stripe-Signature': `t=${now},v1=` },
          body: validRawBody,
        }),
      } as any;
      const response = await stripePOST(context);
      expect(response.status).toBe(401);
    });

    it('processes checkout.session.completed with custom fields label containing repo but not repository', async () => {
      const now = Math.floor(Date.now() / 1000);
      const cryptoSpy = vi.spyOn(crypto.subtle, 'importKey').mockResolvedValue({} as CryptoKey);
      const verifySpy = vi.spyOn(crypto.subtle, 'verify').mockResolvedValue(true);

      const customFieldRepoBody = JSON.stringify({
        type: 'checkout.session.completed',
        data: {
          object: {
            custom_fields: [
              {
                key: 'alternative_key',
                label: { custom: 'My Repo Path' },
                text: { value: 'owner/label-repo-only' },
              },
            ],
            customer: 'cus_123',
            subscription: 'sub_456',
          },
        },
      });

      const context = {
        request: new Request('https://cms.pouta.local/api/webhooks/stripe', {
          method: 'POST',
          headers: { 'Stripe-Signature': `t=${now},v1=validsig` },
          body: customFieldRepoBody,
        }),
      } as any;

      mockDb.run.mockResolvedValueOnce({ success: true });
      const response = await stripePOST(context);
      expect(response.status).toBe(200);

      cryptoSpy.mockRestore();
      verifySpy.mockRestore();
    });

    it('skips processing and returns 200 ok for unhandled Stripe event types', async () => {
      const now = Math.floor(Date.now() / 1000);
      const cryptoSpy = vi.spyOn(crypto.subtle, 'importKey').mockResolvedValue({} as CryptoKey);
      const verifySpy = vi.spyOn(crypto.subtle, 'verify').mockResolvedValue(true);

      const unhandledEventBody = JSON.stringify({
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_123',
          },
        },
      });

      const context = {
        request: new Request('https://cms.pouta.local/api/webhooks/stripe', {
          method: 'POST',
          headers: { 'Stripe-Signature': `t=${now},v1=validsig` },
          body: unhandledEventBody,
        }),
      } as any;

      const response = await stripePOST(context);
      expect(response.status).toBe(200);

      cryptoSpy.mockRestore();
      verifySpy.mockRestore();
    });

    it('returns 401 if Stripe-Signature lacks timestamp t= part', async () => {
      const context = {
        request: new Request('https://cms.pouta.local/api/webhooks/stripe', {
          method: 'POST',
          headers: { 'Stripe-Signature': `v1=validsig` },
          body: validRawBody,
        }),
      } as any;
      const response = await stripePOST(context);
      expect(response.status).toBe(401);
    });

    it('returns 401 if Stripe-Signature timestamp is not a number', async () => {
      const context = {
        request: new Request('https://cms.pouta.local/api/webhooks/stripe', {
          method: 'POST',
          headers: { 'Stripe-Signature': `t=notanumber,v1=validsig` },
          body: validRawBody,
        }),
      } as any;
      const response = await stripePOST(context);
      expect(response.status).toBe(401);
    });

    it('returns 401 if Stripe-Signature contains non-hex v1 part', async () => {
      const now = Math.floor(Date.now() / 1000);
      const context = {
        request: new Request('https://cms.pouta.local/api/webhooks/stripe', {
          method: 'POST',
          headers: { 'Stripe-Signature': `t=${now},v1=???` },
          body: validRawBody,
        }),
      } as any;
      const response = await stripePOST(context);
      expect(response.status).toBe(401);
    });
  });
});
