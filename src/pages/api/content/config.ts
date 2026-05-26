import type { APIRoute } from 'astro';
import { verifySession, verifyCollaborator } from '../../../utils/auth';
import { getInstallationAccessToken } from '../../../utils/githubApp';

export const prerender = false;

export const GET: APIRoute = async ({ request, locals }) => {
  try {
    const url = new URL(request.url);
    const repoFullName = url.searchParams.get('repo');
    const installationId = url.searchParams.get('installationId');

    if (!repoFullName || !installationId) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Missing required query parameters: repo and installationId are mandatory.',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const [owner, name] = repoFullName.split('/');
    if (!owner || !name) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid repository name format.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const env = (locals as any).runtime?.env || {};
    const sessionSecret = env.SESSION_SECRET || 'default-fallback-pouta-key-32-chars-minimum';
    const appId = env.GITHUB_APP_ID;
    const privateKeyB64 = env.GITHUB_APP_PRIVATE_KEY_B64;

    // 1. Verify stateless session cookie
    let userToken = '';
    try {
      userToken = await verifySession(request, sessionSecret);
    } catch (e: any) {
      return new Response(JSON.stringify({ success: false, error: 'Unauthorized login session.' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 2. Tenancy access check: Verify active collaborator write access on GitHub
    const isCollaborator = await verifyCollaborator(userToken, owner, name);
    if (!isCollaborator) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Unauthorized: You do not have collaborator push permissions to "${repoFullName}".`,
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!appId || !privateKeyB64 || appId === 'placeholder_github_app_id') {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'GitHub App integration variables are not fully configured in edge variables.',
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 3. Exchange App JWT for repository Installation Access Token
    let instToken = '';
    try {
      instToken = await getInstallationAccessToken(appId, privateKeyB64, installationId);
    } catch (e: any) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Failed to exchange App JWT for Installation token: ${e.message || e}`,
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 4. Fetch pouta.config.json from target repository root
    const configUrl = `https://api.github.com/repos/${owner}/${name}/contents/pouta.config.json`;
    
    const configResponse = await fetch(configUrl, {
      method: 'GET',
      headers: {
        Authorization: `token ${instToken}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Astro-PoutaCMS',
      },
    });

    if (!configResponse.ok) {
      if (configResponse.status === 404) {
        return new Response(
          JSON.stringify({
            success: false,
            error: `Configuration file "pouta.config.json" was not found in the root of the connected repository "${repoFullName}". Please add this config file to your repository first.`,
            notFound: true,
          }),
          { status: 404, headers: { 'Content-Type': 'application/json' } }
        );
      }
      
      const errText = await configResponse.text();
      return new Response(
        JSON.stringify({ success: false, error: `GitHub API error fetching configuration: ${errText}` }),
        { status: configResponse.status, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const fileData: any = await configResponse.json();
    
    // Decode Base64 content of pouta.config.json
    let parsedConfig = {};
    try {
      const decodedString = atob(fileData.content.replace(/\s+/g, ''));
      parsedConfig = JSON.parse(decodedString);
    } catch (e: any) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Failed to parse "pouta.config.json" as valid JSON: ${e.message || e}`,
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(JSON.stringify({ success: true, config: parsedConfig }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'An internal server error occurred while loading schema configurations.',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
