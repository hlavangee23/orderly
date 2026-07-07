// /api/send-trial-emails.js
// Runs daily via Vercel Cron (see vercel.json). Checks every Free-plan
// account's trial age and sends the 10-day and 3-day reminder emails.
//
// Requires these environment variables in Vercel:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (service role — bypasses RLS)
//   RESEND_API_KEY
//   RESEND_FROM  e.g. "Orderly <hello@orderlyapp.co.za>" — only works once
//                the sending domain is verified in Resend
//
// NOTE: this is safe to deploy now — it will simply fail Resend sends
// (and log the error) until the orderlyapp.co.za domain is verified.
// It will not crash or affect the rest of the app either way.

const TRIAL_DAYS = 30;

export default async function handler(req, res) {
  // Vercel Cron sends a GET request with this header — reject anything else
  if (req.headers['x-vercel-cron'] !== '1' && process.env.NODE_ENV === 'production') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const headers = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
  };

  // Pull every Free-plan account still within (or just past) their trial window
  const profilesRes = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?plan=eq.free&trial_start_date=not.is.null&select=id,store_name,store_slug,whatsapp,trial_start_date,trial_email_10day_sent_at,trial_email_3day_sent_at`,
    { headers }
  );
  const profiles = await profilesRes.json();

  const results = { checked: profiles.length, sent10: 0, sent3: 0, errors: [] };

  for (const profile of profiles) {
    const daysLeft = TRIAL_DAYS - Math.floor(
      (Date.now() - new Date(profile.trial_start_date)) / (1000 * 60 * 60 * 24)
    );

    try {
      // 10 days left — heads-up email, matches when the dashboard banner turns amber
      if (daysLeft === 10 && !profile.trial_email_10day_sent_at) {
        const email = await getUserEmail(SUPABASE_URL, headers, profile.id);
        if (email) {
          await sendTrialEmail(profile, email, 'ten_day');
          await markSent(SUPABASE_URL, headers, profile.id, 'trial_email_10day_sent_at');
          results.sent10++;
        }
      }

      // 3 days left — final reminder with a 15%-off-for-2-months code
      if (daysLeft === 3 && !profile.trial_email_3day_sent_at) {
        const email = await getUserEmail(SUPABASE_URL, headers, profile.id);
        if (email) {
          const code = await createDiscountCode(SUPABASE_URL, headers, profile.id);
          await sendTrialEmail(profile, email, 'three_day', code);
          await markSent(SUPABASE_URL, headers, profile.id, 'trial_email_3day_sent_at');
          results.sent3++;
        }
      }
    } catch (err) {
      results.errors.push({ profile_id: profile.id, error: err.message });
    }
  }

  return res.status(200).json(results);
}

async function markSent(SUPABASE_URL, headers, profileId, column) {
  await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${profileId}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ [column]: new Date().toISOString() }),
  });
}

async function getUserEmail(SUPABASE_URL, headers, userId) {
  const resp = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, { headers });
  if (!resp.ok) return null;
  const data = await resp.json();
  return data?.email || null;
}

async function createDiscountCode(SUPABASE_URL, headers, profileId) {
  const code = 'ORDERLY15-' + Math.random().toString(36).slice(2, 8).toUpperCase();
  await fetch(`${SUPABASE_URL}/rest/v1/discount_tokens`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ profile_id: profileId, code, discount_percent: 15, valid_months: 2 }),
  });
  return code;
}

async function sendTrialEmail(profile, email, type, discountCode) {
  const dashboardUrl = 'https://orderlyapp.co.za/orderly-dashboard.html';
  const firstName = (profile.store_name || 'there').split(' ')[0];

  const subject = type === 'ten_day'
    ? `Your Orderly Pro trial ends in 10 days`
    : `Last chance — your Orderly Pro trial ends in 3 days`;

  const html = type === 'ten_day'
    ? tenDayTemplate(firstName, dashboardUrl)
    : threeDayTemplate(firstName, dashboardUrl, discountCode);

  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM || 'Orderly <hello@orderlyapp.co.za>',
      to: email,
      subject,
      html,
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Resend error: ${errText}`);
  }
}

function baseStyle() {
  return `font-family:'DM Sans',Arial,sans-serif;background:#F8FAF7;padding:2rem;`;
}

function tenDayTemplate(name, dashboardUrl) {
  return `
  <div style="${baseStyle()}">
    <div style="max-width:480px;margin:0 auto;background:white;border-radius:16px;overflow:hidden;border:1px solid #D6EAD9;">
      <div style="background:#1A3D2B;padding:1.5rem 2rem;">
        <span style="font-family:Georgia,serif;font-size:1.3rem;color:white;">Order<span style="color:#7A9A85;">ly</span></span>
      </div>
      <div style="padding:2rem;">
        <h1 style="font-family:Georgia,serif;font-size:1.4rem;color:#0F2318;margin:0 0 1rem;">10 days left on your Pro trial, ${name}</h1>
        <p style="font-size:0.9rem;color:#3D5A47;line-height:1.6;">You've had unlimited orders, menu items, and invoices for the last 20 days. In 10 days, your account moves to the Free plan — 50 orders/month, 20 menu items, and Orderly branding on your invoices.</p>
        <p style="font-size:0.9rem;color:#3D5A47;line-height:1.6;">No rush — just wanted to give you a heads up.</p>
        <a href="${dashboardUrl}" style="display:inline-block;margin-top:1rem;background:#1A3D2B;color:white;text-decoration:none;padding:0.75rem 1.5rem;border-radius:10px;font-size:0.9rem;font-weight:500;">Go to my dashboard →</a>
      </div>
    </div>
  </div>`;
}

function threeDayTemplate(name, dashboardUrl, code) {
  return `
  <div style="${baseStyle()}">
    <div style="max-width:480px;margin:0 auto;background:white;border-radius:16px;overflow:hidden;border:1px solid #D6EAD9;">
      <div style="background:#1A3D2B;padding:1.5rem 2rem;">
        <span style="font-family:Georgia,serif;font-size:1.3rem;color:white;">Order<span style="color:#7A9A85;">ly</span></span>
      </div>
      <div style="padding:2rem;">
        <h1 style="font-family:Georgia,serif;font-size:1.4rem;color:#0F2318;margin:0 0 1rem;">3 days left, ${name} — here's 15% off</h1>
        <p style="font-size:0.9rem;color:#3D5A47;line-height:1.6;">Your Pro trial ends in 3 days. Upgrade now and get <strong>15% off your first 2 months</strong> with this code:</p>
        <div style="background:#F2FAF5;border:1px solid #E8F4ED;border-radius:10px;padding:0.9rem;text-align:center;margin:1rem 0;font-family:monospace;font-size:1.1rem;color:#1A3D2B;font-weight:600;">${code}</div>
        <a href="${dashboardUrl}" style="display:inline-block;margin-top:0.5rem;background:#1A3D2B;color:white;text-decoration:none;padding:0.75rem 1.5rem;border-radius:10px;font-size:0.9rem;font-weight:500;">Upgrade to Pro →</a>
      </div>
    </div>
  </div>`;
}
