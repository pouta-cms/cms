import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { verifySession, verifyCollaborator } from '../../../utils/auth';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  try {
    // 1. Authenticate user session statelessly
    const sessionSecret = env.SESSION_SECRET;
    if (!sessionSecret) {
      return new Response(
        JSON.stringify({ success: false, error: 'Internal server error: SESSION_SECRET not set.' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    let userToken = '';
    try {
      userToken = await verifySession(request, sessionSecret);
    } catch (e: any) {
      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized: Invalid session.' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 2. Parse query parameters
    const url = new URL(request.url);
    const repoPath = url.searchParams.get('repo'); // e.g. "owner/repo"

    if (!repoPath || !repoPath.includes('/')) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing or invalid "repo" parameter.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const [repoOwner, repoName] = repoPath.split('/');

    // 3. Tenancy Guard: Verify collaborator push access
    const isCollaborator = await verifyCollaborator(userToken, repoOwner, repoName);
    if (!isCollaborator) {
      return new Response(
        JSON.stringify({ success: false, error: 'Forbidden: You do not have access to this repository.' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 4. Check D1 subscription status
    const db = (env as any).DB;
    let isActive = false;
    let details: any = null;

    const paywallEnabled = env.PAYWALL_ENABLED === 'true';

    if (paywallEnabled) {
      if (!db) {
        return new Response(
          JSON.stringify({ success: false, error: 'Missing DB binding', message: 'Database binding "DB" is not configured.' }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }

      try {
        const queryResult = await db
          .prepare('SELECT status, expires_at FROM subscriptions WHERE repo_path = ?')
          .bind(repoPath.toLowerCase())
          .first();

        if (queryResult) {
          const nowInSeconds = Math.floor(Date.now() / 1000);
          isActive = queryResult.status === 'active' && queryResult.expires_at > nowInSeconds;
          details = queryResult;
        }
      } catch (dbErr) {
        console.error('Failed to query subscription from D1 cache:', dbErr);
        return new Response(
          JSON.stringify({ success: false, error: 'D1 lookup failed', details: String(dbErr) }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        );
      }
    } else {
      // If paywall is disabled, bypass and return active
      isActive = true;
    }

    // 5. Build dynamic checkout URL and static customer portal link safely
    const stripePaymentLink = env.STRIPE_PAYMENT_LINK;
    const stripePortalLink = env.STRIPE_PORTAL_LINK;

    if (!stripePaymentLink || !stripePortalLink) {
      console.error('Missing Stripe configuration: STRIPE_PAYMENT_LINK or STRIPE_PORTAL_LINK is not set.');
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Missing Stripe configuration',
          message: 'Stripe integration is not fully configured. Please set STRIPE_PAYMENT_LINK and STRIPE_PORTAL_LINK.'
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    let checkoutUrl = '';
    try {
      const urlObj = new URL(stripePaymentLink);
      urlObj.searchParams.set('client_reference_id', repoPath.toLowerCase());
      checkoutUrl = urlObj.toString();
    } catch (_) {
      checkoutUrl = `${stripePaymentLink}?client_reference_id=${encodeURIComponent(repoPath.toLowerCase())}`;
    }
    const portalUrl = stripePortalLink;

    return new Response(
      JSON.stringify({
        success: true,
        paywallEnabled,
        active: isActive,
        tier: isActive ? 'pro' : 'free',
        checkoutUrl,
        portalUrl,
        expiresAt: details?.expires_at || null,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error: any) {
    console.error('Subscription status fetch error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || 'Failed to retrieve subscription status.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
