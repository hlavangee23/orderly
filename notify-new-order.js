// api/notify-new-order.js
// Triggered by the `trg_notify_on_new_order` Postgres trigger (via pg_net)
// the moment a new row lands in `orders`. Handles delivery on top of the
// in-app notification, which the trigger already wrote directly to the DB.
//
// Uses the same env vars as send-trial-emails.js — no new setup needed:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY,
//   RESEND_FROM (e.g. "Orderly <hello@orderlyapp.co.za>")
//
// WhatsApp: NOT implemented yet. `notify_new_order_whatsapp` is read and
// logged so you can see intent, but nothing is sent — that's blocked on
// Meta Business verification + approved message templates (Phase 3).
// When that's ready, this is the only file that needs a new branch added.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { order_id, profile_id } = req.body || {};
  if (!order_id || !profile_id) {
    return res.status(400).json({ error: 'order_id and profile_id are required' });
  }

  try {
    const [{ data: profile, error: profileErr }, { data: order, error: orderErr }] =
      await Promise.all([
        supabase.from('profiles').select('*').eq('id', profile_id).maybeSingle(),
        supabase.from('orders').select('*').eq('id', order_id).maybeSingle(),
      ]);

    if (profileErr || !profile) {
      console.error('notify-new-order: profile lookup failed', profileErr);
      return res.status(404).json({ error: 'Profile not found' });
    }
    if (orderErr || !order) {
      console.error('notify-new-order: order lookup failed', orderErr);
      return res.status(404).json({ error: 'Order not found' });
    }

    const results = { email: 'skipped', whatsapp: 'skipped' };

    // ── EMAIL ──────────────────────────────────────────────────────
    if (profile.notify_new_order_email) {
      const { data: authUser } = await supabase.auth.admin.getUserById(profile_id);
      const ownerEmail = authUser?.user?.email;

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
    // Logging intent now so nothing silently disappears.
    if (profile.notify_new_order_whatsapp) {
      results.whatsapp = 'preference set — Meta Cloud API integration pending (Phase 3)';
    }

    // ── CUSTOMER RECEIPT (email only — WhatsApp receipt is handled
    // client-side on order-page.html via the "message yourself" flow,
    // since it needs the customer's own browser to open the tab) ─────
    results.customer_receipt = 'skipped';
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
    return res.status(500).json({ error: 'Internal error' });
  }
}
