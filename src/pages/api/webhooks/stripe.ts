import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

export const prerender = false;

// Edge-native signature verifier to prevent spoofing
async function verifyStripeSignature(
  payload: string,
  header: string | null,
  secret: string | null
): Promise<boolean> {
  if (!header || !secret) return false;

  try {
    const parts = header.split(',');
    const tPart = parts.find((p) => p.trim().startsWith('t='));
    const v1Part = parts.find((p) => p.trim().startsWith('v1='));

    if (!tPart || !v1Part) return false;

    const timestamp = tPart.split('=')[1];
    const signature = v1Part.split('=')[1];

    const signedPayload = `${timestamp}.${payload}`;
    const encoder = new TextEncoder();
    const keyBytes = encoder.encode(secret);

    // Import the HMAC key
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyBytes,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    // Convert hex signature back to bytes
    const signatureBytes = new Uint8Array(
      (signature.match(/.{1,2}/g) || []).map((byte) => parseInt(byte, 16))
    );

    // Verify signature
    return await crypto.subtle.verify(
      'HMAC',
      cryptoKey,
      signatureBytes,
      encoder.encode(signedPayload)
    );
  } catch (err) {
    console.error('Signature verification error:', err);
    return false;
  }
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const webhookSecret = env.STRIPE_WEBHOOK_SECRET;
    const db = (env as any).DB;

    if (!db) {
      return new Response(
        JSON.stringify({ success: false, error: 'Database binding "DB" is not configured.' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Read raw body for signature verification
    const rawBody = await request.text();
    const signatureHeader = request.headers.get('Stripe-Signature');

    // Only verify signatures if webhook secret is configured (useful for easy local dev testing)
    if (webhookSecret) {
      const isValid = await verifyStripeSignature(rawBody, signatureHeader, webhookSecret);
      if (!isValid) {
        return new Response(
          JSON.stringify({ success: false, error: 'Unauthorized: Invalid Stripe signature.' }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        );
      }
    } else {
      console.warn('STRIPE_WEBHOOK_SECRET is not set. Signature verification bypassed.');
    }

    const event = JSON.parse(rawBody);
    console.log(`Processing Stripe webhook event: ${event.type}`);

    // Standard monthly subscription length in seconds + 2-day buffer (32 days total)
    const THIRTY_TWO_DAYS_IN_S = 32 * 24 * 60 * 60;
    const nowInSeconds = Math.floor(Date.now() / 1000);

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const repoPath = session.client_reference_id; // "owner/repo" passed from payment link
      const customerId = session.customer;
      const subscriptionId = session.subscription;

      if (!repoPath) {
        console.warn('Skipping webhook: No client_reference_id found in Checkout Session.');
        return new Response(JSON.stringify({ success: true, warning: 'Missing client_reference_id' }), { status: 200 });
      }

      // Upsert subscription into DB
      const expiresAt = nowInSeconds + THIRTY_TWO_DAYS_IN_S;
      await db.prepare(`
        INSERT INTO subscriptions (repo_path, stripe_customer_id, stripe_subscription_id, status, expires_at)
        VALUES (?, ?, ?, 'active', ?)
        ON CONFLICT(repo_path) DO UPDATE SET
          stripe_customer_id = excluded.stripe_customer_id,
          stripe_subscription_id = excluded.stripe_subscription_id,
          status = 'active',
          expires_at = excluded.expires_at,
          updated_at = CURRENT_TIMESTAMP
      `).bind(repoPath.toLowerCase(), customerId, subscriptionId, expiresAt).run();

      console.log(`Successfully upgraded repository: ${repoPath} (Expires: ${new Date(expiresAt * 1000).toISOString()})`);
    } 
    else if (event.type === 'customer.subscription.updated') {
      const subscription = event.data.object;
      const subId = subscription.id;
      const status = subscription.status; // 'active', 'past_due', 'unpaid', 'canceled'
      const currentPeriodEnd = subscription.current_period_end; // Unix timestamp from Stripe

      // Update subscription status and expires_at
      await db.prepare(`
        UPDATE subscriptions 
        SET status = ?, expires_at = ?, updated_at = CURRENT_TIMESTAMP
        WHERE stripe_subscription_id = ?
      `).bind(status === 'active' ? 'active' : status, currentPeriodEnd + 86400, subId).run(); // add 1 day safety buffer

      console.log(`Updated subscription ${subId} state to: ${status}`);
    } 
    else if (event.type === 'customer.subscription.deleted') {
      const subscription = event.data.object;
      const subId = subscription.id;

      // Mark subscription as canceled and expire immediately
      await db.prepare(`
        UPDATE subscriptions 
        SET status = 'canceled', expires_at = 0, updated_at = CURRENT_TIMESTAMP
        WHERE stripe_subscription_id = ?
      `).bind(subId).run();

      console.log(`Canceled subscription in database: ${subId}`);
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('Stripe webhook processing exception:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || 'Webhook processing failed.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
