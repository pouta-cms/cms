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
    const { text, action, tone, targetLanguage, repo_owner, repo_name } = body;

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
        console.error('Failed to verify subscription cache during AI assist:', dbErr);
        dbErrorOccurred = true;
      }

      if (dbErrorOccurred) {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'DATABASE_ERROR',
            message: 'Subscription database check failed due to an internal infrastructure error.'
          }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (!isSubscribed) {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'PAYWALL_REQUIRED',
            message: 'AI Writing Assistant is a premium feature. Please upgrade your repository plan to Pro.'
          }),
          { status: 402, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    if (!text) {
      return new Response(JSON.stringify({ success: false, error: 'No text provided for AI assistance.' }), {
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

    // Determine the system prompt based on the requested action
    let systemPrompt = '';
    switch (action) {
      case 'grammar':
        systemPrompt = 'You are a world-class copyeditor. Improve the grammar, spelling, punctuation, flow, and clarity of the following text while strictly preserving its original meaning, formatting, and general structure. Do NOT add any preamble, explanation, quotes, or markdown. Return ONLY the beautifully edited raw text.';
        break;
      case 'tone':
        if (!tone) {
          return new Response(JSON.stringify({ success: false, error: 'No tone specified for tone adjustment.' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        systemPrompt = `You are a professional content editor. Rewrite the following text to have a highly ${tone} tone. Keep the core message and details exactly the same. Do NOT write any preamble, introductory text, explanations, or quotes. Return ONLY the rewritten raw text.`;
        break;
      case 'translate':
        if (!targetLanguage) {
          return new Response(JSON.stringify({ success: false, error: 'No target language specified for translation.' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        systemPrompt = `You are an expert literary translator. Translate the following text accurately into ${targetLanguage}, preserving the tone, style, meaning, and formatting. Do NOT include any preamble, translator notes, quotes, or markdown. Return ONLY the translated raw text.`;
        break;
      case 'summarize':
        systemPrompt = 'You are an expert content analyst. Provide a highly concise, elegant, and high-impact summary of the following text. Do NOT include any introductory phrases (like "Here is a summary:"), preamble, or quotes. Return ONLY the raw summary text.';
        break;
      case 'expand':
        systemPrompt = 'You are a professional writer. Continue writing the next logical sentences or paragraphs based on the style, context, and vocabulary of the provided text. Keep the transition completely smooth and matching the original style. Return ONLY the newly generated continuation text. Do NOT repeat or include the original text, and do NOT include any preamble or meta-commentary.';
        break;
      default:
        return new Response(JSON.stringify({ success: false, error: `Invalid AI assistant action: "${action}"` }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
    }

    // Call @cf/meta/llama-3-8b-instruct or fallback
    let aiResponse;
    try {
      aiResponse = await ai.run('@cf/meta/llama-3-8b-instruct', {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text }
        ]
      });
    } catch (modelError: any) {
      console.warn('Llama-3 model failed, falling back to Llama-2-7b-chat:', modelError.message);
      aiResponse = await ai.run('@cf/meta/llama-2-7b-chat-fp16', {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text }
        ]
      });
    }

    let resultText = aiResponse?.response || aiResponse?.text || '';
    let cleaned = resultText.trim();

    // Strip outer quotes if returned by the LLM
    if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
      cleaned = cleaned.substring(1, cleaned.length - 1).trim();
    }
    if (cleaned.startsWith("'") && cleaned.endsWith("'")) {
      cleaned = cleaned.substring(1, cleaned.length - 1).trim();
    }

    return new Response(
      JSON.stringify({
        success: true,
        result: cleaned
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
        error: error.message || 'An internal error occurred during AI assistance.'
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
