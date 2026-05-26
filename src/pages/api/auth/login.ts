import type { APIRoute } from 'astro';

export const prerender = false;

export const GET: APIRoute = async ({ request, locals }) => {
  const env = (locals as any).runtime?.env || {};
  const clientId = env.GITHUB_CLIENT_ID;

  if (!clientId || clientId === 'placeholder_github_client_id') {
    return new Response(
      JSON.stringify({
        success: false,
        error: 'GitHub OAuth Client ID is not configured in environment settings.',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Dynamically resolve callback endpoint relative to active host URL (works locally & on CDN)
  const hostUrl = new URL(request.url);
  const redirectUri = `${hostUrl.origin}/api/auth/callback`;

  // Request 'repo' for committing files and 'user' to read their avatar/profile info
  const githubAuthUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(
    redirectUri
  )}&scope=repo,user&state=${Math.random().toString(36).substring(2, 12)}`;

  return Response.redirect(githubAuthUrl, 302);
};
