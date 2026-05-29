import { describe, it, expect, vi } from 'vitest';
import { generateAppJWT, getInstallationAccessToken } from '../../src/utils/githubApp';

describe('githubApp utility helpers', () => {
  const appId = '123456';
  const mockPrivateKey = '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC3\n-----END PRIVATE KEY-----';
  const installationId = '987654';

  it('generates a signed GitHub App JWT successfully', async () => {
    const mockKey = { type: 'private', extractable: false, algorithm: { name: 'RSASSA-PKCS1-v1_5' }, usages: ['sign'] } as unknown as CryptoKey;
    const importSpy = vi.spyOn(crypto.subtle, 'importKey').mockResolvedValue(mockKey);
    const signSpy = vi.spyOn(crypto.subtle, 'sign').mockResolvedValue(new Uint8Array([1, 2, 3, 4]).buffer);

    const jwt = await generateAppJWT(appId, mockPrivateKey);
    expect(jwt).toBeDefined();
    expect(jwt.split('.').length).toBe(3); // JWT contains header.payload.signature

    const [headerB64, payloadB64, signatureB64] = jwt.split('.');
    
    // Check header
    const header = JSON.parse(atob(headerB64));
    expect(header).toEqual({ alg: 'RS256', typ: 'JWT' });

    // Check payload
    // Base64 Url Decoder helper
    const base64UrlDecode = (str: string) => {
      let b64 = str.replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      return atob(b64);
    };
    const payload = JSON.parse(base64UrlDecode(payloadB64));
    expect(payload.iss).toBe(123456);
    expect(payload.iat).toBeLessThanOrEqual(Math.floor(Date.now() / 1000));
    expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));

    // Check mock signature decoding
    expect(base64UrlDecode(signatureB64)).toBeDefined();

    importSpy.mockRestore();
    signSpy.mockRestore();
  });

  it('throws a JWT generation failed error if importKey fails', async () => {
    const importSpy = vi.spyOn(crypto.subtle, 'importKey').mockRejectedValue(new Error('Invalid key format'));

    await expect(generateAppJWT(appId, mockPrivateKey)).rejects.toThrow('JWT generation failed');

    importSpy.mockRestore();
  });

  it('exchanges App JWT for an installation access token successfully', async () => {
    const mockKey = {} as CryptoKey;
    const importSpy = vi.spyOn(crypto.subtle, 'importKey').mockResolvedValue(mockKey);
    const signSpy = vi.spyOn(crypto.subtle, 'sign').mockResolvedValue(new Uint8Array([1]).buffer);

    const mockResponse = {
      ok: true,
      json: async () => ({ token: 'v1.githubinstallationtoken123456' }),
    } as Response;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse);

    const token = await getInstallationAccessToken(appId, mockPrivateKey, installationId);
    expect(token).toBe('v1.githubinstallationtoken123456');

    expect(fetchSpy).toHaveBeenCalledWith(
      `https://api.github.com/app/installations/${installationId}/access_tokens`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Accept: 'application/vnd.github+json',
          'User-Agent': 'Astro-PoutaCMS',
        }),
      })
    );

    importSpy.mockRestore();
    signSpy.mockRestore();
    fetchSpy.mockRestore();
  });

  it('throws an error if GitHub token exchange returns non-200 status', async () => {
    const mockKey = {} as CryptoKey;
    const importSpy = vi.spyOn(crypto.subtle, 'importKey').mockResolvedValue(mockKey);
    const signSpy = vi.spyOn(crypto.subtle, 'sign').mockResolvedValue(new Uint8Array([1]).buffer);

    const mockResponse = {
      ok: false,
      status: 403,
      text: async () => 'Forbidden installation access',
    } as Response;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse);

    await expect(getInstallationAccessToken(appId, mockPrivateKey, installationId)).rejects.toThrow(
      'GitHub Token Exchange HTTP 403: Forbidden installation access'
    );

    importSpy.mockRestore();
    signSpy.mockRestore();
    fetchSpy.mockRestore();
  });

  it('throws an error if GitHub response has 200 status but is missing the token property', async () => {
    const mockKey = {} as CryptoKey;
    const importSpy = vi.spyOn(crypto.subtle, 'importKey').mockResolvedValue(mockKey);
    const signSpy = vi.spyOn(crypto.subtle, 'sign').mockResolvedValue(new Uint8Array([1]).buffer);

    const mockResponse = {
      ok: true,
      json: async () => ({ unexpectedProperty: 'something' }),
    } as Response;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse);

    await expect(getInstallationAccessToken(appId, mockPrivateKey, installationId)).rejects.toThrow(
      'Access Token property was missing from GitHub response.'
    );

    importSpy.mockRestore();
    signSpy.mockRestore();
    fetchSpy.mockRestore();
  });

  it('throws a default error when catch block receives an error with no message property', async () => {
    const mockKey = {} as CryptoKey;
    const importSpy = vi.spyOn(crypto.subtle, 'importKey').mockResolvedValue(mockKey);
    const signSpy = vi.spyOn(crypto.subtle, 'sign').mockResolvedValue(new Uint8Array([1]).buffer);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce({});

    await expect(getInstallationAccessToken(appId, mockPrivateKey, installationId)).rejects.toThrow(
      'Token exchange failed'
    );

    importSpy.mockRestore();
    signSpy.mockRestore();
    fetchSpy.mockRestore();
  });
});
