// ── SHARED INVOICE RENDERER ──────────────────────────────────────────
// Loaded by BOTH orderly-invoices.html and orderly-dashboard.html.
// This is the single source of truth for what an invoice looks like —
// themes, banking details, watermark, color safety. Fix it once here and
// both pages stay in sync automatically. Do not fork/copy this logic back
// into either page — that's exactly what caused the two invoice systems to
// drift out of sync before.
//
// Callers build `settings` (theme/accent_color/font/footer_message/
// show_notes) and `data` (everything about the specific invoice — see
// openInvoiceFromOrder in orderly-invoices.html for a full example) and
// call renderInvoiceHTML(settings, data) to get back a complete HTML string.

const FONT_STACKS = {
  modern: "Arial, Helvetica, sans-serif",
  classic: "Georgia, 'Times New Roman', serif",
  elegant: "'Palatino Linotype', Palatino, 'Book Antiqua', serif",
  clean: "Verdana, Geneva, sans-serif",
};

function invoiceItemRowsHTML(items) {
  return items.map(i => {
    const amount = i.price * i.qty;
    return `<tr><td style="padding:0.65rem 0;border-bottom:1px solid #eee;">${i.name}</td><td style="padding:0.65rem 0;border-bottom:1px solid #eee;text-align:right;">R${i.price}</td><td style="padding:0.65rem 0;border-bottom:1px solid #eee;text-align:right;">${i.qty}</td><td style="padding:0.65rem 0;border-bottom:1px solid #eee;text-align:right;font-weight:600;">R${amount}</td></tr>`;
  }).join('');
}

// Orders placed before delivery_address/rush columns existed stored the
// address and rush flag as plain text stuffed into notes, e.g.
// "Address: 59 8th Avenue mayfair, house. ⚡ RUSH ORDER. <real notes if any>"
// For those historical orders only, pull that structured info back out so
// it renders in the address line / delivery badge like a normal order,
// instead of as a raw text blob under "Notes".
function extractLegacyNotesInfo(rawNotes) {
  if (!rawNotes) return { cleanNotes: '', legacyAddress: '', legacyRush: false };
  let notes = rawNotes;
  let legacyAddress = '';
  let legacyRush = false;

  const addressMatch = notes.match(/Address:\s*(.+?)(?=\s*⚡\s*RUSH ORDER\.?|$)/i);
  if (addressMatch) {
    legacyAddress = addressMatch[1].trim().replace(/\.$/, '');
    notes = notes.replace(addressMatch[0], '').trim();
  }
  if (/⚡?\s*RUSH ORDER\.?/i.test(notes)) {
    legacyRush = true;
    notes = notes.replace(/⚡?\s*RUSH ORDER\.?/i, '').trim();
  }
  return { cleanNotes: notes, legacyAddress, legacyRush };
}

// Builds the fee breakdown lines. Uses real separate delivery/rush figures
// where we have them (orders placed after this fix); falls back to one
// combined line for older orders that only ever stored a single total.
function invoiceFeeLinesHTML(data, color) {
  let html = '';
  const row = (label, amount) => `<div style="display:flex;justify-content:space-between;padding:0.25rem 0;"><span>${label}</span><span>R${amount}</span></div>`;
  const hasSeparateFees = (data.deliveryFeeCharged > 0) || (data.rushFeeCharged > 0);
  if (hasSeparateFees) {
    if (data.deliveryFeeCharged > 0) html += row('Delivery fee', data.deliveryFeeCharged);
    if (data.rushFeeCharged > 0) html += row('Rush fee', data.rushFeeCharged);
  } else if (data.extra > 0) {
    html += row('Delivery / rush fee', data.extra);
  }
  return html;
}

