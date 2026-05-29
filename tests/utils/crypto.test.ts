import { describe, it, expect, vi } from 'vitest';
import { encryptToken, decryptToken } from '../../src/utils/crypto';

describe('crypto session helpers', () => {
  const secret = 'super-secure-test-secret-at-least-32-chars';
  const token = 'gho_githuboauthsecrettoken1234567890';

  it('can encrypt and decrypt a token successfully', async () => {
    const encrypted = await encryptToken(token, secret);
    expect(encrypted).toContain(':');
    
    const [iv, cipher] = encrypted.split(':');
    expect(iv.length).toBeGreaterThan(0);
    expect(cipher.length).toBeGreaterThan(0);

    const decrypted = await decryptToken(encrypted, secret);
    expect(decrypted).toBe(token);
  });

  it('throws an error if empty or whitespace-only secret is provided to encrypt or decrypt', async () => {
    await expect(encryptToken(token, '')).rejects.toThrow('missing encryption secret');
    await expect(decryptToken('some-encrypted-token', '')).rejects.toThrow('missing encryption secret');
    await expect(encryptToken(token, '   ')).rejects.toThrow('missing encryption secret');
    await expect(decryptToken('some-encrypted-token', '   ')).rejects.toThrow('missing encryption secret');
  });

  it('throws an error if decryption is attempted with a different secret', async () => {
    const encrypted = await encryptToken(token, secret);
    await expect(decryptToken(encrypted, 'different-secret-key-that-is-not-correct')).rejects.toThrow('Decryption failure');
  });

  it('throws an error if decryption string format is invalid', async () => {
    await expect(decryptToken('invalidformatnosign', secret)).rejects.toThrow('Decryption failure');
  });

  it('throws an error if ciphertext or IV are corrupted', async () => {
    const encrypted = await encryptToken(token, secret);
    const parts = encrypted.split(':');
    // Corrupt the ciphertext by appending garbage
    const corrupted = `${parts[0]}:corruptedciphertext`;
    await expect(decryptToken(corrupted, secret)).rejects.toThrow('Decryption failure');
  });

  it('throws an error if encryption fails internally', async () => {
    const encryptSpy = vi.spyOn(crypto.subtle, 'encrypt').mockRejectedValueOnce(new Error('Internal cipher error'));
    
    await expect(encryptToken(token, secret)).rejects.toThrow('Encryption failure');

    encryptSpy.mockRestore();
  });
});
