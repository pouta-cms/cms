import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { decryptToken } from '../../../utils/crypto';

export const prerender = false;

// Helper to extract a cookie value from headers
function getCookie(request: Request, name: string): string | null {
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

export const GET: APIRoute = async ({ request }) => {
  try {
    const sealedCookie = getCookie(request, 'pouta_session');

    if (!sealedCookie) {
      return new Response(JSON.stringify({ authenticated: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const sessionSecret = env.SESSION_SECRET || 'default-fallback-pouta-key-32-chars-minimum';

    // Decrypt token statelessly
    let token = '';
    try {
      token = await decryptToken(sealedCookie, sessionSecret);
    } catch (e) {
      // Cookie is invalid or corrupted, return unauthenticated
      return new Response(JSON.stringify({ authenticated: false, error: 'Session cookie corrupted.' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (token === 'mock-github-token') {
      return new Response(
        JSON.stringify({
          authenticated: true,
          username: 'mock-e2e-writer',
          name: 'E2E Test Writer',
          avatar_url: 'https://avatars.githubusercontent.com/u/9919?v=4',
          html_url: 'https://github.com/mock-e2e-writer',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Fetch user profile from GitHub
    const userResponse = await fetch('https://api.github.com/user', {
      method: 'GET',
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Astro-PoutaCMS',
      },
    });

    if (!userResponse.ok) {
      // Token has expired or been revoked
      return new Response(JSON.stringify({ authenticated: false, error: 'OAuth session token expired.' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const userData: any = await userResponse.json();

    return new Response(
      JSON.stringify({
        authenticated: true,
        username: userData.login,
        name: userData.name || userData.login,
        avatar_url: userData.avatar_url,
        html_url: userData.html_url,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({
        authenticated: false,
        error: error.message || 'An internal error occurred during profile verification.',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
