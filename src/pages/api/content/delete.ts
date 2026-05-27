import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { verifySession, verifyCollaborator } from '../../../utils/auth';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { id, repo_owner = '', repo_name = '' } = body;

    // Strict validation
    if (!id || !repo_owner || !repo_name) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Missing required parameters. id, repo_owner, and repo_name are mandatory.',
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const db = env.DB;
    const sessionSecret = env.SESSION_SECRET || 'default-fallback-pouta-key-32-chars-minimum';

    if (!db) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Cloudflare D1 Database binding "DB" was not found in environment.',
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
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
    const isCollaborator = await verifyCollaborator(userToken, repo_owner, repo_name);
    if (!isCollaborator) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Unauthorized: You do not have collaborator push permissions to "${repo_owner}/${repo_name}".`,
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 3. Delete document strictly scoped by ID and repository owner/name for secure multi-tenancy
    const query = `
      DELETE FROM documents 
      WHERE id = ?1 AND repo_owner = ?2 AND repo_name = ?3;
    `;

    const result = await db.prepare(query).bind(id, repo_owner.trim(), repo_name.trim()).run();

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Document successfully deleted from Cloudflare D1 edge database.',
        meta: {
          changes: result.meta?.changes || 0,
        }
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
        error: error.message || 'An internal server error occurred while deleting content.',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
