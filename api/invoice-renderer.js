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
  const page = (inner) => `<div style="font-family:${font};width:100%;box-sizing:border-box;color:#222;background:white;position:relative;">${watermarkHTML}${inner}</div>`;

  const themes = {
    classic: () => page(`
      <div style="background:${accent};padding:2.5rem 3rem;display:flex;justify-content:space-between;align-items:center;">
        <div style="display:flex;align-items:center;gap:12px;">
          ${logoBlock}
          <div style="font-size:1.4rem;color:${onAccent};">${brandName}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:1.6rem;letter-spacing:0.1em;color:${onAccentSoft};">INVOICE</div>
          <div style="font-size:0.8rem;color:${onAccentSofter};">INV-${data.invoiceNumber}</div>
        </div>
      </div>
      ${data.poweredByOrderly ? `<div style="font-size:0.68rem;color:${onAccentSofter};padding:0.4rem 3rem;background:${accent};">Powered by Orderly</div>` : ''}
      <div style="padding:2.5rem 3rem 1rem;">
        <div style="display:flex;justify-content:space-between;margin-bottom:2rem;">
          <div>
            <div style="font-size:0.72rem;text-transform:uppercase;letter-spacing:0.06em;color:#7A9A85;">Invoice to</div>
            <div style="font-size:1.15rem;font-weight:600;">${data.customerName}</div>
            <div style="font-size:0.85rem;color:#7A9A85;margin-top:2px;">${data.customerPhone || ''}</div>
            ${addressBlockFn('#7A9A85')}
          </div>
          <div style="text-align:right;">
            <div style="font-size:0.72rem;text-transform:uppercase;letter-spacing:0.06em;color:#7A9A85;">Date</div>
            <div style="font-size:0.95rem;font-weight:500;">${data.date}</div>
            <div style="font-size:0.75rem;margin-top:8px;padding:4px 12px;border-radius:20px;display:inline-block;background:#E8F4ED;color:${accentText};">${data.deliveryLabel}</div>
          </div>
        </div>
        <table style="width:100%;border-collapse:collapse;">
          <thead><tr>
            <th style="background:#F2FAF5;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.04em;color:${accentText};text-align:left;padding:0.75rem 1rem;">Description</th>
            <th style="background:#F2FAF5;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.04em;color:${accentText};text-align:right;padding:0.75rem 1rem;">Price</th>
            <th style="background:#F2FAF5;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.04em;color:${accentText};text-align:right;padding:0.75rem 1rem;">Qty</th>
            <th style="background:#F2FAF5;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.04em;color:${accentText};text-align:right;padding:0.75rem 1rem;">Amount</th>
          </tr></thead>
          <tbody style="font-size:0.92rem;">${rows.replace(/<td/g, '<td style="padding-left:1rem;padding-right:1rem;"')}</tbody>
        </table>
        <div style="max-width:320px;margin-left:auto;padding:1rem 0 0;">
          <div style="display:flex;justify-content:space-between;font-size:0.9rem;padding:0.25rem 0;"><span>Subtotal</span><span>R${data.subtotal}</span></div>
          ${feeLines}
          <div style="display:flex;justify-content:space-between;font-size:1.15rem;font-weight:700;border-top:2px solid #222;margin-top:0.5rem;padding-top:0.75rem;"><span>Total due</span><span>R${data.total}</span></div>
        </div>
        ${(showNotes && data.notes) ? `<div style="margin-top:2rem;"><div style="font-size:0.72rem;text-transform:uppercase;letter-spacing:0.06em;color:#7A9A85;margin-bottom:4px;">Notes</div><div style="font-size:0.88rem;background:#F8FAF7;border-radius:8px;padding:0.85rem 1rem;">${data.notes}</div></div>` : ''}
        ${bankingBlockFn({ bg: '#F8FAF7', labelColor: '#7A9A85', textColor: '#3D5A47' })}
      </div>
      <div style="background:#F2FAF5;padding:1.5rem 3rem;text-align:center;border-top:1px solid #e5e5e5;margin-top:1rem;">
        <div style="font-size:0.95rem;font-weight:500;">${footerMsg}</div>
        <div style="font-size:0.78rem;color:#7A9A85;margin-top:2px;">${data.contactLine}</div>
      </div>`),

    bold: () => page(`
      <div style="background:#1A1A1A;padding:2.5rem 3rem;display:flex;justify-content:space-between;align-items:flex-start;">
        <div style="display:flex;align-items:center;gap:12px;">
          ${logoBlock}
          <div style="color:white;font-size:1.1rem;font-weight:600;">${brandName}</div>
        </div>
        <div style="font-size:2.2rem;font-weight:800;letter-spacing:0.04em;color:white;">INVOICE</div>
      </div>
      <div style="background:${accent};height:5px;"></div>
      <div style="padding:2rem 3rem 0;display:flex;justify-content:space-between;">
        <div>
          <div style="font-size:0.75rem;text-transform:uppercase;letter-spacing:0.05em;color:#999;">Invoice to</div>
          <div style="font-size:1.1rem;font-weight:700;">${data.customerName}</div>
          <div style="font-size:0.85rem;color:#999;">${data.customerPhone || ''}</div>
          ${addressBlockFn('#999')}
        </div>
        <div style="text-align:right;">
          <div style="font-size:0.78rem;color:#999;">Invoice No: <b>${data.invoiceNumber}</b></div>
          <div style="font-size:0.78rem;color:#999;">Invoice Date: <b>${data.date}</b></div>
          <div style="font-size:0.78rem;color:${accentText};font-weight:600;margin-top:2px;">${data.deliveryLabel}</div>
        </div>
      </div>
      <div style="padding:1.5rem 3rem;">
        <table style="width:100%;border-collapse:collapse;">
          <thead><tr style="background:#1A1A1A;">
            <th style="padding:0.8rem 1rem;color:white;font-size:0.78rem;text-align:left;">DESCRIPTION</th>
            <th style="padding:0.8rem 1rem;color:white;font-size:0.78rem;text-align:right;">PRICE</th>
            <th style="padding:0.8rem 1rem;color:white;font-size:0.78rem;text-align:right;">QTY</th>
            <th style="padding:0.8rem 1rem;color:white;font-size:0.78rem;text-align:right;">AMOUNT</th>
          </tr></thead>
          <tbody style="font-size:0.92rem;">${rows.replace(/<td/g, '<td style="padding-left:1rem;padding-right:1rem;"')}</tbody>
        </table>
        <div style="max-width:320px;margin-left:auto;padding-top:0.75rem;">
          <div style="display:flex;justify-content:space-between;font-size:0.88rem;color:#999;padding:0.25rem 0;"><span>Subtotal</span><span>R${data.subtotal}</span></div>
          ${feeLines}
        </div>
      </div>
      <div style="background:${accent};margin:0 3rem;padding:1rem 1.5rem;display:flex;justify-content:space-between;align-items:center;">
        <span style="color:${onAccent};font-weight:600;font-size:1rem;">TOTAL</span>
        <span style="color:${onAccent};font-weight:800;font-size:1.3rem;">R${data.total}</span>
      </div>
      ${(showNotes && data.notes) ? `<div style="padding:1.5rem 3rem 0;"><div style="font-size:0.75rem;font-weight:700;">TERMS & NOTES</div><div style="font-size:0.85rem;color:#666;margin-top:4px;">${data.notes}</div></div>` : ''}
      <div style="padding:1.5rem 3rem 0;">${bankingBlockFn({ bg: '#F5F5F5', labelColor: '#999', textColor: '#333', radius: '4px' })}</div>
      <div style="padding:2rem 3rem 2.5rem;text-align:center;">
        <div style="font-size:0.95rem;font-weight:600;">${footerMsg}</div>
        <div style="font-size:0.78rem;color:#999;margin-top:2px;">${data.contactLine}</div>
      </div>`),

    minimal: () => page(`
      <div style="padding:3rem;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:2.5rem;">
          <div style="display:flex;align-items:center;gap:12px;">
            ${logoBlock}
            <div style="font-size:1.3rem;">${brandName}</div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:1.05rem;letter-spacing:0.15em;color:${accentText};">INVOICE</div>
            <div style="font-size:0.78rem;color:#999;margin-top:2px;">No. ${data.invoiceNumber}</div>
          </div>
        </div>
        <div style="display:flex;justify-content:space-between;margin-bottom:2rem;">
          <div>
            <div style="font-size:0.72rem;text-transform:uppercase;letter-spacing:0.08em;color:#aaa;">Billed to</div>
            <div style="font-size:1rem;margin-top:3px;">${data.customerName}</div>
            <div style="font-size:0.8rem;color:#aaa;">${data.customerPhone || ''}</div>
            ${addressBlockFn('#aaa')}
          </div>
          <div style="text-align:right;">
            <div style="font-size:0.72rem;text-transform:uppercase;letter-spacing:0.08em;color:#aaa;">Date</div>
            <div style="font-size:0.9rem;margin-top:3px;">${data.date}</div>
            <div style="font-size:0.78rem;color:${accentText};margin-top:5px;">${data.deliveryLabel}</div>
          </div>
        </div>
        <table style="width:100%;border-collapse:collapse;border-top:1.5px solid #222;">
          <thead><tr>
            <th style="text-align:left;padding:10px 0;font-size:0.75rem;text-transform:uppercase;letter-spacing:0.05em;color:#999;border-bottom:1.5px solid #222;">Item</th>
            <th style="text-align:right;padding:10px 0;font-size:0.75rem;text-transform:uppercase;letter-spacing:0.05em;color:#999;border-bottom:1.5px solid #222;">Price</th>
            <th style="text-align:right;padding:10px 0;font-size:0.75rem;text-transform:uppercase;letter-spacing:0.05em;color:#999;border-bottom:1.5px solid #222;">Qty</th>
            <th style="text-align:right;padding:10px 0;font-size:0.75rem;text-transform:uppercase;letter-spacing:0.05em;color:#999;border-bottom:1.5px solid #222;">Amount</th>
          </tr></thead>
          <tbody style="font-size:0.92rem;">${rows}</tbody>
        </table>
        <div style="max-width:320px;margin-left:auto;margin-top:0.5rem;">
          <div style="display:flex;justify-content:space-between;font-size:0.88rem;color:#666;padding:4px 0;"><span>Subtotal</span><span>R${data.subtotal}</span></div>
          ${feeLines}
          <div style="display:flex;justify-content:space-between;font-size:1.15rem;color:${accentText};padding:10px 0;margin-top:4px;border-top:1px solid #eee;"><span>Total due</span><span>R${data.total}</span></div>
        </div>
        ${(showNotes && data.notes) ? `<div style="margin-top:1.5rem;"><div style="font-size:0.72rem;text-transform:uppercase;letter-spacing:0.06em;color:#aaa;">Notes</div><div style="font-size:0.85rem;color:#666;margin-top:3px;">${data.notes}</div></div>` : ''}
        ${bankingBlockFn({ bg: '#FAFAFA', labelColor: '#aaa', textColor: '#444', radius: '0' })}
        <div style="text-align:center;margin-top:3rem;padding-top:1.5rem;border-top:1px solid #eee;">
          <div style="font-size:0.9rem;">${footerMsg}</div>
          <div style="font-size:0.78rem;color:#aaa;margin-top:2px;">${data.contactLine}</div>
        </div>
      </div>`),

    warm: () => page(`
      <div style="background:#FBF6F0;padding:2.5rem 3rem;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2rem;">
          <div style="display:flex;align-items:center;gap:12px;">
            ${logoBlock}
            <div style="font-size:1.3rem;color:#5C4033;">${brandName}</div>
          </div>
          <div style="background:${accent};color:${onAccent};padding:8px 18px;border-radius:20px;font-size:0.85rem;font-weight:600;">Invoice #${data.invoiceNumber}</div>
        </div>
        <div style="background:white;border-radius:16px;padding:2rem 2.25rem;">
          <div style="display:flex;justify-content:space-between;margin-bottom:1.5rem;">
            <div>
              <div style="font-size:0.72rem;text-transform:uppercase;letter-spacing:0.05em;color:${accentText};">For</div>
              <div style="font-size:1.05rem;font-weight:600;color:#5C4033;">${data.customerName}</div>
              <div style="font-size:0.8rem;color:#A08670;">${data.customerPhone || ''}</div>
              ${addressBlockFn('#A08670')}
            </div>
            <div style="text-align:right;">
              <div style="font-size:0.72rem;text-transform:uppercase;letter-spacing:0.05em;color:${accentText};">Date</div>
              <div style="font-size:0.88rem;color:#5C4033;">${data.date}</div>
              <div style="font-size:0.78rem;color:${accentText};margin-top:4px;">${data.deliveryLabel}</div>
            </div>
          </div>
          <table style="width:100%;border-collapse:collapse;">
            <thead><tr>
              <th style="text-align:left;padding:8px 0;font-size:0.72rem;text-transform:uppercase;color:#A08670;border-bottom:1px solid #EDE0D3;">Item</th>
              <th style="text-align:right;padding:8px 0;font-size:0.72rem;text-transform:uppercase;color:#A08670;border-bottom:1px solid #EDE0D3;">Price</th>
              <th style="text-align:right;padding:8px 0;font-size:0.72rem;text-transform:uppercase;color:#A08670;border-bottom:1px solid #EDE0D3;">Qty</th>
              <th style="text-align:right;padding:8px 0;font-size:0.72rem;text-transform:uppercase;color:#A08670;border-bottom:1px solid #EDE0D3;">Amt</th>
            </tr></thead>
            <tbody style="font-size:0.9rem;color:#6B5344;">${rows.replace(/#eee/g, '#EDE0D3')}</tbody>
          </table>
          <div style="max-width:300px;margin-left:auto;padding:1rem 0 0;">
            <div style="display:flex;justify-content:space-between;font-size:0.88rem;color:#6B5344;padding:3px 0;"><span>Subtotal</span><span>R${data.subtotal}</span></div>
            ${feeLines}
            <div style="display:flex;justify-content:space-between;font-size:1.1rem;font-weight:700;color:${accentText};border-top:1.5px solid ${accent};margin-top:8px;padding-top:10px;"><span>Total due</span><span>R${data.total}</span></div>
          </div>
          ${(showNotes && data.notes) ? `<div style="margin-top:1.25rem;"><div style="font-size:0.72rem;text-transform:uppercase;color:#A08670;">Notes</div><div style="font-size:0.85rem;color:#6B5344;background:#FBF6F0;border-radius:8px;padding:0.75rem 1rem;margin-top:4px;">${data.notes}</div></div>` : ''}
          ${bankingBlockFn({ bg: '#FBF6F0', labelColor: '#A08670', textColor: '#6B5344' })}
        </div>
        <div style="text-align:center;padding:1.5rem 0 0;">
          <div style="font-size:0.92rem;color:#5C4033;font-weight:500;">${footerMsg}</div>
          <div style="font-size:0.78rem;color:#A08670;">${data.contactLine}</div>
        </div>
      </div>`),
  };

  const themeFn = themes[theme] || themes.classic;
  return themeFn();
}
