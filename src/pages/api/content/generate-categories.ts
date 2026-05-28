import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { verifySession } from '../../../utils/auth';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const sessionSecret = env.SESSION_SECRET || 'default-fallback-pouta-key-32-chars-minimum';

    // 1. Verify stateless session cookie
    try {
      await verifySession(request, sessionSecret);
    } catch (e: any) {
      return new Response(JSON.stringify({ success: false, error: 'Unauthorized login session.' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const body = await request.json();
    const { title, content } = body;

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
