import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

export const prerender = false;

// Edge-native signature verifier to prevent spoofing
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
    if (!tPart) return false;

    const timestampStr = tPart.split('=')[1];
    const timestamp = Number(timestampStr);
    if (isNaN(timestamp)) return false;

    // Enforce timestamp freshness check (300 seconds tolerance)
    const TOLERANCE_SECONDS = 300;
    const nowInSeconds = Math.floor(Date.now() / 1000);
    if (Math.abs(nowInSeconds - timestamp) > TOLERANCE_SECONDS) {
      console.warn('Stripe Webhook expired timestamp tolerance.');
      return false;
    }

    const v1Parts = parts.filter((p) => p.trim().startsWith('v1='));
    if (v1Parts.length === 0) return false;

    const signedPayload = `${timestampStr}.${payload}`;
    const encoder = new TextEncoder();
    const keyBytes = encoder.encode(secret);

    // Import the HMAC key with both 'sign' and 'verify' key usages
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyBytes,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify']
    );

    const signedPayloadBytes = encoder.encode(signedPayload);

    // Verify against each v1 signature, returning true if any matches
    for (const v1Part of v1Parts) {
      const signature = v1Part.split('=')[1];
      if (!signature) continue;

      // Convert hex signature back to bytes safely
      const cleanSig = signature.trim();
      const signatureBytes = new Uint8Array(
        (cleanSig.match(/.{1,2}/g) || []).map((byte) => parseInt(byte, 16))
      );

      const isSigValid = await crypto.subtle.verify(
        'HMAC',
        cryptoKey,
        signatureBytes,
        signedPayloadBytes
      );

      if (isSigValid) {
        return true; // Match found
      }
    }

    return false; // No signature matches
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

    // Strict Webhook Protection: Do not fail open
    if (!webhookSecret || !signatureHeader) {
      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized: Missing webhook signing secret or Stripe signature header.' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const isValid = await verifyStripeSignature(rawBody, signatureHeader, webhookSecret);
    if (!isValid) {
      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized: Invalid Stripe signature.' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const event = JSON.parse(rawBody);
    console.log(`Processing Stripe webhook event: ${event.type}`);

    // Standard monthly subscription length in seconds + 2-day buffer (32 days total)
    const THIRTY_TWO_DAYS_IN_S = 32 * 24 * 60 * 60;
    const nowInSeconds = Math.floor(Date.now() / 1000);

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      
      // Resilient repository path retrieval
      let repoPath = session.client_reference_id; // "owner/repo" passed from payment link

      // Fallback 1: Try reading from checkout session metadata
      if (!repoPath && session.metadata) {
        repoPath = session.metadata.repo_path || session.metadata.client_reference_id || session.metadata.repo;
      }

      // Fallback 2: Try reading from custom fields if set up in the Stripe Dashboard
      if (!repoPath && session.custom_fields) {
        const repoField = session.custom_fields.find(
          (f: any) => 
            f.key === 'repository' || 
            f.key === 'repo_path' || 
            f.label?.custom?.toLowerCase().includes('repo') ||
            f.label?.custom?.toLowerCase().includes('repository')
        );
        if (repoField?.text?.value) {
          repoPath = repoField.text.value;
        }
      }

      const customerId = session.customer;
      const subscriptionId = session.subscription;

      if (!repoPath) {
        console.warn('Skipping webhook: No client_reference_id, metadata, or custom field repository path found in Checkout Session.');
        return new Response(JSON.stringify({ success: true, warning: 'Missing client_reference_id' }), { status: 200 });
      }

      // Decode the repository path safely (converting base64url back to raw string, with fallback for raw paths)
      try {
        if (repoPath && !repoPath.includes('/') && !repoPath.includes(' ')) {
          let base64 = repoPath.replace(/-/g, '+').replace(/_/g, '/');
          while (base64.length % 4) {
            base64 += '=';
          }
          const decoded = atob(base64);
          // Only use decoded value if it contains the expected repository owner/name separator "/"
          if (decoded.includes('/')) {
            repoPath = decoded;
          }
        }
      } catch (err) {
        console.warn('Failed to base64url decode repoPath, using raw value:', err);
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
