import type { APIRoute } from 'astro';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const adminPanelUrl = `${url.origin}/`;

  // Immediately expire the cookie
  const cookieHeader = `pouta_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;

  return new Response(null, {
    status: 302,
    headers: {
      Location: adminPanelUrl,
      'Set-Cookie': cookieHeader,
    },
  });
};
