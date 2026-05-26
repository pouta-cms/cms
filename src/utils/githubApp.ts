// Helper to convert dynamic Base64 to ArrayBuffer (safe UTF-8)
function base64ToArrayBuffer(b64: string): ArrayBuffer {
  // Strip any whitespace, newlines or PEM tags if present
  const cleaned = b64
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
    
  const binaryString = atob(cleaned);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

// URL-safe Base64 encoding helper for JWT components
function base64UrlEncode(str: string | ArrayBuffer): string {
  let binary = '';
  if (typeof str === 'string') {
    const enc = new TextEncoder();
    const bytes = enc.encode(str);
    binary = Array.from(bytes).map(b => String.fromCharCode(b)).join('');
  } else {
    binary = Array.from(new Uint8Array(str)).map(b => String.fromCharCode(b)).join('');
  }
  
  return btoa(binary)
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

// Imports the PKCS#8 private RSA key for signing
async function importPrivateKey(pemB64: string): Promise<CryptoKey> {
  const binaryKey = base64ToArrayBuffer(pemB64);
  return crypto.subtle.importKey(
    'pkcs8',
    binaryKey,
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: { name: 'SHA-256' },
    },
    false,
    ['sign']
  );
}

// Generates the GitHub App JSON Web Token (JWT) statelessly on the edge
export async function generateAppJWT(appId: string, privateKeyB64: string): Promise<string> {
  try {
    const key = await importPrivateKey(privateKeyB64);
    
    // Header specifying RS256 algorithm
    const header = JSON.stringify({ alg: 'RS256', typ: 'JWT' });
    
    // Payload (GitHub App JWTs can have a maximum lifespan of 10 minutes)
    const now = Math.floor(Date.now() / 1000);
    const payload = JSON.stringify({
      iat: now - 60,            // Issued at (offset by 60s for clock skew)
      exp: now + 540,           // Expires in 9 minutes
      iss: Number(appId),       // App ID
    });

    const headerB64Url = base64UrlEncode(header);
    const payloadB64Url = base64UrlEncode(payload);
    
    const message = `${headerB64Url}.${payloadB64Url}`;
    const enc = new TextEncoder();
    const messageBytes = enc.encode(message);

    // Cryptographic RS256 Signature
    const signature = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      key,
      messageBytes
    );

    const signatureB64Url = base64UrlEncode(signature);
    return `${message}.${signatureB64Url}`;
  } catch (error) {
    console.error('Failed to generate GitHub App JWT:', error);
    throw new Error('JWT generation failed');
  }
}

// Exchanges App JWT for a temporary (1 hour) repository Installation Access Token
export async function getInstallationAccessToken(
  appId: string,
  privateKeyB64: string,
  installationId: string
): Promise<string> {
  try {
    // 1. Generate active App JWT
    const jwt = await generateAppJWT(appId, privateKeyB64);

    // 2. Fetch installation token
    const tokenUrl = `https://api.github.com/app/installations/${installationId}/access_tokens`;
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Astro-PoutaCMS',
      },
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`GitHub Token Exchange HTTP ${response.status}: ${errText}`);
    }

    const data: any = await response.json();
    if (!data.token) {
      throw new Error('Access Token property was missing from GitHub response.');
    }

    return data.token;
  } catch (error: any) {
    console.error('Failed to fetch installation access token:', error);
    throw new Error(error.message || 'Token exchange failed');
  }
}
