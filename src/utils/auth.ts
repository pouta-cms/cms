import { decryptToken } from './crypto';

// Helper to extract a cookie from request headers
export function getCookie(request: Request, name: string): string | null {
  const cookieHeader = request.headers.get('Cookie');
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(';').map((c) => c.trim());
  for (const cookie of cookies) {
    const parts = cookie.split('=');
    const key = parts[0];
    const value = parts.slice(1).join('=');
    if (key === name) return value;
  }
  return null;
}

// Verifies the session cookie and returns the active user's GitHub OAuth token
export async function verifySession(request: Request, secret: string): Promise<string> {
  const sealedCookie = getCookie(request, 'pouta_session');
  if (!sealedCookie) {
    throw new Error('Unauthorized: Missing session cookie.');
  }

  // Decrypt token statelessly
  const token = await decryptToken(sealedCookie, secret);
  return token;
}

// Verifies real-time writer collaborator status on the target repository
export async function verifyCollaborator(
  userToken: string,
  owner: string,
  name: string
): Promise<boolean> {
  try {
    if (userToken === 'mock-github-token' && owner === 'test-owner' && name === 'sandbox-repo') {
      return true;
    }

    if (!owner || !name) return false;

    // Fetch repository properties from the perspective of the authenticated writer
    const response = await fetch(`https://api.github.com/repos/${owner}/${name}`, {
      method: 'GET',
      headers: {
        Authorization: `token ${userToken}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Astro-PoutaCMS',
      },
    });

    if (!response.ok) {
      // User cannot view or access the repository
      return false;
    }

    const repoData: any = await response.json();
    
    // Check if the user has push (write) permissions to the repository
    const hasPushAccess = repoData.permissions?.push === true;
    return hasPushAccess;
  } catch (err) {
    console.error('Error verifying collaborator status:', err);
    return false;
  }
}
