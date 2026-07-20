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

// VAT breakdown — shown in standard SARS tax-invoice form: subtotal
// EXCLUDING VAT, then VAT, positioned directly above Total. These two
// lines add up exactly to Total (unlike a single "VAT included" line,
// which reads ambiguously — people expect a Subtotal/VAT stack to sum to
// the Total below it, the way real till slips and tax invoices do).
// The order total itself never changes — Orderly prices are already
// VAT-inclusive — this only affects how it's broken down on the page.
function invoiceVatLineHTML(data, mutedColor) {
  if (!data.vatRegistered) return '';
  const rate = data.vatRate || 15;
  const total = Number(data.total || 0);
  const vatAmount = total * rate / (100 + rate);
  const exVatAmount = total - vatAmount;
  const row = (label, amount) => `<div style="display:flex;justify-content:space-between;padding:0.25rem 0;font-size:0.78rem;color:${mutedColor};"><span>${label}</span><span>R${amount.toFixed(2)}</span></div>`;
  return row('Subtotal (excl. VAT)', exVatAmount) + row(`VAT (${rate}%)`, vatAmount);
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
  // A store only shows as a Tax Invoice if it's both VAT-registered AND has
  // entered a VAT number — half-set-up VAT data shouldn't silently claim
  // tax-invoice status on a legal document.
  const isTaxInvoice = !!(data.vatRegistered && data.vatNumber);
  const invoiceTitleWord = isTaxInvoice ? 'Tax Invoice' : 'Invoice';
  const brandName = data.poweredByOrderly ? 'Orderly' : data.storeName;
  // Takes a size (and optional radius) so the real logo always matches
  // the placeholder circle it's replacing — previously this was a fixed
  // 42px regardless of theme, which meant a real uploaded logo actually
  // rendered SMALLER than the empty-state placeholder next to it (48-56px
  // in the newer themes). Each theme now passes its own placeholder size.
  const logoBlock = (size = 42, radius) => (!data.poweredByOrderly && data.logoUrl)
    ? `<img src="${data.logoUrl}" style="width:${size}px;height:${size}px;border-radius:${radius || '8px'};object-fit:cover;flex-shrink:0;" />`
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
      <div style="${label(labelColor)}margin-bottom:0.55rem;">Payment details (EFT)</div>
      <div style="font-size:0.82rem;color:${textColor};">
        ${bankRow('🏦', 'Bank', data.bankName, textColor)}
        ${bankRow('👤', 'Account holder', data.bankAccountHolder || data.storeName, textColor)}
        ${bankRow('💳', 'Account number', data.bankAccountNumber, textColor)}
        ${data.bankBranchCode ? bankRow('🏢', 'Branch code', data.bankBranchCode, textColor) : ''}
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
  // Zebra-striped row renderer used by the purple/dark-header table designs.
  const rowsZebra = (items, { stripe = '#f5f5f5', color = '#222', padX = '1rem' } = {}) => items.map((i, idx) => {
    const amount = i.price * i.qty;
    const bg = idx % 2 === 1 ? stripe : 'transparent';
    return `<tr style="background:${bg};"><td style="padding:0.75rem ${padX};color:${color};">${i.name}</td><td style="padding:0.75rem ${padX};text-align:right;color:${color};">${i.qty}</td><td style="padding:0.75rem ${padX};text-align:right;color:${color};">R${i.price}</td><td style="padding:0.75rem ${padX};text-align:right;font-weight:600;color:${color};">R${amount}</td></tr>`;
  }).join('');

  // No-border row renderer — generous vertical rhythm, no per-row divider
  // line, just whitespace + one rule before the totals block (Sharp v2 /
  // INV_1 style).
  const rowsOpen = (items, { color = '#222' } = {}) => items.map(i => {
    const amount = i.price * i.qty;
    return `<tr><td style="padding:0.55rem 0;color:${color};">${i.name}</td><td style="padding:0.55rem 0;text-align:right;color:${color};">${i.qty}</td><td style="padding:0.55rem 0;text-align:right;color:${color};">R${i.price}</td><td style="padding:0.55rem 0;text-align:right;font-weight:600;color:${color};">R${amount}</td></tr>`;
  }).join('');

  // Bullet-style payment method list (INV_1's look) as an alternative to
  // the standard bankingBlockFn card.
  const bankBullets = (textColor) => {
    if (!data.bankName || !data.bankAccountNumber) return '';
    return `<div style="font-size:0.82rem;color:${textColor};line-height:2;">
      <div>• <strong>Bank:</strong> ${data.bankName}</div>
      <div>• <strong>Account Holder:</strong> ${data.bankAccountHolder || data.storeName}</div>
      <div>• <strong>Account No:</strong> ${data.bankAccountNumber}</div>
      ${data.bankBranchCode ? `<div>• <strong>Branch Code:</strong> ${data.bankBranchCode}</div>` : ''}
    </div>`;
  };

  // ── SHARED LABEL STYLE ────────────────────────────────────────────
  // One micro-label style used everywhere a small uppercase caption sits
  // above a value (INVOICE TO, DUE DATE, TOTAL DUE...). Each theme still
  // picks its own muted colour, but size/spacing/weight are now identical
  // across all 4 themes instead of four hand-tuned near-duplicates that
  // had quietly drifted apart (0.68/0.7/0.72rem, 0.05–0.1em letter-spacing).
  const label = (color) => `font-size:0.7rem;text-transform:uppercase;letter-spacing:0.07em;font-weight:600;color:${color};`;
  const thCell = (align, border, color) => `text-align:${align};padding:0 0 0.65rem;font-size:0.7rem;text-transform:uppercase;letter-spacing:0.07em;font-weight:600;color:${color};border-bottom:1.5px solid ${border};`;

  // ── SHARED SPACING SCALE ──────────────────────────────────────────
  // Generic vertical rhythm for plain stacked sections. Themes with a
  // structural reason to differ (Gradient's overlapping card, Studio's
  // tinted hero header) keep their own values where that's the case —
  // noted inline — but ordinary header/body/footer stacking pulls from
  // this instead of each theme inventing its own gap.
  const SP = { header: '2.5rem 3rem', body: '2rem 3rem 0', footer: '1.75rem 3rem' };

  // Payment-details icon/label baseline fix: each row is its own flex
  // line with the icon in a fixed-width slot, so the emoji sits pixel-
  // aligned with the text next to it instead of drifting on its own
  // line-height (the misalignment visible in the "PAYMENT DETAILS" box
  // on real invoices — icons floated above/below the text baseline).
  const bankRow = (icon, label_, value, textColor) =>
    `<div style="display:flex;align-items:center;gap:7px;padding:2px 0;"><span style="display:inline-block;width:1.1em;text-align:center;flex-shrink:0;">${icon}</span><span><strong>${label_}:</strong> ${value}</span></div>`;

  const themes = {
    // "Editorial" — bold black header, sun-mark logo, tinted body
    // (reference: client's Canva design, INV_1)
    classic: () => page(`
      <div style="background:#1A1A1A;padding:2.75rem 3rem;display:flex;justify-content:space-between;align-items:center;">
        <div style="font-family:${wordmarkFont};font-size:${isTaxInvoice ? '2.1rem' : '2.6rem'};font-weight:600;color:white;line-height:1;">${invoiceTitleWord}</div>
        ${logoBlock(58, '50%') || `<div style="width:58px;height:58px;border-radius:50%;border:1.5px solid rgba(255,255,255,0.8);display:flex;align-items:center;justify-content:center;font-size:1.3rem;color:white;">${(brandName || 'O')[0]}</div>`}
      </div>
      ${data.poweredByOrderly ? `<div style="font-size:0.68rem;color:rgba(255,255,255,0.4);padding:0.4rem 3rem;background:#1A1A1A;">Powered by Orderly</div>` : ''}
      <div style="background:${accent}12;padding:2.25rem 3rem 0.5rem;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;">
          <div>
            <div style="font-size:0.85rem;font-weight:700;color:#1A1A1A;">Bill To:</div>
            <div style="font-size:0.85rem;color:#444;margin-top:6px;">${data.customerName}</div>
            <div style="font-size:0.85rem;color:#444;">${data.customerPhone || ''}</div>
            ${addressBlockFn('#444')}
          </div>
          <div style="text-align:right;">
            <div style="font-size:0.85rem;color:#444;">Date: ${data.date}</div>
            <div style="font-size:0.85rem;color:#444;margin-top:4px;">Invoice Number: ${data.invoiceNumber}</div>
            ${isTaxInvoice ? `<div style="font-size:0.85rem;color:#444;margin-top:4px;">VAT No: ${data.vatNumber}</div>` : ''}
            <div style="margin-top:8px;display:inline-block;background:white;color:${accentText};padding:3px 11px;border-radius:20px;font-size:0.72rem;font-weight:600;">${data.deliveryLabel}</div>
          </div>
        </div>
      </div>
      <div style="background:${accent}12;padding:1.5rem 3rem 0;">
        <table style="width:100%;border-collapse:collapse;">
          <thead><tr style="background:#1A1A1A;">
            <th style="text-align:left;padding:0.7rem 1rem;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.06em;font-weight:600;color:white;">Item Description</th>
            <th style="text-align:right;padding:0.7rem 1rem;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.06em;font-weight:600;color:white;">Qty</th>
            <th style="text-align:right;padding:0.7rem 1rem;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.06em;font-weight:600;color:white;">Price</th>
            <th style="text-align:right;padding:0.7rem 1rem;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.06em;font-weight:600;color:white;">Total</th>
          </tr></thead>
          <tbody style="font-size:0.88rem;">${rowsOpen(data.items, { color: '#333' }).replace(/<td/g, '<td style="padding-left:1rem;padding-right:1rem;"')}</tbody>
        </table>
        <div style="border-top:1.5px solid #1A1A1A;margin-top:0.5rem;"></div>
        <div style="max-width:280px;margin-left:auto;padding-top:1rem;">
          <div style="display:flex;justify-content:space-between;font-size:0.85rem;color:#555;padding:0.2rem 0;"><span>Sub-Total</span><span>R${data.subtotal}</span></div>
          ${feeLines}
          ${invoiceVatLineHTML(data, '#777')}
        </div>
        <div style="background:#1A1A1A;margin:1rem 0 0;padding:0.85rem 1.5rem;display:flex;justify-content:space-between;align-items:center;">
          <span style="color:white;font-weight:600;font-size:0.9rem;">Total Amount:</span>
          <span style="color:white;font-weight:800;font-size:1.1rem;">R${data.total}</span>
        </div>
      </div>
      <div style="background:${accent}12;padding:1.75rem 3rem 0;display:flex;justify-content:space-between;align-items:flex-start;gap:2rem;flex-wrap:wrap;">
        <div>
          <div style="font-size:0.82rem;font-weight:700;color:#1A1A1A;margin-bottom:0.4rem;">Payment Method:</div>
          ${bankBullets('#444')}
        </div>
        <div style="text-align:right;">
          <div style="${label('#666')}">Total Due</div>
          <div style="font-size:2rem;font-weight:800;color:#1A1A1A;margin-top:2px;">R${data.total}</div>
        </div>
      </div>
      ${(showNotes && data.notes) ? `<div style="background:${accent}12;padding:1.25rem 3rem 0;"><div style="${label('#666')}">Notes</div><div style="font-size:0.84rem;color:#555;margin-top:5px;">${data.notes}</div></div>` : ''}
      <div style="background:${accent}12;padding:1.75rem 3rem 2.25rem;margin-top:0.5rem;">
        <div style="border-top:1px solid rgba(26,26,26,0.15);padding-top:1.5rem;display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:1rem;">
          <div style="font-family:${wordmarkFont};font-size:1.9rem;color:#1A1A1A;">Thank You</div>
          <div style="text-align:right;font-size:0.76rem;color:#666;max-width:220px;line-height:1.5;">${footerMsg}</div>
        </div>
      </div>
      <div style="padding:1rem 3rem;text-align:center;border-top:1px solid #eee;">
        <div style="font-size:0.76rem;color:#999;">${data.contactLine}</div>
      </div>`),

    // "Refined" — small monogram, wide-tracked labels, understated
    // (reference: client's Canva design, INV_2)
    bold: () => page(`
      <div style="padding:2.5rem 3rem 0;">
        <div style="display:inline-flex;flex-direction:column;align-items:center;gap:8px;background:${accent}14;padding:1.5rem 2rem;border-radius:4px;">
          ${logoBlock(56, '50%') || `<div style="width:56px;height:56px;border-radius:50%;background:#2A2A2A;display:flex;align-items:center;justify-content:center;font-size:1.3rem;color:white;font-style:italic;">${(brandName || 'O')[0]}</div>`}
          <div style="text-align:center;">
            <div style="font-size:0.78rem;font-weight:700;letter-spacing:0.15em;color:#1A1A1A;">${brandName.toUpperCase()}</div>
          </div>
        </div>
        ${data.poweredByOrderly ? `<div style="font-size:0.68rem;color:#bbb;margin-top:0.75rem;">Powered by Orderly</div>` : ''}
        ${isTaxInvoice ? `<div style="font-family:${wordmarkFont};font-size:1.5rem;color:#1A1A1A;margin-top:1.75rem;">Tax Invoice</div>` : ''}
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-top:${isTaxInvoice ? '0.75rem' : '2.5rem'};">
          <div>
            <div style="font-size:0.72rem;font-weight:700;letter-spacing:0.12em;color:#1A1A1A;">ISSUED TO:</div>
            <div style="font-size:0.85rem;color:#555;margin-top:6px;line-height:1.7;">${data.customerName}<br>${data.customerPhone || ''}${addressBlockFn('#555')}</div>
          </div>
          <div style="text-align:right;font-size:0.78rem;color:#555;line-height:1.9;">
            <div><span style="font-weight:700;letter-spacing:0.1em;color:#1A1A1A;">INVOICE NO:</span> &nbsp;${data.invoiceNumber}</div>
            <div><span style="font-weight:700;letter-spacing:0.1em;color:#1A1A1A;">DATE:</span> &nbsp;${data.date}</div>
            ${isTaxInvoice ? `<div><span style="font-weight:700;letter-spacing:0.1em;color:#1A1A1A;">VAT NO:</span> &nbsp;${data.vatNumber}</div>` : ''}
          </div>
        </div>
      </div>
      <div style="padding:2.5rem 3rem 0;">
        <table style="width:100%;border-collapse:collapse;">
          <thead><tr style="background:${accent}1f;">
            <th style="text-align:left;padding:0.65rem 0.9rem;font-size:0.7rem;font-weight:700;letter-spacing:0.1em;color:#1A1A1A;">DESCRIPTION</th>
            <th style="text-align:right;padding:0.65rem 0.9rem;font-size:0.7rem;font-weight:700;letter-spacing:0.1em;color:#1A1A1A;">UNIT PRICE</th>
            <th style="text-align:right;padding:0.65rem 0.9rem;font-size:0.7rem;font-weight:700;letter-spacing:0.1em;color:#1A1A1A;">QTY</th>
            <th style="text-align:right;padding:0.65rem 0.9rem;font-size:0.7rem;font-weight:700;letter-spacing:0.1em;color:#1A1A1A;">TOTAL</th>
          </tr></thead>
          <tbody style="font-size:0.86rem;color:#333;">${rowsOpen(data.items, { color: '#333' }).replace(/<td/g, '<td style="padding-left:0.9rem;padding-right:0.9rem;"')}</tbody>
        </table>
        <div style="max-width:300px;margin-left:auto;padding-top:0.5rem;">
          <div style="display:flex;justify-content:space-between;font-size:0.82rem;font-weight:700;color:#1A1A1A;padding:0.5rem 0.9rem;"><span>SUBTOTAL</span><span>R${data.subtotal}</span></div>
          <div style="padding:0 0.9rem;">${feeLines}${invoiceVatLineHTML(data, '#777')}</div>
          <div style="display:flex;justify-content:space-between;font-size:0.85rem;font-weight:700;letter-spacing:0.06em;color:#1A1A1A;background:${accent}1f;padding:0.65rem 0.9rem;margin-top:0.25rem;"><span>TOTAL</span><span>R${data.total}</span></div>
        </div>
      </div>
      ${(showNotes && data.notes) ? `<div style="padding:2rem 3rem 0;"><div style="font-size:0.72rem;font-weight:700;letter-spacing:0.1em;color:#1A1A1A;">NOTES</div><div style="font-size:0.84rem;color:#666;margin-top:6px;">${data.notes}</div></div>` : ''}
      <div style="padding:2.5rem 3rem 2.5rem;display:flex;justify-content:space-between;align-items:flex-start;gap:2rem;flex-wrap:wrap;">
        <div>
          <div style="font-size:0.72rem;font-weight:700;letter-spacing:0.12em;color:#1A1A1A;margin-bottom:0.5rem;">BANK DETAILS</div>
          ${data.bankName ? `<div style="font-size:0.82rem;color:#555;line-height:1.9;">${data.bankName}<br>Account Holder: ${data.bankAccountHolder || data.storeName}<br>Account No.: ${data.bankAccountNumber}${data.bankBranchCode ? `<br>Branch Code: ${data.bankBranchCode}` : ''}</div>` : ''}
        </div>
        <div style="text-align:right;max-width:260px;">
          <div style="font-size:0.85rem;color:#1A1A1A;">${footerMsg}</div>
          <div style="font-size:0.76rem;color:#999;margin-top:6px;">${data.contactLine}</div>
        </div>
      </div>`),

    // "Ledger" — bold spaced-out title, zebra-striped table
    // (reference: client's Canva design, INV_3)
    minimal: () => page(`
      <div style="padding:2.75rem 3rem 0;">
        <div style="font-size:${isTaxInvoice ? '1.7rem' : '2.4rem'};font-weight:800;letter-spacing:${isTaxInvoice ? '0.2em' : '0.45em'};color:#1A1A1A;text-align:center;text-indent:${isTaxInvoice ? '0.2em' : '0.45em'};">${invoiceTitleWord}</div>
        ${data.poweredByOrderly ? `<div style="font-size:0.68rem;color:#bbb;text-align:center;margin-top:0.5rem;">Powered by Orderly</div>` : ''}
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-top:2.25rem;">
          <div>
            <div style="font-size:0.72rem;font-weight:700;letter-spacing:0.1em;color:#1A1A1A;">ISSUED TO:</div>
            <div style="font-size:0.85rem;color:#555;margin-top:6px;">${data.customerName}</div>
            <div style="font-size:0.85rem;color:#555;">${data.customerPhone || ''}</div>
            ${addressBlockFn('#555')}
          </div>
          <div style="text-align:right;font-size:0.78rem;color:#555;line-height:1.9;">
            <div><span style="font-weight:700;letter-spacing:0.08em;color:#1A1A1A;">INVOICE NO:</span> &nbsp;${data.invoiceNumber}</div>
            <div><span style="font-weight:700;letter-spacing:0.08em;color:#1A1A1A;">DATE:</span> &nbsp;${data.date}</div>
            ${isTaxInvoice ? `<div><span style="font-weight:700;letter-spacing:0.08em;color:#1A1A1A;">VAT NO:</span> &nbsp;${data.vatNumber}</div>` : ''}
            <div style="margin-top:6px;display:inline-block;background:${accent}18;color:${accentText};padding:3px 10px;border-radius:12px;font-size:0.72rem;font-weight:600;">${data.deliveryLabel}</div>
          </div>
        </div>
      </div>
      <div style="padding:2rem 3rem 0;">
        <table style="width:100%;border-collapse:collapse;">
          <thead><tr style="background:${accent};">
            <th style="text-align:left;padding:0.75rem 1rem;font-size:0.76rem;letter-spacing:0.04em;color:${onAccent};">Description</th>
            <th style="text-align:right;padding:0.75rem 1rem;font-size:0.76rem;letter-spacing:0.04em;color:${onAccent};">Qty</th>
            <th style="text-align:right;padding:0.75rem 1rem;font-size:0.76rem;letter-spacing:0.04em;color:${onAccent};">Price</th>
            <th style="text-align:right;padding:0.75rem 1rem;font-size:0.76rem;letter-spacing:0.04em;color:${onAccent};">Total</th>
          </tr></thead>
          <tbody style="font-size:0.88rem;">${rowsZebra(data.items, { stripe: `${accent}1c`, color: '#333' })}</tbody>
        </table>
        <div style="max-width:280px;margin-left:auto;padding-top:1rem;">
          <div style="display:flex;justify-content:space-between;font-size:0.85rem;font-weight:700;color:#1A1A1A;padding:0.2rem 0;"><span>SUBTOTAL</span><span>R${data.subtotal}</span></div>
          ${feeLines}
          ${invoiceVatLineHTML(data, '#999')}
          <div style="display:flex;justify-content:space-between;font-size:0.95rem;font-weight:800;color:${accentText};padding:0.4rem 0 0;margin-top:0.3rem;border-top:1px solid #eee;"><span>TOTAL</span><span>R${data.total}</span></div>
        </div>
      </div>
      ${(showNotes && data.notes) ? `<div style="padding:1.75rem 3rem 0;"><div style="font-size:0.72rem;font-weight:700;letter-spacing:0.1em;color:#1A1A1A;">NOTES</div><div style="font-size:0.84rem;color:#666;margin-top:6px;">${data.notes}</div></div>` : ''}
      <div style="padding:2.25rem 3rem 0;display:flex;justify-content:space-between;align-items:flex-start;gap:1.5rem;flex-wrap:wrap;">
        <div>
          <div style="font-size:0.72rem;font-weight:700;letter-spacing:0.1em;color:#1A1A1A;">PAY TO:</div>
          ${data.bankName ? `<div style="font-size:0.82rem;color:#555;margin-top:6px;line-height:1.8;">${data.bankName}<br>Account Holder: ${data.bankAccountHolder || data.storeName}<br>Account No.: ${data.bankAccountNumber}${data.bankBranchCode ? `<br>Branch Code: ${data.bankBranchCode}` : ''}</div>` : ''}
        </div>
        ${logoBlock(60, '50%') || `<div style="width:60px;height:60px;border-radius:50%;background:#2A2A2A;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:1.4rem;color:white;font-style:italic;">${(brandName || 'O')[0]}</div>`}
      </div>
      <div style="padding:2.25rem 3rem 2.5rem;text-align:center;">
        <div style="font-size:0.85rem;color:#1A1A1A;font-weight:600;">${footerMsg}</div>
        <div style="font-size:0.76rem;color:#999;margin-top:6px;">${data.contactLine}</div>
      </div>`),

    // "Wave" — prominent total-due, zebra table, dark total bar, wave
    // footer graphic (reference: client's Canva design, INV_4)
    warm: () => page(`
      <div style="padding:2.75rem 3rem 0;display:flex;justify-content:space-between;align-items:flex-start;">
        <div style="font-size:${isTaxInvoice ? '1.6rem' : '2.2rem'};font-weight:800;letter-spacing:${isTaxInvoice ? '0.15em' : '0.35em'};text-indent:${isTaxInvoice ? '0.15em' : '0.35em'};color:${accentText};">${invoiceTitleWord}</div>
        ${logoBlock(60, '50%') || `<div style="width:60px;height:60px;border-radius:50%;background:#2A2A2A;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:1.4rem;color:white;font-style:italic;">${(brandName || 'O')[0]}</div>`}
      </div>
      ${data.poweredByOrderly ? `<div style="font-size:0.68rem;color:#bbb;padding:0.4rem 3rem 0;">Powered by Orderly</div>` : ''}
      <div style="padding:1.75rem 3rem 0;display:flex;justify-content:space-between;align-items:flex-start;">
        <div>
          <div style="font-size:0.7rem;text-transform:lowercase;letter-spacing:0.06em;color:#999;">invoice to:</div>
          <div style="font-size:1.05rem;font-weight:700;color:#1A1A1A;margin-top:4px;display:inline-block;border-bottom:2px solid ${accent};padding-bottom:2px;">${data.customerName}</div>
          <div style="font-size:0.8rem;color:#999;margin-top:6px;">${data.customerPhone || ''}</div>
          ${addressBlockFn('#999')}
        </div>
        <div style="text-align:center;font-size:0.78rem;color:#666;">
          <div>Date: ${data.date}</div>
          <div style="margin-top:3px;">Invoice No: ${data.invoiceNumber}</div>
          ${isTaxInvoice ? `<div style="margin-top:3px;">VAT No: ${data.vatNumber}</div>` : ''}
        </div>
        <div style="text-align:right;">
          <div style="${label('#999')}">total due:</div>
          <div style="font-size:1.6rem;font-weight:800;color:#1A1A1A;margin-top:2px;">R${data.total}</div>
        </div>
      </div>
      <div style="padding:2rem 3rem 0;">
        <table style="width:100%;border-collapse:collapse;">
          <thead><tr style="background:#1A1A1A;">
            <th style="text-align:left;padding:0.75rem 1rem;font-size:0.76rem;color:white;">Description</th>
            <th style="text-align:right;padding:0.75rem 1rem;font-size:0.76rem;color:white;">Qty</th>
            <th style="text-align:right;padding:0.75rem 1rem;font-size:0.76rem;color:white;">Price</th>
            <th style="text-align:right;padding:0.75rem 1rem;font-size:0.76rem;color:white;">Total</th>
          </tr></thead>
          <tbody style="font-size:0.88rem;">${rowsZebra(data.items, { stripe: '#f5f5f5', color: '#333' })}</tbody>
        </table>
        <div style="max-width:280px;margin-left:auto;padding-top:1rem;">
          <div style="display:flex;justify-content:space-between;font-size:0.85rem;color:#999;padding:2px 0;"><span>Sub-total</span><span>R${data.subtotal}</span></div>
          ${feeLines}
          ${invoiceVatLineHTML(data, '#999')}
        </div>
      </div>
      ${(showNotes && data.notes) ? `<div style="padding:1.5rem 3rem 0;"><div style="${label('#999')}">Notes</div><div style="font-size:0.84rem;color:#666;margin-top:5px;">${data.notes}</div></div>` : ''}
      <div style="padding:1.75rem 3rem 0;display:flex;justify-content:space-between;align-items:flex-end;gap:1.5rem;flex-wrap:wrap;">
        <div>
          <div style="font-size:0.78rem;font-weight:700;color:#1A1A1A;margin-bottom:0.4rem;">Payment Method</div>
          ${data.bankName ? `<div style="font-size:0.8rem;color:#666;line-height:1.7;">${data.bankName}<br>Account Holder: ${data.bankAccountHolder || data.storeName}<br>Account No: ${data.bankAccountNumber}${data.bankBranchCode ? `<br>Branch Code: ${data.bankBranchCode}` : ''}</div>` : ''}
        </div>
        <div style="background:#1A1A1A;padding:0.7rem 1.5rem;display:flex;gap:1.5rem;align-items:center;border-radius:2px;">
          <span style="color:white;font-weight:600;font-size:0.9rem;">Total:</span>
          <span style="color:white;font-weight:800;font-size:1.05rem;">R${data.total}</span>
        </div>
      </div>
      <div style="padding:2rem 3rem 1.5rem;text-align:center;">
        <div style="font-size:0.85rem;font-weight:600;color:#1A1A1A;">${footerMsg}</div>
        <div style="font-size:0.76rem;color:#999;margin-top:6px;">${data.contactLine}</div>
      </div>
      <div style="line-height:0;">
        <svg viewBox="0 0 900 110" preserveAspectRatio="none" style="width:100%;height:70px;display:block;">
          <path d="M0,50 C180,110 380,0 900,55 L900,110 L0,110 Z" fill="${accent}" opacity="0.35"></path>
          <path d="M0,70 C220,20 500,110 900,40 L900,110 L0,110 Z" fill="${accent}" opacity="0.65"></path>
        </svg>
      </div>`),
  };

  const themeFn = themes[theme] || themes.classic;
  return themeFn();
}
