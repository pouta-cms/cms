import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { verifySession, verifyCollaborator } from '../../../utils/auth';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  try {
    const url = new URL(request.url);
    const repoFullName = url.searchParams.get('repo');

    if (!repoFullName) {
      return new Response(JSON.stringify({ success: false, error: 'Missing required "repo" query parameter.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const [owner, name] = repoFullName.split('/');
    if (!owner || !name) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid repository name format.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const db = env.DB;
    const sessionSecret = env.SESSION_SECRET || 'default-fallback-pouta-key-32-chars-minimum';

    if (!db) {
      return new Response(
        JSON.stringify({ success: false, error: 'Cloudflare D1 Database binding "DB" was not found.' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

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

    // 3. Fetch isolated drafts belonging strictly to this repository (including blocks & metadata)
    const documents = await db
      .prepare('SELECT * FROM documents WHERE repo_owner = ? AND repo_name = ? ORDER BY updated_at DESC')
      .bind(owner, name)
      .all();

    return new Response(JSON.stringify({ success: true, documents: documents.results || [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'An internal server error occurred while retrieving documents.',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
