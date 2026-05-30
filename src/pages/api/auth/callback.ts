import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { encryptToken } from '../../../utils/crypto';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  try {
    const url = new URL(request.url);
    const code = url.searchParams.get('code');

    const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';

    if (isLocalhost && code === 'mock-e2e-code') {
      const sessionSecret = env.SESSION_SECRET || 'default-fallback-pouta-key-32-chars-minimum';
      const sealedCookie = await encryptToken('mock-github-token', sessionSecret);
      const maxAge = 60 * 60 * 24 * 30; // 30 days
      const cookieHeader = `pouta_session=${sealedCookie}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
      const adminPanelUrl = `${url.origin}/`;
      return new Response(null, {
        status: 302,
        headers: {
          Location: adminPanelUrl,
          'Set-Cookie': cookieHeader,
        },
      });
    }

    if (!code) {
      return new Response(
        JSON.stringify({ success: false, error: 'OAuth code missing from authorization redirect.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const clientId = env.GITHUB_CLIENT_ID;
    const clientSecret = env.GITHUB_CLIENT_SECRET;
    const sessionSecret = env.SESSION_SECRET || 'default-fallback-pouta-key-32-chars-minimum';

    if (!clientId || !clientSecret) {
      return new Response(
        JSON.stringify({ success: false, error: 'GitHub OAuth Client credentials not configured.' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Exchange the code for an Access Token
    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'Astro-PoutaCMS',
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
      }),
    });

    if (!tokenResponse.ok) {
      throw new Error(`GitHub token exchange failed: ${await tokenResponse.text()}`);
    }

    const data: any = await tokenResponse.json();

    if (data.error) {
      return new Response(
        JSON.stringify({ success: false, error: data.error_description || data.error }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const accessToken = data.access_token;
    if (!accessToken) {
      throw new Error('Access Token was not returned by GitHub oauth server.');
    }

    // Statelessly encrypt the token using Web Crypto AES-GCM
    const sealedCookie = await encryptToken(accessToken, sessionSecret);

    // Build the HTTP-Only cookie header (Secure, SameSite=Lax, Max-Age = 30 days)
    const maxAge = 60 * 60 * 24 * 30; // 30 days
    const cookieHeader = `pouta_session=${sealedCookie}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

    // Redirect user back to our CMS administration panel
    const adminPanelUrl = `${url.origin}/`;
    return new Response(null, {
      status: 302,
      headers: {
        Location: adminPanelUrl,
        'Set-Cookie': cookieHeader,
      },
    });
  } catch (error: any) {
    return new Response(
      `<html><body><h3>Authentication Error</h3><p>${
        error.message || 'An unexpected error occurred during GitHub callback authentication.'
      }</p><a href="/">Return to dashboard</a></body></html>`,

      {
        status: 500,
        headers: { 'Content-Type': 'text/html' },
      }
    );
  }
};
