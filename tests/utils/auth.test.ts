import { describe, it, expect, vi } from 'vitest';
import { getCookie, verifySession, verifyCollaborator } from '../../src/utils/auth';
import { encryptToken } from '../../src/utils/crypto';

describe('auth utility helpers', () => {
  const secret = 'super-secure-test-secret-at-least-32-chars';
  const token = 'gho_githuboauthsecrettoken1234567890';

  describe('getCookie', () => {
    it('returns null if there is no Cookie header', () => {
      const request = new Request('https://example.com/');
      expect(getCookie(request, 'pouta_session')).toBeNull();
    });

    it('returns the cookie value if it exists', () => {
      const request = new Request('https://example.com/', {
        headers: {
          Cookie: 'other_cookie=value1; pouta_session=my_session_value; third=val3',
        },
      });
      expect(getCookie(request, 'pouta_session')).toBe('my_session_value');
    });

    it('returns null if the requested cookie does not exist', () => {
      const request = new Request('https://example.com/', {
        headers: {
          Cookie: 'other_cookie=value1; third=val3',
        },
      });
      expect(getCookie(request, 'pouta_session')).toBeNull();
    });
  });

  describe('verifySession', () => {
    it('throws an error if the session cookie is missing', async () => {
      const request = new Request('https://example.com/');
      await expect(verifySession(request, secret)).rejects.toThrow('Unauthorized: Missing session cookie.');
    });

    it('decrypts and returns the token from a valid session cookie', async () => {
      const sealedCookie = await encryptToken(token, secret);
      const request = new Request('https://example.com/', {
        headers: {
          Cookie: `pouta_session=${sealedCookie}`,
        },
      });

      const verified = await verifySession(request, secret);
      expect(verified).toBe(token);
    });
  });

  describe('verifyCollaborator', () => {
    const owner = 'testowner';
    const name = 'testrepo';

    it('returns false if owner or name is missing', async () => {
      expect(await verifyCollaborator(token, '', name)).toBe(false);
      expect(await verifyCollaborator(token, owner, '')).toBe(false);
    });

    it('returns true if the user has push permissions on the repository', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          permissions: {
            push: true,
          },
        }),
      } as Response;
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse);

      const isCollaborator = await verifyCollaborator(token, owner, name);
      expect(isCollaborator).toBe(true);

      expect(fetchSpy).toHaveBeenCalledWith(`https://api.github.com/repos/${owner}/${name}`, {
        method: 'GET',
        headers: {
          Authorization: `token ${token}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'Astro-PoutaCMS',
        },
      });

      fetchSpy.mockRestore();
    });

    it('returns false if the user does not have push permissions on the repository', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          permissions: {
            push: false,
          },
        }),
      } as Response;
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse);

      const isCollaborator = await verifyCollaborator(token, owner, name);
      expect(isCollaborator).toBe(false);

      fetchSpy.mockRestore();
    });

    it('returns false if the GitHub API request is not successful (e.g. 404 or 401)', async () => {
      const mockResponse = {
        ok: false,
        status: 404,
      } as Response;
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse);

      const isCollaborator = await verifyCollaborator(token, owner, name);
      expect(isCollaborator).toBe(false);

      fetchSpy.mockRestore();
    });

    it('returns false and logs the error if fetching throws an exception', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'));

      const isCollaborator = await verifyCollaborator(token, owner, name);
      expect(isCollaborator).toBe(false);
      expect(consoleSpy).toHaveBeenCalled();

      fetchSpy.mockRestore();
      consoleSpy.mockRestore();
    });
  });
});
