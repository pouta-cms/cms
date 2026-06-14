import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { verifySession, verifyCollaborator } from '../../../utils/auth';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const sessionSecret = env.SESSION_SECRET;
    if (!sessionSecret) {
      return new Response(JSON.stringify({ success: false, error: 'Internal server error: SESSION_SECRET is not configured.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
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

    const body = await request.json();
    const { title, content, repo_owner, repo_name } = body;

    // Upfront validation: require repo coordinates unconditionally
    if (!repo_owner || !repo_name) {
      return new Response(
        JSON.stringify({ success: false, error: 'Bad Request: Missing repo_owner and repo_name parameters.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 1.5. Tenancy Guard: Verify collaborator push permissions
    const isCollaborator = await verifyCollaborator(userToken, repo_owner, repo_name);
    if (!isCollaborator) {
      return new Response(
        JSON.stringify({ success: false, error: 'Forbidden: You do not have write access to this repository.' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 1.6. Paywall Gate: Enforce active subscription if enabled
    const paywallEnabled = env.PAYWALL_ENABLED === 'true';
    if (paywallEnabled) {
      const db = (env as any).DB;
      if (!db) {
        return new Response(
          JSON.stringify({ success: false, error: 'Internal Server Error: Database "DB" binding not configured.' }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const repoPath = `${repo_owner}/${repo_name}`.toLowerCase();
      let isSubscribed = false;
      let dbErrorOccurred = false;

      try {
        const subRecord = await db
          .prepare('SELECT status, expires_at FROM subscriptions WHERE repo_path = ?')
          .bind(repoPath)
          .first();

        if (subRecord) {
          const nowInSeconds = Math.floor(Date.now() / 1000);
          isSubscribed = subRecord.status === 'active' && subRecord.expires_at > nowInSeconds;
        }
      } catch (dbErr) {
        console.error('Failed to verify subscription cache during AI description:', dbErr);
        dbErrorOccurred = true;
      }

      if (dbErrorOccurred) {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'DB_ERROR',
            message: 'Database check failed due to an internal D1 read error.'
          }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (!isSubscribed) {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'PAYWALL_REQUIRED',
            message: 'AI Meta Description Generator is a premium feature. Please upgrade your repository plan.'
          }),
          { status: 402, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    if (!content) {
      return new Response(JSON.stringify({ success: false, error: 'No content provided to summarize.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const ai = (env as any).AI;
    if (!ai) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Cloudflare Workers AI binding "AI" not found. Please ensure it is configured in wrangler.jsonc.'
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Call @cf/meta/llama-4-scout-17b-16e-instruct or @cf/meta/llama-3.1-8b-instruct-fp8 fallback
    let aiResponse;
    try {
      aiResponse = await ai.run('@cf/meta/llama-4-scout-17b-16e-instruct', {
        messages: [
          {
            role: 'system',
            content: 'You are an expert SEO specialist. Summarize the following article content into a concise, high-impact, SEO-friendly meta description (strictly between 120 and 160 characters). Do NOT include introductory phrases, quotes, preamble, or markdown. Return ONLY the raw description text.'
          },
          {
            role: 'user',
            content: `Title: ${title || 'Untitled'}\n\nContent:\n${content}`
          }
        ]
      });
    } catch (modelError: any) {
      console.warn('Llama-4 model failed, falling back to Llama-3.1-8b-instruct-fp8:', modelError.message);
      aiResponse = await ai.run('@cf/meta/llama-3.1-8b-instruct-fp8', {
        messages: [
          {
            role: 'system',
            content: 'You are an expert SEO specialist. Summarize the following article content into a concise, high-impact, SEO-friendly meta description (strictly between 120 and 160 characters). Do NOT include introductory phrases, quotes, preamble, or markdown. Return ONLY the raw description text.'
          },
          {
            role: 'user',
            content: `Title: ${title || 'Untitled'}\n\nContent:\n${content}`
          }
        ]
      });
    }

    let description = aiResponse?.response || aiResponse?.text || '';
    let cleaned = description.trim();

    // Strip outer quotes if returned by the LLM
    if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
      cleaned = cleaned.substring(1, cleaned.length - 1).trim();
    }
    if (cleaned.startsWith("'") && cleaned.endsWith("'")) {
      cleaned = cleaned.substring(1, cleaned.length - 1).trim();
    }

    // Validate generated description contract
    if (!cleaned || cleaned.length < 20 || cleaned.length > 300) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `AI generated description length (${cleaned.length} chars) is outside the allowed 20-300 character range.`
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        description: cleaned
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
        error: error.message || 'An internal error occurred during description generation.'
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
