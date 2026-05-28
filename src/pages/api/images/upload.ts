import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { verifySession, verifyCollaborator } from '../../../utils/auth';

export const prerender = false;

// Allowed image formats
const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'image/avif'
];

const ALLOWED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'avif'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

export const POST: APIRoute = async ({ request }) => {
  try {
    // 1. Authenticate user session statelessly
    const sessionSecret = env.SESSION_SECRET;
    if (!sessionSecret) {
      console.error('SESSION_SECRET environment variable is not set.');
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

    // 2. Parse multipart form data
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch (e) {
      return new Response(
        JSON.stringify({ success: false, error: 'Bad Request: Expecting multipart/form-data.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const file = formData.get('file') as File | null;
    const repoOwner = formData.get('repo_owner') as string | null;
    const repoName = formData.get('repo_name') as string | null;

    if (!file || !repoOwner || !repoName) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing required parameters: file, repo_owner, and repo_name.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 3. Tenancy Guard: Verify user has collaborator push permissions to target repo
    const isCollaborator = await verifyCollaborator(userToken, repoOwner, repoName);
    if (!isCollaborator) {
      return new Response(
        JSON.stringify({ success: false, error: 'Forbidden: You do not have write access to this repository.' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 4. Validate image constraints (Format & Mime Type)
    const fileExtension = file.name.split('.').pop()?.toLowerCase() || '';
    if (!ALLOWED_MIME_TYPES.includes(file.type) || !ALLOWED_EXTENSIONS.includes(fileExtension)) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Forbidden format: Supported image formats are JPEG, PNG, GIF, WebP, SVG, and AVIF.`
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Validate size limit (Max 5MB)
    if (file.size > MAX_FILE_SIZE) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `File size exceeds the maximum limit of 5MB (Received: ${(file.size / (1024 * 1024)).toFixed(2)}MB).`
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 5. Check Cloudflare R2 bucket binding
    const bucket = (env as any).MEDIA_BUCKET;
    if (!bucket) {
      return new Response(
        JSON.stringify({ success: false, error: 'Internal Server Error: Cloudflare R2 bucket binding "MEDIA_BUCKET" not configured.' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Check Cloudflare public url prefix
    const publicUrlPrefix = env.R2_PUBLIC_URL_PREFIX;
    if (!publicUrlPrefix) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Internal Server Error: Environment variable "R2_PUBLIC_URL_PREFIX" is missing. Please define it in your Cloudflare settings.'
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 6. Upload file to R2 bucket
    const uuid = crypto.randomUUID();
    const cleanFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
    const storageKey = `uploads/${repoOwner}/${repoName}/${uuid}-${cleanFileName}`;
    const fileBuffer = await file.arrayBuffer();

    try {
      await bucket.put(storageKey, fileBuffer, {
        httpMetadata: {
          contentType: file.type || 'application/octet-stream',
          cacheControl: 'public, max-age=31536000', // 1 year cache
        },
        customMetadata: {
          uploadedBy: repoOwner,
          originalName: file.name,
        }
      });
    } catch (e: any) {
      console.error('Error writing to R2 bucket:', e);
      return new Response(
        JSON.stringify({ success: false, error: 'Internal server error.' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 7. Format public serving URL
    const domainPrefix = publicUrlPrefix.replace(/\/$/, '');
    const publicUrl = `${domainPrefix}/${storageKey}`;

    // 8. AI-Powered Automatic Alt-Text Generation using Cloudflare Workers AI Vision
    let altText = '';
    const ai = (env as any).AI;
    if (ai) {
      try {
        const uint8Array = new Uint8Array(fileBuffer);
        const imageBytes = [...uint8Array];
        const promptText = 'Generate a highly descriptive, concise HTML alt text (max 15 words) for this image for accessibility. Return ONLY the raw alt text description. Do NOT include preamble, quotes, introductory phrases, or markdown.';

        let aiResponse;
        try {
          // Attempt using Llama 3.2 Vision model (Chat-instruct structure)
          aiResponse = await ai.run('@cf/meta/llama-3.2-11b-vision-instruct', {
            image: imageBytes,
            max_tokens: 64,
            messages: [
              { role: 'user', content: promptText }
            ]
          });
        } catch (llamaErr) {
          console.warn('Llama 3.2 Vision model failed, falling back to LLaVA:', llamaErr);
          // Fallback to LLaVA 1.5 (Standard image-to-text structure)
          aiResponse = await ai.run('@cf/llava-hf/llava-1.5-7b-hf', {
            image: imageBytes,
            prompt: promptText
          });
        }

        altText = aiResponse?.description || aiResponse?.response || aiResponse?.text || '';
        altText = altText.trim();
        
        // Strip enclosing quotes if returned
        if (altText.startsWith('"') && altText.endsWith('"')) {
          altText = altText.substring(1, altText.length - 1).trim();
        }
        if (altText.startsWith("'") && altText.endsWith("'")) {
          altText = altText.substring(1, altText.length - 1).trim();
        }
      } catch (aiError) {
        console.error('Failed to generate automatic alt-text via Workers AI:', aiError);
      }
    }

    // Default fallback alt text if AI is unavailable or fails
    if (!altText) {
      const lastDotIndex = file.name.lastIndexOf('.');
      const baseName = lastDotIndex !== -1 ? file.name.substring(0, lastDotIndex) : file.name;
      altText = baseName.replace(/[-_]+/g, ' ').trim();
      
      if (!altText) {
        altText = file.name || 'uploaded image';
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        url: publicUrl,
        key: storageKey,
        altText
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );


  } catch (error: any) {
    console.error('Unexpected error in image upload endpoint:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'Internal server error.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
