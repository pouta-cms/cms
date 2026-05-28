import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { verifySession } from '../../../utils/auth';

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
    try {
      await verifySession(request, sessionSecret);
    } catch (e: any) {
      return new Response(JSON.stringify({ success: false, error: 'Unauthorized login session.' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const body = await request.json();
    const { content } = body;

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
      aiResponse = await ai.run('@cf/meta/llama-3-8b-instruct', {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Article content:\n${content}` }
        ]
      });
    } catch (modelError: any) {
      console.warn('Llama-3 model failed for headlines, falling back to Llama-2-7b-chat:', modelError.message);
      aiResponse = await ai.run('@cf/meta/llama-2-7b-chat-fp16', {
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
