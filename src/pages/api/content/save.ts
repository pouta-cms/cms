import type { APIRoute } from 'astro';
import { verifySession, verifyCollaborator } from '../../../utils/auth';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const body = await request.json();
    const {
      id,
      type,
      slug,
      title,
      content_json,
      metadata_json = {},
      status = 'draft',
      repo_owner = '',
      repo_name = '',
      repo_branch = 'main',
      github_installation_id = '',
    } = body;

    // Strict validation
    if (!id || !type || !slug || !title || !content_json || !repo_owner || !repo_name || !github_installation_id) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Missing required parameters. id, type, slug, title, content_json, repository owner/name, and installationId are mandatory.',
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const env = (locals as any).runtime?.env || {};
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

    // SQLite dynamic upsert query using isolated documents schema
    const query = `
      INSERT INTO documents (
        id, type, slug, title, metadata_json, content_json, status, repo_owner, repo_name, repo_branch, github_installation_id
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
      ON CONFLICT(id) DO UPDATE SET
        type = excluded.type,
        slug = excluded.slug,
        title = excluded.title,
        metadata_json = excluded.metadata_json,
        content_json = excluded.content_json,
        status = excluded.status,
        repo_owner = excluded.repo_owner,
        repo_name = excluded.repo_name,
        repo_branch = excluded.repo_branch,
        github_installation_id = excluded.github_installation_id,
        updated_at = CURRENT_TIMESTAMP;
    `;

    try {
      await db
        .prepare(query)
        .bind(
          id,
          type.trim().toLowerCase(),
          slug.trim().toLowerCase(),
          title.trim(),
          typeof metadata_json === 'string' ? metadata_json : JSON.stringify(metadata_json),
          typeof content_json === 'string' ? content_json : JSON.stringify(content_json),
          status,
          repo_owner.trim(),
          repo_name.trim(),
          repo_branch.trim(),
          String(github_installation_id).trim()
        )
        .run();
    } catch (dbError: any) {
      if (dbError.message && dbError.message.includes('UNIQUE constraint failed')) {
        return new Response(
          JSON.stringify({
            success: false,
            error: `A document with the slug "${slug}" already exists for the content type "${type}" in this repository. Please use a unique slug.`,
          }),
          {
            status: 409,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
      throw dbError;
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Document successfully cached in Cloudflare D1 edge database.',
        data: { id, type, slug, title, status },
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
        error: error.message || 'An internal server error occurred while saving content.',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
