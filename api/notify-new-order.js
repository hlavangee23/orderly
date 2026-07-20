// /api/notify-new-order.js
// Triggered by the `trg_notify_on_new_order` Postgres trigger (via pg_net)
// the moment a new row lands in `orders`. Handles delivery on top of the
// in-app notification, which the trigger already wrote directly to the DB.
//
// Uses the same env vars as send-trial-emails.js — no new setup needed:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY,
//   RESEND_FROM (e.g. "Orderly <hello@orderlyapp.co.za>")
// Plus one new one, added as part of this fix:
//   ORDERLY_WEBHOOK_SECRET — a random string only this file and the
//   Postgres trigger know. See the accompanying SQL migration for how
//   it's sent.
//
// Talks to Supabase via plain REST fetch calls, same as send-trial-emails.js
// — deliberately NOT using the @supabase/supabase-js package, since this
// repo doesn't have it as an installed dependency (the HTML files load it
// from a CDN script tag, which isn't the same as an npm package being
// available inside a serverless function).
//
// WhatsApp: NOT implemented yet. `notify_new_order_whatsapp` is read and
// logged so you can see intent, but nothing is sent — that's blocked on
// Meta Business verification + approved message templates (Phase 3).
// When that's ready, this is the only file that needs a new branch added.
//
// ── SECURITY: this endpoint is only meant to be called by the Postgres
// trigger, never directly by a browser or anyone else. Two checks
// enforce that:
//   1. A shared-secret header, checked before anything else runs.
//   2. Cross-validation that the order actually belongs to the given
//      store — without this, someone could pair a real order_id from
//      one store with a different store's profile_id and trigger a
//      false "new order" notification for a store that never received
//      that order.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── SHARED-SECRET CHECK ──────────────────────────────────────────
  // Must match the header the Postgres trigger sends. Without this,
  // this endpoint (and the service-role-backed data it fetches) is
  // reachable by anyone on the internet who finds the URL.
  const providedSecret = req.headers['x-orderly-webhook-secret'];
  if (!providedSecret || providedSecret !== process.env.ORDERLY_WEBHOOK_SECRET) {
    console.error('notify-new-order: rejected request with invalid/missing webhook secret');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { order_id, profile_id } = req.body || {};
  if (!order_id || !profile_id) {
    return res.status(400).json({ error: 'order_id and profile_id are required' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const headers = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
  };

  try {
    const [profileRes, orderRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${profile_id}&select=*`, { headers }),
      fetch(`${SUPABASE_URL}/rest/v1/orders?id=eq.${order_id}&select=*`, { headers }),
    ]);

    const profiles = await profileRes.json();
    const orders = await orderRes.json();
    const profile = profiles?.[0];
    const order = orders?.[0];

    if (!profile) {
      console.error('notify-new-order: profile not found', profile_id);
      return res.status(404).json({ error: 'Profile not found' });
    }
    if (!order) {
      console.error('notify-new-order: order not found', order_id);
      return res.status(404).json({ error: 'Order not found' });
    }

    // ── CROSS-VALIDATION ────────────────────────────────────────────
    // The order and profile were fetched independently by id — confirm
    // they actually belong together before notifying anyone. Without
    // this, a real order_id could be paired with an unrelated store's
    // profile_id to send that store a false "new order" alert.
    if (order.profile_id !== profile.id) {
      console.error('notify-new-order: order/profile mismatch', { order_id, profile_id });
      return res.status(400).json({ error: 'Order does not belong to this store' });
    }

    const results = { email: 'skipped', whatsapp: 'skipped', customer_receipt: 'skipped' };

    // ── EMAIL (store owner) ────────────────────────────────────────
    if (profile.notify_new_order_email) {
      const ownerEmail = await getUserEmail(SUPABASE_URL, headers, profile_id);

      if (ownerEmail && process.env.RESEND_API_KEY) {
        const orderTotal = order.total != null ? `R${Number(order.total).toFixed(2)}` : '';
        const dashboardUrl = 'https://orderlyapp.co.za/orderly-dashboard.html';

        const emailHtml = `
          <div style="font-family:'DM Sans',Arial,sans-serif;background:#F8FAF7;padding:32px;">
            <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #D6EAD9;">
              <div style="background:#0F2318;padding:20px 24px;">
                <span style="font-family:Georgia,serif;font-size:1.3rem;color:#fff;">Order<span style="color:rgba(255,255,255,0.4);">ly</span></span>
              </div>
              <div style="padding:28px 24px;">
                <h2 style="margin:0 0 8px;color:#0F2318;font-size:1.2rem;">🎉 New order from ${order.customer_name || 'a customer'}</h2>
                <p style="margin:0 0 16px;color:#3D5A47;font-size:0.9rem;">
                  ${orderTotal ? `Total: <strong>${orderTotal}</strong><br/>` : ''}
                  Placed just now on your Orderly store.
                </p>
                <a href="${dashboardUrl}" style="display:inline-block;background:#2D6A4F;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-size:0.88rem;font-weight:600;">
                  View order →
                </a>
              </div>
            </div>
          </div>
        `;

        const resendResp = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: process.env.RESEND_FROM,
            to: ownerEmail,
            subject: `New order from ${order.customer_name || 'a customer'} 🎉`,
            html: emailHtml,
          }),
        });

        results.email = resendResp.ok ? 'sent' : `failed (${resendResp.status})`;
        if (!resendResp.ok) {
          console.error('notify-new-order: Resend send failed', await resendResp.text());
        }
      } else {
        results.email = 'skipped (no email on file or RESEND_API_KEY missing)';
      }
    }

    // ── WHATSAPP (store owner) ────────────────────────────────────
    // Preference is stored and honoured once Meta Cloud API is wired up.
    if (profile.notify_new_order_whatsapp) {
      results.whatsapp = 'preference set — Meta Cloud API integration pending (Phase 3)';
    }

    // ── CUSTOMER RECEIPT (email only) ──────────────────────────────
    if (order.receipt_method === 'email' && order.customer_email && process.env.RESEND_API_KEY) {
      const itemLines = (order.items || [])
        .map(i => `${i.qty}× ${i.name} — R${(i.price * i.qty).toFixed(2)}`)
        .join('<br/>');

      const receiptHtml = `
        <div style="font-family:'DM Sans',Arial,sans-serif;background:#F8FAF7;padding:32px;">
          <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #D6EAD9;">
            <div style="background:#0F2318;padding:20px 24px;">
              <span style="font-family:Georgia,serif;font-size:1.3rem;color:#fff;">Order<span style="color:rgba(255,255,255,0.4);">ly</span></span>
            </div>
            <div style="padding:28px 24px;">
              <h2 style="margin:0 0 4px;color:#0F2318;font-size:1.2rem;">🧾 Your receipt from ${profile.store_name || 'your order'}</h2>
              <p style="margin:0 0 18px;color:#7A9A85;font-size:0.8rem;">Order #${order.invoice_number || ''}</p>
              <div style="font-size:0.88rem;color:#3D5A47;line-height:1.7;margin-bottom:16px;">${itemLines}</div>
              <div style="border-top:1px solid #D6EAD9;padding-top:12px;font-size:0.95rem;font-weight:600;color:#0F2318;">
                Total: R${Number(order.total || 0).toFixed(2)}
              </div>
              <p style="margin:20px 0 0;color:#3D5A47;font-size:0.85rem;">Thanks for your order! 🙏</p>
            </div>
          </div>
        </div>
      `;

      const receiptResp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: process.env.RESEND_FROM,
          to: order.customer_email,
          subject: `Your receipt from ${profile.store_name || 'Orderly'} 🧾`,
          html: receiptHtml,
        }),
      });

      results.customer_receipt = receiptResp.ok ? 'sent' : `failed (${receiptResp.status})`;
      if (!receiptResp.ok) {
        console.error('notify-new-order: customer receipt send failed', await receiptResp.text());
      }
    }

    return res.status(200).json({ ok: true, results });
  } catch (err) {
    console.error('notify-new-order: unexpected error', err);
    return res.status(500).json({ error: 'Internal error', message: err.message });
  }
}

async function getUserEmail(SUPABASE_URL, headers, userId) {
  const resp = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, { headers });
  if (!resp.ok) return null;
  const data = await resp.json();
  return data?.email || null;
}
