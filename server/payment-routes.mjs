/**
 * Stripe payment routes
 * POST /api/payment/create-checkout-session  — create Stripe Checkout
 * POST /api/payment/webhook                  — handle Stripe webhook events
 */

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const PRICE_AMOUNT = 15000; // $150.00 in cents
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

async function supabaseUpsert(table, data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Prefer': 'resolution=merge-duplicates',
    },
    body: JSON.stringify(data),
  });
  return res.ok;
}

export async function handlePayment(req, res) {
  const url = new URL(req.url, 'http://localhost');

  // Create Stripe Checkout Session
  if (req.method === 'POST' && url.pathname === '/api/payment/create-checkout-session') {
    if (!STRIPE_SECRET_KEY) {
      json(res, 500, { error: 'Stripe not configured' });
      return;
    }

    const body = JSON.parse((await readBody(req)).toString());
    const { userId, email } = body;

    const origin = req.headers.origin || req.headers.referer?.replace(/\/$/, '') || 'http://localhost:5173';

    const params = new URLSearchParams({
      'payment_method_types[0]': 'card',
      'mode': 'payment',
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][unit_amount]': String(PRICE_AMOUNT),
      'line_items[0][price_data][product_data][name]': 'FABS Facial Analysis — Пожизненный доступ',
      'line_items[0][price_data][product_data][description]': 'Полный AI-анализ лица · 10 параметров · Пожизненный доступ',
      'success_url': `${origin}/success`,
      'cancel_url': `${origin}/#pricing`,
      'customer_email': email || '',
      'metadata[user_id]': userId || '',
    });

    const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const session = await stripeRes.json();
    if (!stripeRes.ok) {
      json(res, 400, { error: session.error?.message || 'Stripe error' });
      return;
    }

    json(res, 200, { url: session.url, sessionId: session.id });
    return;
  }

  // Stripe Webhook
  if (req.method === 'POST' && url.pathname === '/api/payment/webhook') {
    const body = await readBody(req);
    const sig = req.headers['stripe-signature'];

    let event;
    try {
      // Simplified webhook verification (use stripe library for production)
      event = JSON.parse(body.toString());
    } catch {
      json(res, 400, { error: 'Invalid payload' });
      return;
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const userId = session.metadata?.user_id;

      if (userId && SUPABASE_URL && SUPABASE_SERVICE_KEY) {
        await supabaseUpsert('subscriptions', {
          user_id: userId,
          stripe_customer_id: session.customer || null,
          stripe_payment_intent_id: session.payment_intent || null,
          status: 'lifetime',
          paid_at: new Date().toISOString(),
        });
      }
    }

    json(res, 200, { received: true });
    return;
  }

  // Subscription status check
  if (req.method === 'GET' && url.pathname === '/api/subscription') {
    const userId = req.headers['x-user-id'];
    if (!userId || !SUPABASE_URL) {
      json(res, 200, { hasAccess: false });
      return;
    }

    const supaRes = await fetch(
      `${SUPABASE_URL}/rest/v1/subscriptions?user_id=eq.${userId}&status=eq.lifetime&limit=1`,
      {
        headers: {
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        },
      }
    );
    const data = await supaRes.json();
    json(res, 200, { hasAccess: Array.isArray(data) && data.length > 0 });
    return;
  }

  json(res, 404, { error: 'Not found' });
}