// ── COLOR SAFETY ─────────────────────────────────────────────────────
// Stores can pick any accent color. Without a safeguard, a light pick
// (yellow, pale pink, mint) makes white text on that color unreadable,
// or makes that same color unreadable as text on a near-white surface.
// These two helpers keep every theme legible no matter what's picked.
function hexToRgb(hex) {
  hex = (hex || '').replace('#', '');
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  const num = parseInt(hex, 16);
  if (isNaN(num)) return { r: 45, g: 106, b: 79 };
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}
function relativeLuminance({ r, g, b }) {
  const [R, G, B] = [r, g, b].map(v => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}
// White or dark text — whichever reads better on a background of this color
function readableTextOn(hex) {
  return relativeLuminance(hexToRgb(hex)) > 0.45 ? '#1A2E22' : '#FFFFFF';
}
// Darkens a color if it's too light to use as text on a light/white surface
function safeAccentForText(hex) {
  const rgb = hexToRgb(hex);
  if (relativeLuminance(rgb) <= 0.5) return hex;
  const dark = { r: Math.round(rgb.r * 0.55), g: Math.round(rgb.g * 0.55), b: Math.round(rgb.b * 0.55) };
  return '#' + [dark.r, dark.g, dark.b].map(v => v.toString(16).padStart(2, '0')).join('');
}

function renderInvoiceHTML(settings, data) {
  const accent = settings.accent_color || '#2D6A4F';
  const accentText = safeAccentForText(accent); // for accent used as text on a light background
  const onAccent = readableTextOn(accent);       // for text sitting on top of an accent background
  const onAccentSoft = onAccent === '#FFFFFF' ? 'rgba(255,255,255,0.7)' : 'rgba(26,46,34,0.65)';
  const onAccentSofter = onAccent === '#FFFFFF' ? 'rgba(255,255,255,0.45)' : 'rgba(26,46,34,0.45)';
  const theme = settings.theme || 'classic';
  const font = FONT_STACKS[settings.font] || FONT_STACKS.modern;
  const footerMsg = settings.footer_message || 'Thank you for your business!';
  const showNotes = settings.show_notes !== false;
  const rows = invoiceItemRowsHTML(data.items);
  const feeLines = invoiceFeeLinesHTML(data, accent);
  const brandName = data.poweredByOrderly ? 'Orderly' : data.storeName;
  const logoBlock = (!data.poweredByOrderly && data.logoUrl)
    ? `<img src="${data.logoUrl}" style="width:42px;height:42px;border-radius:8px;object-fit:cover;" />`
    : '';
  // Each theme has its own muted-text tone — the address line now matches
  // whichever theme it's rendered in instead of one hardcoded green.
  const addressBlockFn = (mutedColor) => (data.deliveryAddress)
    ? `<div style="margin-top:3px;font-size:0.78rem;color:${mutedColor};">Deliver to: ${data.deliveryAddress}</div>` : '';

  // Payment/EFT details — only rendered if the store has bank details set up.
  // Mirrors the wording/icons used in the dashboard's per-order invoice modal.
  const bankingBlockFn = ({ bg, border, labelColor, textColor, radius = '8px' }) => {
    if (!data.bankName || !data.bankAccountNumber) return '';
    return `<div style="background:${bg};border-radius:${radius};padding:0.85rem 1rem;margin-top:1rem;">
      <div style="font-size:0.68rem;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:${labelColor};margin-bottom:0.5rem;">Payment details (EFT)</div>
      <div style="font-size:0.82rem;color:${textColor};line-height:1.8;">
        <div>🏦 <strong>Bank:</strong> ${data.bankName}</div>
        <div>👤 <strong>Account holder:</strong> ${data.bankAccountHolder || data.storeName}</div>
        <div>💳 <strong>Account number:</strong> ${data.bankAccountNumber}</div>
        ${data.bankBranchCode ? `<div>🔢 <strong>Branch code:</strong> ${data.bankBranchCode}</div>` : ''}
      </div>
    </div>`;
  };

  const watermarkHTML = data.showWatermark
    ? `<div style="position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:10;display:flex;align-items:center;justify-content:center;">
        <div style="transform:rotate(-32deg);font-size:3.2rem;font-weight:700;color:rgba(15,35,24,0.07);white-space:nowrap;letter-spacing:0.05em;">ORDERLY FREE PLAN · ORDERLY FREE PLAN</div>
      </div>`
    : '';
  // -webkit-print-color-adjust/print-color-adjust inline here (not just in
  // page CSS) because this HTML string gets dropped into three different
  // contexts — the dashboard modal, the Invoices tab, and the live preview
  // iframe's srcdoc — and some of those don't share the parent page's
  // stylesheet. Several of the newer themes rely on full-bleed dark/gradient
  // backgrounds; without this, browsers that default to "no background
  // graphics" in the print dialog silently drop them to white.
  // ── ORDERLY'S TOUCH ──────────────────────────────────────────────────
  // Every theme is store-branded (their logo, colour, font, footer) — but
  // the "INVOICE" wordmark itself always renders in Instrument Serif, the
  // same serif used across the Orderly dashboard/sidebar. It's a quiet
  // consistency thread across all 4 designs, not a loud logo stamp.
  // Imported inline (not just relying on the parent page's <link>) because
  // this HTML also renders inside the customize-look preview iframe's
  // srcdoc, which doesn't inherit the parent document's stylesheet.
  const fontImport = `<style>@import url('https://fonts.googleapis.com/css2?family=Instrument+Serif&display=swap');</style>`;
  const wordmarkFont = "'Instrument Serif', Georgia, serif";

  const page = (inner) => `<div style="font-family:${font};width:100%;box-sizing:border-box;color:#222;background:white;position:relative;-webkit-print-color-adjust:exact;print-color-adjust:exact;">${fontImport}${watermarkHTML}${inner}</div>`;

  // Row renderer used by the light-background themes (Sharp, Gradient).
  const rowsStyled = (items, { border = '#eee', color = '#222' } = {}) => items.map(i => {
    const amount = i.price * i.qty;
    return `<tr><td style="padding:0.65rem 0;border-bottom:1px solid ${border};color:${color};">${i.name}</td><td style="padding:0.65rem 0;border-bottom:1px solid ${border};text-align:right;color:${color};">R${i.price}</td><td style="padding:0.65rem 0;border-bottom:1px solid ${border};text-align:right;color:${color};">${i.qty}</td><td style="padding:0.65rem 0;border-bottom:1px solid ${border};text-align:right;font-weight:600;color:${color};">R${amount}</td></tr>`;
  }).join('');

  // Row renderer for the numbered-index table used by Studio.
  const rowsNumbered = (items, { border = '#eee', color = '#222', numColor = '#999' } = {}) => items.map((i, idx) => {
    const amount = i.price * i.qty;
    const n = String(idx + 1).padStart(2, '0');
    return `<tr><td style="padding:0.65rem 0.5rem 0.65rem 0;border-bottom:1px solid ${border};color:${numColor};font-size:0.8rem;">${n}</td><td style="padding:0.65rem 0;border-bottom:1px solid ${border};color:${color};">${i.name}</td><td style="padding:0.65rem 0;border-bottom:1px solid ${border};text-align:right;color:${color};">R${i.price}</td><td style="padding:0.65rem 0;border-bottom:1px solid ${border};text-align:right;color:${color};">${i.qty}</td><td style="padding:0.65rem 0;border-bottom:1px solid ${border};text-align:right;font-weight:600;color:${color};">R${amount}</td></tr>`;
  }).join('');

  const themes = {
    // "Sharp" — clean minimal black/white design, generous spacing,
    // no overlapping decorative shapes (reference: JHON COMPANY)
    classic: () => page(`
      <div style="padding:2.75rem 3rem 0;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;">
          <div style="display:flex;align-items:center;gap:12px;">
            ${logoBlock || `<div style="width:32px;height:32px;background:#1A1A1A;display:flex;align-items:center;justify-content:center;font-size:0.85rem;color:white;">${(brandName || 'O')[0]}</div>`}
            <div style="font-size:0.95rem;font-weight:700;letter-spacing:0.04em;color:#1A1A1A;">${brandName.toUpperCase()}</div>
          </div>
          <div style="text-align:right;">
            <div style="font-family:${wordmarkFont};font-size:1.9rem;font-weight:600;color:#1A1A1A;line-height:1;">Invoice</div>
            <div style="font-size:0.72rem;color:#999;margin-top:8px;letter-spacing:0.04em;">DATE ${data.date.toUpperCase()}</div>
          </div>
        </div>
        ${data.poweredByOrderly ? `<div style="font-size:0.68rem;color:#bbb;margin-top:0.5rem;">Powered by Orderly</div>` : ''}
        <div style="height:1px;background:#eee;margin:1.75rem 0;"></div>
        <div style="display:flex;justify-content:space-between;">
          <div>
            <div style="font-size:0.68rem;text-transform:uppercase;letter-spacing:0.1em;color:#999;font-weight:600;">Invoice To</div>
            <div style="font-size:1rem;font-weight:700;margin-top:6px;color:#1A1A1A;">${data.customerName}</div>
            <div style="font-size:0.8rem;color:#999;margin-top:2px;">${data.customerPhone || ''}</div>
            ${addressBlockFn('#999')}
          </div>
          <div style="text-align:right;">
            <div style="font-size:0.68rem;text-transform:uppercase;letter-spacing:0.1em;color:#999;font-weight:600;">Invoice No.</div>
            <div style="font-size:0.85rem;color:#1A1A1A;margin-top:6px;">${data.invoiceNumber}</div>
            <div style="margin-top:8px;display:inline-block;background:${accent}14;color:${accentText};padding:3px 11px;border-radius:20px;font-size:0.72rem;font-weight:600;">${data.deliveryLabel}</div>
          </div>
        </div>
      </div>
      <div style="padding:2rem 3rem 0;">
        <table style="width:100%;border-collapse:collapse;">
          <thead><tr>
            <th style="text-align:left;padding:0 0 0.7rem;font-size:0.68rem;text-transform:uppercase;letter-spacing:0.08em;color:#999;border-bottom:1.5px solid #1A1A1A;">Item Description</th>
            <th style="text-align:right;padding:0 0 0.7rem;font-size:0.68rem;text-transform:uppercase;letter-spacing:0.08em;color:#999;border-bottom:1.5px solid #1A1A1A;">Price</th>
            <th style="text-align:right;padding:0 0 0.7rem;font-size:0.68rem;text-transform:uppercase;letter-spacing:0.08em;color:#999;border-bottom:1.5px solid #1A1A1A;">Qty</th>
            <th style="text-align:right;padding:0 0 0.7rem;font-size:0.68rem;text-transform:uppercase;letter-spacing:0.08em;color:#999;border-bottom:1.5px solid #1A1A1A;">Total</th>
          </tr></thead>
          <tbody style="font-size:0.9rem;">${rowsStyled(data.items, { border: '#f0f0f0', color: '#333' })}</tbody>
        </table>
        <div style="max-width:280px;margin-left:auto;padding-top:1rem;">
          <div style="display:flex;justify-content:space-between;font-size:0.85rem;color:#999;padding:0.25rem 0;"><span>Subtotal</span><span>R${data.subtotal}</span></div>
          ${feeLines}
          <div style="display:flex;justify-content:space-between;font-size:1.2rem;font-weight:800;color:#1A1A1A;border-top:2px solid #1A1A1A;margin-top:0.6rem;padding-top:0.7rem;"><span>Total Due</span><span style="color:${accentText};">R${data.total}</span></div>
        </div>
      </div>
      ${(showNotes && data.notes) ? `<div style="padding:1.75rem 3rem 0;"><div style="font-size:0.68rem;text-transform:uppercase;letter-spacing:0.08em;color:#999;font-weight:600;">Terms &amp; Notes</div><div style="font-size:0.84rem;color:#666;margin-top:5px;">${data.notes}</div></div>` : ''}
      <div style="padding:2rem 3rem 0;display:flex;justify-content:space-between;align-items:flex-end;gap:2rem;flex-wrap:wrap;">
        <div style="flex:1;min-width:200px;">${bankingBlockFn({ bg: '#FAFAFA', labelColor: '#999', textColor: '#444', radius: '6px' })}</div>
        <div style="text-align:right;">
          <div style="font-family:'Brush Script MT',cursive;font-size:1.35rem;color:#333;">${footerMsg}</div>
          <div style="font-size:0.7rem;color:#aaa;margin-top:3px;">${brandName}</div>
        </div>
      </div>
      <div style="margin-top:2.25rem;padding:1.1rem 3rem;border-top:1px solid #eee;text-align:center;">
        <div style="font-size:0.76rem;color:#999;letter-spacing:0.02em;">${data.contactLine}</div>
      </div>`),

    // "Executive" — clean white corporate design (reference: image 2, inverted)
    bold: () => page(`
      <div style="background:white;padding:2.5rem 3rem;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;">
          <div style="display:flex;align-items:center;gap:12px;">
            ${logoBlock || `<div style="width:38px;height:38px;border-radius:8px;background:#F0F0F0;display:flex;align-items:center;justify-content:center;font-size:1rem;color:#1A1A1A;">${(brandName || 'O')[0]}</div>`}
            <div>
              <div style="color:#1A1A1A;font-size:1.05rem;font-weight:600;">${brandName}</div>
              <div style="color:#999;font-size:0.68rem;letter-spacing:0.06em;text-transform:uppercase;">Idea for invoice</div>
            </div>
          </div>
          <div style="text-align:right;">
            <div style="font-family:${wordmarkFont};font-size:2rem;color:#1A1A1A;font-weight:600;">Invoice</div>
            <div style="font-size:0.76rem;color:#999;margin-top:2px;">No. ${data.invoiceNumber}</div>
          </div>
        </div>
        ${data.poweredByOrderly ? `<div style="font-size:0.68rem;color:#bbb;margin-top:0.75rem;">Powered by Orderly</div>` : ''}
        <div style="height:1px;background:#eee;margin:1.75rem 0;"></div>
        <div style="display:flex;justify-content:space-between;align-items:flex-start;">
          <div>
            <div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.08em;color:#aaa;">Invoice To</div>
            <div style="font-size:1.05rem;font-weight:600;color:#1A1A1A;margin-top:4px;">${data.customerName}</div>
            <div style="font-size:0.82rem;color:#888;margin-top:2px;">${data.customerPhone || ''}</div>
            ${addressBlockFn('#888')}
          </div>
          <div style="text-align:right;">
            <div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.08em;color:#aaa;">Due Date</div>
            <div style="font-size:0.9rem;color:#1A1A1A;margin-top:4px;">${data.date}</div>
            <div style="margin-top:0.6rem;display:inline-block;background:${accent};color:${onAccent};padding:5px 14px;border-radius:20px;font-size:0.8rem;font-weight:600;">${data.deliveryLabel}</div>
          </div>
        </div>
      </div>
      <div style="background:#FAFAFA;padding:2rem 3rem;">
        <table style="width:100%;border-collapse:collapse;">
          <thead><tr>
            <th style="text-align:left;padding:0 0 0.6rem;font-size:0.7rem;text-transform:uppercase;letter-spacing:0.06em;color:#999;border-bottom:1px solid #e5e5e5;">Description</th>
            <th style="text-align:right;padding:0 0 0.6rem;font-size:0.7rem;text-transform:uppercase;letter-spacing:0.06em;color:#999;border-bottom:1px solid #e5e5e5;">Price</th>
            <th style="text-align:right;padding:0 0 0.6rem;font-size:0.7rem;text-transform:uppercase;letter-spacing:0.06em;color:#999;border-bottom:1px solid #e5e5e5;">Qty</th>
            <th style="text-align:right;padding:0 0 0.6rem;font-size:0.7rem;text-transform:uppercase;letter-spacing:0.06em;color:#999;border-bottom:1px solid #e5e5e5;">Total</th>
          </tr></thead>
          <tbody style="font-size:0.9rem;">${rowsStyled(data.items, { border: '#e5e5e5', color: '#333' })}</tbody>
        </table>
        <div style="max-width:300px;margin-left:auto;padding-top:1rem;">
          <div style="display:flex;justify-content:space-between;font-size:0.85rem;color:#999;padding:0.25rem 0;"><span>Sub Total</span><span>R${data.subtotal}</span></div>
          ${feeLines}
          <div style="display:flex;justify-content:space-between;align-items:center;background:${accent};border-radius:6px;padding:0.7rem 1rem;margin-top:0.6rem;">
            <span style="color:${onAccent};font-weight:600;font-size:0.85rem;letter-spacing:0.04em;">GRAND TOTAL</span>
            <span style="color:${onAccent};font-weight:800;font-size:1.15rem;">R${data.total}</span>
          </div>
        </div>
      </div>
      <div style="background:white;padding:1.75rem 3rem;display:flex;gap:2.5rem;">
        <div style="flex:1;">${bankingBlockFn({ bg: '#FAFAFA', labelColor: '#999', textColor: '#444', radius: '6px' })}</div>
        ${(showNotes && data.notes) ? `<div style="flex:1;"><div style="font-size:0.68rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#999;">Terms</div><div style="font-size:0.82rem;color:#555;margin-top:6px;line-height:1.6;">${data.notes}</div></div>` : ''}
      </div>
      <div style="background:white;padding:0 3rem 2.25rem;text-align:center;border-top:1px solid #eee;">
        <div style="padding-top:1.5rem;font-size:0.78rem;letter-spacing:0.1em;text-transform:uppercase;color:#666;font-weight:600;">Thank You For Your Business</div>
        <div style="font-size:0.76rem;color:#aaa;margin-top:4px;">${data.contactLine}</div>
      </div>`),

    // "Gradient" — soft gradient-wave header, card body (reference: image 3)
    minimal: () => page(`
      <div style="background:linear-gradient(135deg, ${accent} 0%, ${accentText} 100%);padding:2.25rem 3rem 3rem;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;">
          <div style="display:flex;align-items:center;gap:10px;">
            ${logoBlock || `<div style="width:32px;height:32px;border-radius:8px;background:rgba(255,255,255,0.25);display:flex;align-items:center;justify-content:center;font-size:0.9rem;color:${onAccent};">${(brandName || 'O')[0]}</div>`}
            <div style="color:${onAccent};font-size:0.68rem;text-transform:uppercase;letter-spacing:0.1em;">${brandName}<br><span style="opacity:0.65;font-size:0.62rem;letter-spacing:0.06em;">Idea for invoice</span></div>
          </div>
          <div style="text-align:right;">
            <div style="font-family:${wordmarkFont};font-size:1.7rem;font-weight:600;color:${onAccent};">Invoice</div>
            <div style="font-size:0.72rem;color:${onAccentSoft};margin-top:2px;">No. ${data.invoiceNumber} &nbsp;·&nbsp; ${data.date}</div>
          </div>
        </div>
      </div>
      <div style="padding:2rem 3rem 0;margin-top:-1.5rem;">
        <div style="background:white;border-radius:14px;box-shadow:0 2px 12px rgba(0,0,0,0.06);padding:1.75rem 2rem;">
          <div style="display:flex;justify-content:space-between;margin-bottom:1.5rem;">
            <div>
              <div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.06em;color:#aaa;">Invoice To</div>
              <div style="font-size:1rem;font-weight:600;margin-top:3px;">${data.customerName}</div>
              <div style="font-size:0.8rem;color:#aaa;">${data.customerPhone || ''}</div>
              ${addressBlockFn('#aaa')}
            </div>
            <div style="text-align:right;">
              <div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.06em;color:#aaa;">Due Date</div>
              <div style="font-size:0.85rem;margin-top:3px;">${data.date}</div>
              <div style="margin-top:6px;display:inline-block;background:${accent}18;color:${accentText};padding:3px 10px;border-radius:12px;font-size:0.74rem;font-weight:600;">${data.deliveryLabel}</div>
            </div>
          </div>
          <table style="width:100%;border-collapse:collapse;">
            <thead><tr>
              <th style="text-align:left;padding:8px 0;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.05em;color:#aaa;border-bottom:1.5px solid #eee;">Description</th>
              <th style="text-align:right;padding:8px 0;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.05em;color:#aaa;border-bottom:1.5px solid #eee;">Price</th>
              <th style="text-align:right;padding:8px 0;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.05em;color:#aaa;border-bottom:1.5px solid #eee;">Qty</th>
              <th style="text-align:right;padding:8px 0;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.05em;color:#aaa;border-bottom:1.5px solid #eee;">Total</th>
            </tr></thead>
            <tbody style="font-size:0.9rem;">${rowsStyled(data.items, { border: '#f0f0f0', color: '#333' })}</tbody>
          </table>
          <div style="max-width:280px;margin-left:auto;padding-top:0.75rem;">
            <div style="display:flex;justify-content:space-between;font-size:0.85rem;color:#999;padding:3px 0;"><span>Subtotal</span><span>R${data.subtotal}</span></div>
            ${feeLines}
            <div style="display:flex;justify-content:space-between;align-items:center;background:${accent};border-radius:8px;padding:0.65rem 1rem;margin-top:8px;">
              <span style="color:${onAccent};font-weight:600;font-size:0.85rem;">TOTAL DUE</span>
              <span style="color:${onAccent};font-weight:800;font-size:1.1rem;">R${data.total}</span>
            </div>
          </div>
        </div>
      </div>
      ${(showNotes && data.notes) ? `<div style="padding:1.5rem 3rem 0;"><div style="background:${accent}0d;border-radius:8px;padding:0.85rem 1rem;font-size:0.85rem;color:#666;"><b style="color:${accentText};">Note:</b> ${data.notes}</div></div>` : ''}
      <div style="padding:1.75rem 3rem 2.25rem;">
        <div style="font-size:0.9rem;font-weight:700;margin-bottom:1rem;">${footerMsg}</div>
        <div style="display:flex;gap:2rem;flex-wrap:wrap;">
          <div style="flex:1;min-width:140px;">
            <div style="font-size:0.68rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#aaa;">Questions?</div>
            <div style="font-size:0.8rem;color:#666;margin-top:4px;">${data.contactLine}</div>
          </div>
          <div style="flex:1;min-width:180px;">${bankingBlockFn({ bg: '#FAFAFA', labelColor: '#aaa', textColor: '#555', radius: '8px' }) || `<div style="font-size:0.68rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#aaa;">Payment</div><div style="font-size:0.8rem;color:#666;margin-top:4px;">Cash on delivery / collection</div>`}</div>
        </div>
      </div>`),

    // "Studio" — soft pastel design with hero total-due, tinted to the
    // store's own accent colour (reference: Brand Name)
    warm: () => page(`
      <div style="background:${accent}0d;padding:2.25rem 3rem 1.75rem;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;">
          <div style="display:flex;align-items:center;gap:12px;">
            ${logoBlock || `<div style="width:34px;height:34px;border-radius:10px;background:${accent};display:flex;align-items:center;justify-content:center;font-size:0.95rem;color:${onAccent};">${(brandName || 'O')[0]}</div>`}
            <div>
              <div style="font-size:1rem;font-weight:700;color:#1A1A1A;">${brandName}</div>
              <div style="font-size:0.66rem;color:#999;letter-spacing:0.05em;text-transform:uppercase;">Idea for invoice</div>
            </div>
          </div>
          <div style="text-align:right;">
            <div style="font-family:${wordmarkFont};font-size:1.9rem;font-weight:600;color:#1A1A1A;">Invoice</div>
            <div style="font-size:0.76rem;color:#999;margin-top:2px;">${data.date}</div>
          </div>
        </div>
        ${data.poweredByOrderly ? `<div style="font-size:0.68rem;color:#bbb;margin-top:0.5rem;">Powered by Orderly</div>` : ''}
        <div style="height:1px;background:${accent}22;margin:1.5rem 0;"></div>
        <div style="display:flex;justify-content:space-between;align-items:flex-start;">
          <div>
            <div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.06em;color:#999;">Invoice Number</div>
            <div style="font-size:0.88rem;color:#333;margin-top:3px;">${data.invoiceNumber}</div>
            <div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.06em;color:#999;margin-top:0.9rem;">To</div>
            <div style="font-size:0.95rem;font-weight:600;color:#1A1A1A;margin-top:2px;">${data.customerName}</div>
            <div style="font-size:0.8rem;color:#999;">${data.customerPhone || ''}</div>
            ${addressBlockFn('#999')}
          </div>
          <div style="text-align:right;">
            <div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.06em;color:#999;">Total Due</div>
            <div style="font-size:1.7rem;font-weight:800;color:${accentText};margin-top:2px;">R${data.total}</div>
            <div style="margin-top:6px;display:inline-block;background:white;color:${accentText};padding:3px 12px;border-radius:12px;font-size:0.74rem;font-weight:600;">${data.deliveryLabel}</div>
          </div>
        </div>
      </div>
      <div style="padding:1.75rem 3rem 0;">
        <table style="width:100%;border-collapse:collapse;">
          <thead><tr>
            <th style="text-align:left;padding:8px 0;font-size:0.7rem;text-transform:uppercase;letter-spacing:0.05em;color:#aaa;border-bottom:1.5px solid #eee;">Item Description</th>
            <th style="text-align:right;padding:8px 0;font-size:0.7rem;text-transform:uppercase;letter-spacing:0.05em;color:#aaa;border-bottom:1.5px solid #eee;">Unit Price</th>
            <th style="text-align:right;padding:8px 0;font-size:0.7rem;text-transform:uppercase;letter-spacing:0.05em;color:#aaa;border-bottom:1.5px solid #eee;">Qty</th>
            <th style="text-align:right;padding:8px 0;font-size:0.7rem;text-transform:uppercase;letter-spacing:0.05em;color:#aaa;border-bottom:1.5px solid #eee;">Total</th>
          </tr></thead>
          <tbody style="font-size:0.9rem;">${rowsStyled(data.items, { border: '#f2f2f2', color: '#333' })}</tbody>
        </table>
        <div style="max-width:280px;margin-left:auto;padding-top:0.75rem;">
          <div style="display:flex;justify-content:space-between;font-size:0.85rem;color:#999;padding:3px 0;"><span>Subtotal</span><span>R${data.subtotal}</span></div>
          ${feeLines}
          <div style="display:flex;justify-content:space-between;font-size:1.05rem;font-weight:800;color:#1A1A1A;border-top:2px solid ${accent}33;margin-top:6px;padding-top:8px;"><span>Total Due</span><span>R${data.total}</span></div>
        </div>
      </div>
      ${(showNotes && data.notes) ? `<div style="padding:1.5rem 3rem 0;"><div style="background:${accent}0d;border-radius:8px;padding:0.8rem 1rem;font-size:0.84rem;color:#666;"><b style="color:${accentText};">Note:</b> ${data.notes}</div></div>` : ''}
      <div style="padding:1.75rem 3rem 2rem;margin-top:0.5rem;display:flex;gap:2.5rem;flex-wrap:wrap;border-top:1px solid #f0f0f0;">
        <div style="flex:1;min-width:160px;padding-top:1.5rem;">${bankingBlockFn({ bg: `${accent}0d`, labelColor: '#aaa', textColor: '#555', radius: '8px' }) || `<div style="font-size:0.68rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#aaa;">Payment Method</div><div style="font-size:0.8rem;color:#666;margin-top:4px;">Cash on delivery / collection</div>`}</div>
        <div style="flex:1;min-width:160px;padding-top:1.5rem;">
          <div style="font-size:0.68rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#aaa;">Terms &amp; Conditions</div>
          <div style="font-size:0.8rem;color:#666;margin-top:4px;">${footerMsg}</div>
          <div style="font-size:0.78rem;color:#aaa;margin-top:6px;">${data.contactLine}</div>
        </div>
      </div>`),
  };

  const themeFn = themes[theme] || themes.classic;
  return themeFn();
}
