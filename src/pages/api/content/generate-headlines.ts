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

    let body;
    try {
      body = await request.json();
    } catch (err) {
      return new Response(JSON.stringify({ success: false, error: 'Malformed JSON' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const { content, repo_owner, repo_name } = body;

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
        console.error('Failed to verify subscription cache during AI headlines:', dbErr);
        dbErrorOccurred = true;
      }

      if (dbErrorOccurred) {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'SUBSCRIPTION_CHECK_FAILED',
            message: 'Failed to verify workspace subscription due to an internal database error.'
          }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (!isSubscribed) {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'PAYWALL_REQUIRED',
            message: 'AI Headline Suggestion is a premium feature. Please upgrade your repository plan.'
          }),
          { status: 402, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    if (!content) {
      return new Response(JSON.stringify({ success: false, error: 'No content provided to analyze.' }), {
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

    // Generate headlines prompt
    const systemPrompt = `You are a professional SEO copywriter and viral growth editor. 
Based on the following article content, generate exactly 5 distinct, high-impact, highly engaging, and SEO-friendly headlines/titles.
Return ONLY the 5 headlines, each on a new line. Do NOT include numbers, letters (like A., B.), bullets, quotation marks, bolding, markdown, or any introductory or concluding text. Just return exactly 5 lines, where each line is a raw headline.`;

    let aiResponse;
    try {
      aiResponse = await ai.run('@cf/meta/llama-4-scout-17b-16e-instruct', {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Article content:\n${content}` }
        ]
      });
    } catch (modelError: any) {
      console.warn('Llama-4 model failed for headlines, falling back to Llama-3.1-8b-instruct-fp8:', modelError.message);
      aiResponse = await ai.run('@cf/meta/llama-3.1-8b-instruct-fp8', {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Article content:\n${content}` }
        ]
      });
    }

    const rawText = aiResponse?.response || aiResponse?.text || '';
    const headlines = rawText
      .split('\n')
      .map((line: string) => {
        let cleaned = line.trim();
        // Remove numbers at start like "1. ", "1) ", "Headline 1:"
        cleaned = cleaned.replace(/^\d+[\.\)\s-:]+/, '');
        // Remove bullet points like "- ", "* "
        cleaned = cleaned.replace(/^[\*\-\s]+/, '');
        // Remove enclosing quotes
        if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
          cleaned = cleaned.substring(1, cleaned.length - 1).trim();
        }
        if (cleaned.startsWith("'") && cleaned.endsWith("'")) {
          cleaned = cleaned.substring(1, cleaned.length - 1).trim();
        }
        return cleaned;
      })
      .filter((line: string) => {
        const isTooShortOrLong = line.length < 8 || line.length > 150;
        const isPreamble = line.endsWith(':') || 
                           /^(here are|here is|sure|these are|following|suggested)/i.test(line) ||
                           line.toLowerCase().includes('seo-friendly headlines') ||
                           line.toLowerCase().includes('high-impact');
        return !isTooShortOrLong && !isPreamble;
      })
      .slice(0, 5);

    if (headlines.length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'AI generated empty or malformed headlines. Please try again.'
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    if (headlines.length < 3) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `AI generated an insufficient number of headlines (${headlines.length}). Expected at least 3.`
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
        headlines
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
        error: error.message || 'An internal error occurred during headlines generation.'
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
