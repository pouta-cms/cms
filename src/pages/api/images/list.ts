import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { verifySession, verifyCollaborator } from '../../../utils/auth';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
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

    // 2. Parse query parameters
    const url = new URL(request.url);
    const repoOwner = url.searchParams.get('repo_owner');
    const repoName = url.searchParams.get('repo_name');

    if (!repoOwner || !repoName) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing required parameters: repo_owner and repo_name.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 3. Tenancy Guard: Verify user has collaborator access to the target repo
    const isCollaborator = await verifyCollaborator(userToken, repoOwner, repoName);
    if (!isCollaborator) {
      return new Response(
        JSON.stringify({ success: false, error: 'Forbidden: You do not have access to this repository.' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 4. Check R2 bucket binding
    const bucket = (env as any).MEDIA_BUCKET;
    if (!bucket) {
      return new Response(
        JSON.stringify({ success: false, error: 'Internal Server Error: R2 bucket binding "MEDIA_BUCKET" not configured.' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 5. Check public URL prefix
    const publicUrlPrefix = env.R2_PUBLIC_URL_PREFIX;
    if (!publicUrlPrefix) {
      return new Response(
        JSON.stringify({ success: false, error: 'Internal Server Error: "R2_PUBLIC_URL_PREFIX" environment variable is missing.' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 6. List objects in R2 with the repo-scoped prefix
    const prefix = `uploads/${repoOwner}/${repoName}/`;
    const listed = await bucket.list({ prefix, limit: 500 });

    const domainPrefix = publicUrlPrefix.replace(/\/$/, '');
    const images = (listed.objects || []).map((obj: any) => ({
      key: obj.key,
      url: `${domainPrefix}/${obj.key}`,
      size: obj.size,
      uploaded: obj.uploaded,
      // Extract original filename from the key: uploads/owner/name/{uuid}-{filename}
      name: obj.key.split('/').pop() || obj.key,
    }));

    // Sort by upload time descending (newest first)
    images.sort((a: any, b: any) => {
      const ta = a.uploaded ? new Date(a.uploaded).getTime() : 0;
      const tb = b.uploaded ? new Date(b.uploaded).getTime() : 0;
      return tb - ta;
    });

    return new Response(
      JSON.stringify({ success: true, images }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Unexpected error in image list endpoint:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'Internal server error.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
