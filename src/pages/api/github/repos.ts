import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { verifySession } from '../../../utils/auth';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  try {
    const sessionSecret = env.SESSION_SECRET || 'default-fallback-pouta-key-32-chars-minimum';

    // 1. Verify stateless session cookie
    let userToken = '';
    try {
      userToken = await verifySession(request, sessionSecret);
    } catch (e: any) {
      return new Response(JSON.stringify({ success: false, error: e.message || 'Unauthorized.' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (userToken === 'mock-github-token') {
      return new Response(
        JSON.stringify({
          success: true,
          repos: [
            {
              id: 12345,
              name: 'sandbox-repo',
              full_name: 'test-owner/sandbox-repo',
              owner: 'test-owner',
              default_branch: 'main',
              github_installation_id: '9999',
            },
          ],
          installationsCount: 1,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // 2. Fetch installations the active user has access to
    const instResponse = await fetch('https://api.github.com/user/installations', {
      method: 'GET',
      headers: {
        Authorization: `token ${userToken}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Astro-PoutaCMS',
      },
    });

    if (!instResponse.ok) {
      const errText = await instResponse.text();
      return new Response(
        JSON.stringify({ success: false, error: `GitHub Installations API error: ${errText}` }),
        {
          status: instResponse.status,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const instData: any = await instResponse.json();
    const installations = instData.installations || [];

    // 3. For each active installation, fetch authorized repositories list
    const reposList: any[] = [];
    
    for (const inst of installations) {
      const instId = inst.id;
      
      const reposResponse = await fetch(`https://api.github.com/user/installations/${instId}/repositories`, {
        method: 'GET',
        headers: {
          Authorization: `token ${userToken}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'Astro-PoutaCMS',
        },
      });

      if (reposResponse.ok) {
        const reposData: any = await reposResponse.json();
        const repositories = reposData.repositories || [];
        
        for (const repo of repositories) {
          reposList.push({
            id: repo.id,
            name: repo.name,
            full_name: repo.full_name,
            owner: repo.owner.login,
            default_branch: repo.default_branch || 'main',
            github_installation_id: String(instId), // Associate D1 mapped installation ID!
          });
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        repos: reposList,
        installationsCount: installations.length,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'An internal server error occurred while retrieving connected repositories.',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
