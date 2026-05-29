import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { verifySession, verifyCollaborator } from '../../../utils/auth';

export const prerender = false;

export const DELETE: APIRoute = async ({ request }) => {
  try {
    // 1. Authenticate user session
    const sessionSecret = env.SESSION_SECRET;
    if (!sessionSecret) {
      return new Response(
        JSON.stringify({ success: false, error: 'Internal server error.' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    let userToken = '';
    try {
      userToken = await verifySession(request, sessionSecret);
    } catch (e: any) {
      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized: Invalid or expired session.' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 2. Parse request body
    let body: { key?: string; repo_owner?: string; repo_name?: string };
    try {
      body = await request.json();
    } catch (e) {
      return new Response(
        JSON.stringify({ success: false, error: 'Bad Request: Expected JSON body.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { key, repo_owner: repoOwner, repo_name: repoName } = body;

    if (!key || !repoOwner || !repoName) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing required fields: key, repo_owner, and repo_name.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 3. Tenancy Guard: Verify the key belongs to the repo the user claims to own
    const expectedPrefix = `uploads/${repoOwner}/${repoName}/`;
    if (!key.startsWith(expectedPrefix)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Forbidden: You can only delete images belonging to this repository.' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 4. Verify user has collaborator push access to that repo
    const isCollaborator = await verifyCollaborator(userToken, repoOwner, repoName);
    if (!isCollaborator) {
      return new Response(
        JSON.stringify({ success: false, error: 'Forbidden: You do not have write access to this repository.' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 5. Check R2 bucket binding
    const bucket = (env as any).MEDIA_BUCKET;
    if (!bucket) {
      return new Response(
        JSON.stringify({ success: false, error: 'Internal Server Error: R2 bucket binding "MEDIA_BUCKET" not configured.' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 6. Delete the object from R2
    await bucket.delete(key);

    return new Response(
      JSON.stringify({ success: true, message: `Image deleted successfully.` }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Unexpected error in image delete endpoint:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'Internal server error.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
