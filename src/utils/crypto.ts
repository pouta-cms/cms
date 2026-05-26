// Derives a high-entropy AES-GCM CryptoKey from a secret passphrase
async function getCryptoKey(secret: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const rawKey = enc.encode(secret || 'default-fallback-pouta-key-32-chars-minimum');
  const hash = await crypto.subtle.digest('SHA-256', rawKey);
  return crypto.subtle.importKey(
    'raw',
    hash,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
}

// Encrypts a session token string statelessly
export async function encryptToken(token: string, secret: string): Promise<string> {
  try {
    const key = await getCryptoKey(secret);
    const enc = new TextEncoder();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      enc.encode(token)
    );

    // Safe base64 encoding helper
    const ivBase64 = btoa(Array.from(iv).map(b => String.fromCharCode(b)).join(''));
    const ciphertextBase64 = btoa(
      Array.from(new Uint8Array(encrypted))
        .map(b => String.fromCharCode(b))
        .join('')
    );

    return `${ivBase64}:${ciphertextBase64}`;
  } catch (error) {
    console.error('Session encryption failed:', error);
    throw new Error('Encryption failure');
  }
}

// Decrypts a secure session token string
export async function decryptToken(encryptedString: string, secret: string): Promise<string> {
  try {
    const parts = encryptedString.split(':');
    if (parts.length !== 2) {
      throw new Error('Invalid encrypted session string format');
    }

    const [ivBase64, ciphertextBase64] = parts;
    const iv = new Uint8Array(
      atob(ivBase64)
        .split('')
        .map(c => c.charCodeAt(0))
    );
    const ciphertext = new Uint8Array(
      atob(ciphertextBase64)
        .split('')
        .map(c => c.charCodeAt(0))
    );

    const key = await getCryptoKey(secret);
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    );

    const dec = new TextDecoder();
    return dec.decode(decrypted);
  } catch (error) {
    console.error('Session decryption failed:', error);
    throw new Error('Decryption failure');
  }
}
