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

    // 1.5. Tenancy Guard: Verify collaborator push permissions
    if (repo_owner && repo_name) {
      const isCollaborator = await verifyCollaborator(userToken, repo_owner, repo_name);
      if (!isCollaborator) {
        return new Response(
          JSON.stringify({ success: false, error: 'Forbidden: You do not have write access to this repository.' }),
          { status: 403, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    // 1.6. Paywall Gate: Enforce active subscription if enabled
    const paywallEnabled = env.PAYWALL_ENABLED === 'true';
    if (paywallEnabled) {
      if (!repo_owner || !repo_name) {
        return new Response(
          JSON.stringify({ success: false, error: 'Bad Request: Missing repo_owner and repo_name parameters for billing.' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const db = (env as any).DB;
      if (!db) {
        return new Response(
          JSON.stringify({ success: false, error: 'Internal Server Error: Database "DB" binding not configured.' }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const repoPath = `${repo_owner}/${repo_name}`.toLowerCase();
      let isSubscribed = false;

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
        console.error('Failed to verify subscription cache during AI categories:', dbErr);
      }

      if (!isSubscribed) {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'PAYWALL_REQUIRED',
            message: 'AI Category Generator is a premium feature. Please upgrade your repository plan.'
          }),
          { status: 402, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    if (!content) {
      return new Response(JSON.stringify({ success: false, error: 'No content provided to categorize.' }), {
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

    // Call @cf/meta/llama-3-8b-instruct or fallback
    let aiResponse;
    try {
      aiResponse = await ai.run('@cf/meta/llama-3-8b-instruct', {
        messages: [
          {
            role: 'system',
            content: 'You are an expert content categorizer. Suggest 3 to 5 highly relevant, concise, lowercase category tags for the following article. Return ONLY a single comma-separated list of these tags (e.g. "serverless, database, cloudflare"). Do NOT include numbering, bullet points, introductory text, quotes, or markdown.'
          },
          {
            role: 'user',
            content: `Title: ${title || 'Untitled'}\n\nContent:\n${content}`
          }
        ]
      });
    } catch (modelError: any) {
      console.warn('Llama-3 model failed, falling back to Llama-2-7b-chat:', modelError.message);
      aiResponse = await ai.run('@cf/meta/llama-2-7b-chat-fp16', {
        messages: [
          {
            role: 'system',
            content: 'You are an expert content categorizer. Suggest 3 to 5 highly relevant, concise, lowercase category tags for the following article. Return ONLY a single comma-separated list of these tags (e.g. "serverless, database, cloudflare"). Do NOT include numbering, bullet points, introductory text, quotes, or markdown.'
          },
          {
            role: 'user',
            content: `Title: ${title || 'Untitled'}\n\nContent:\n${content}`
          }
        ]
      });
    }

    let result = aiResponse?.response || aiResponse?.text || '';
    let cleaned = result.trim();

    // Strip outer quotes if returned by the LLM
    if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
      cleaned = cleaned.substring(1, cleaned.length - 1).trim();
    }
    if (cleaned.startsWith("'") && cleaned.endsWith("'")) {
      cleaned = cleaned.substring(1, cleaned.length - 1).trim();
    }

    const categories = cleaned
      .split(',')
      .map((s: string) => s.trim().toLowerCase())
      .filter((s: string) => s.length > 0 && !s.includes(':') && !s.includes('\n') && !s.includes('#'));

    // Validate generated categories contract
    if (categories.length < 1 || categories.length > 5) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `AI generated an invalid number of categories (${categories.length}). Expected between 1 and 5.`
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    for (const cat of categories) {
      if (cat.length === 0 || cat.length > 50) {
        return new Response(
          JSON.stringify({
            success: false,
            error: `AI suggested a category tag that exceeds length constraints: "${cat}"`
          }),
          {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
      
      const wordCount = cat.split(/\s+/).filter(Boolean).length;
      if (wordCount > 4) {
        return new Response(
          JSON.stringify({
            success: false,
            error: `AI suggested a category tag with too many words: "${cat}"`
          }),
          {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        categories
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
        error: error.message || 'An internal error occurred during categories generation.'
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
