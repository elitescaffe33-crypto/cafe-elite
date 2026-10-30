import { visibleOrderReference } from "./order-reference.mjs";

// Public, presentation-only helpers. Never rewrite order IDs, payments or prices.
const string = value => String(value ?? "").trim();
const safeText = value => string(value).replace(/\r\n?/g, "\n");
const html = value => String(value ?? "").replace(/[&<>"']/g,
  character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const nbsp = value => html(value).replace(/\n/g, "<br>");

export function receiptMoney(value) {
  const raw = string(value);
  const pounds = raw.match(/^(\d{1,9})(?:\.(\d{1,2}))?\s+GBP$/i);
  if (pounds) return "£" + pounds[1] + "." + (pounds[2] || "00").padEnd(2, "0");
  const prefixed = raw.match(/^GBP\s+(\d{1,9})(?:\.(\d{1,2}))?$/i);
  if (prefixed) return "£" + prefixed[1] + "." + (prefixed[2] || "00").padEnd(2, "0");
  if (/^£\d{1,9}\.\d{2}$/.test(raw)) return raw;
  return raw || "Pay at collection";
}
export function receiptDate(value) {
  if (!value) return "Not provided";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Not provided";
  const day = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit", month: "short", year: "numeric", timeZone: "Europe/London",
  }).format(date);
  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/London",
  }).format(date);
  return day + " · " + time;
}
export function receiptPaymentLabel(order) {
  if (order?.paymentState === "paid" || order?.type === "paid-online") return "PAID ONLINE";
  if (order?.type === "online") return order?.paymentState === "failed" ? "ONLINE PAYMENT FAILED" : "PAYMENT PENDING";
  return "PAY ON COLLECTION";
}

// The immutable sale-time item text comes from the trusted order service.
// Parse only its final " - 8.99 GBP" suffix. Never recalculate past prices.
export function receiptItems(value) {
  const raw = safeText(value);
  if (!raw) return [];
  return raw.split("\n").filter(Boolean).map(line => {
    const match = line.match(/^(\d{1,4})\s*x\s+(.+)\s+-\s+(\d{1,9}(?:\.\d{1,2})?)\s+GBP\s*$/i);
    return match ? {
      quantity: match[1] + "×",
      name: match[2].trim(),
      price: receiptMoney(match[3] + " GBP"),
    } : { quantity: "", name: line.trim(), price: "" };
  });
}
export function receiptData(order) {
  const number = visibleOrderReference(order);
  const status = string(order?.status).toLowerCase();
  const specialStatus = ["cancelled", "completed", "preparing"].includes(status)
    ? status.toUpperCase() : "";
  return {
    number: number || "Not available",
    collect: string(order?.collectionTime) || "Not provided",
    ordered: receiptDate(order?.createdAt),
    name: safeText(order?.customerName) || "Not provided",
    phone: safeText(order?.phone) || "Not provided",
    payment: receiptPaymentLabel(order),
    status: specialStatus,
    items: receiptItems(order?.items),
    notes: safeText(order?.notes) || "None",
    total: receiptMoney(order?.amount),
  };
}

function row(label, value) {
  return '<div class="receipt-meta-row"><span>' + html(label) + '</span><strong>' + html(value) + '</strong></div>';
}
export function renderReceiptMarkup(order) {
  const r = receiptData(order);
  const items = r.items.length ? r.items.map(item =>
    '<div class="receipt-item">' +
    '<span class="receipt-qty">' + html(item.quantity) + '</span>' +
    '<strong class="receipt-item-name">' + html(item.name) + '</strong>' +
    '<strong class="receipt-item-price">' + html(item.price) + '</strong>' +
    '</div>'
  ).join("") : '<p class="receipt-no-items">No items</p>';
  return '<main class="receipt" aria-label="CAFE ELITE collection order">' +
    '<header class="receipt-header">' +
    '<h1>CAFE ELITE</h1><p>33 High Street, Leominster</p><p>HR6 8LZ</p></header>' +
    '<section class="receipt-hero" aria-label="Order and collection reference">' +
    '<p class="receipt-kicker">COLLECTION ORDER</p>' +
    '<div class="receipt-number">#' + html(r.number) + '</div>' +
    '<div class="receipt-collect">COLLECT ' + html(r.collect) + '</div></section>' +
    '<section class="receipt-meta" aria-label="Customer and payment details">' +
    row("Ordered", r.ordered) + row("Customer", r.name) +
    row("Phone", r.phone) + row("Payment", r.payment) +
    (r.status ? '<div class="receipt-status">' + html(r.status) + '</div>' : "") +
    '</section>' +
    '<section class="receipt-items" aria-label="Order items"><h2>ORDER ITEMS</h2>' +
    items + '</section>' +
    '<section class="receipt-notes" aria-label="Order notes"><h2>ORDER NOTES</h2>' +
    '<p>' + nbsp(r.notes) + '</p></section>' +
    '<footer class="receipt-total"><span>TOTAL</span><strong>' + html(r.total) +
    '</strong></footer>' +
    '</main>';
}

export const RECEIPT_CSS = [
  '@page { margin: 0; }',
  '* { box-sizing: border-box; }',
  'html, body { padding:0; margin:0; background:#fff; color:#111; font-family:Arial, Helvetica, sans-serif; }',
  '.receipt { width:72mm; max-width:100%; margin:0 auto; padding:3mm 2mm 4mm; background:#fff; color:#111; }',
  '.receipt * { overflow-wrap:anywhere; }',
  '.receipt-header { text-align:center; padding:0 0 3mm; }',
  '.receipt-header h1 { font-size:19pt; line-height:1.15; margin:0 0 2mm; font-weight:900; letter-spacing:.25mm; }',
  '.receipt-header p { font-size:9.5pt; line-height:1.35; margin:0; }',
  '.receipt-hero { text-align:center; border-top:1.2px solid #111; border-bottom:1px solid #777; padding:4mm 1mm 4mm; break-inside:avoid; }',
  '.receipt-kicker { font-size:10pt; font-weight:700; margin:0 0 2mm; letter-spacing:.2mm; }',
  '.receipt-number { font-size:29pt; font-weight:900; letter-spacing:.4mm; line-height:1.18; margin:0 0 2mm; font-variant-numeric:tabular-nums; }',
  '.receipt-collect { font-size:17pt; font-weight:900; line-height:1.2; }',
  '.receipt-meta { padding:4mm 0 3mm; border-bottom:1.2px solid #111; font-size:9.5pt; }',
  '.receipt-meta-row { display:grid; grid-template-columns:24mm minmax(0,1fr); gap:1mm; align-items:start; margin:0 0 2mm; }',
  '.receipt-meta-row > span { color:#404040; }',
  '.receipt-meta-row strong { text-align:right; font-weight:700; }',
  '.receipt-status { font-size:12pt; font-weight:900; text-align:right; padding:1mm 0; }',
  '.receipt-items { padding:3.5mm 0 3mm; border-bottom:1px solid #777; }',
  '.receipt-items h2 { text-align:center; font-size:13pt; font-weight:900; margin:0 0 3mm; }',
  '.receipt-item { display:grid; grid-template-columns:auto minmax(0,1fr) auto; gap:1.5mm; align-items:start; font-size:10.5pt; line-height:1.35; margin:0 0 2.3mm; break-inside:avoid; }',
  '.receipt-qty { font-weight:800; white-space:nowrap; }',
  '.receipt-item-name { font-weight:700; min-width:0; }',
  '.receipt-item-price { font-weight:800; white-space:nowrap; text-align:right; font-variant-numeric:tabular-nums; }',
  '.receipt-no-items { margin:0; font-size:10pt; }',
  '.receipt-notes { border-bottom:1.2px solid #111; padding:3mm 0 4mm; break-inside:avoid; }',
  '.receipt-notes h2 { font-size:11pt; font-weight:900; margin:0 0 1.5mm; }',
  '.receipt-notes p { margin:0; line-height:1.4; font-size:10pt; white-space:normal; }',
  '.receipt-total { display:flex; justify-content:flex-end; align-items:baseline; gap:4mm; padding:4mm 0; border-bottom:1.2px solid #111; font-size:16pt; font-weight:900; break-inside:avoid; }',
  '.receipt-total strong { font-size:18pt; font-weight:900; font-variant-numeric:tabular-nums; }',
  '@media print { html,body { width:auto; } .receipt { width:72mm; max-width:100%; margin:0 auto; padding:2mm 2mm 5mm; } }',
].join("\n");
export function receiptDocument(order) {
  return '<!doctype html><html lang="en"><head><meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>CAFE ELITE · Order ' + html(visibleOrderReference(order)) + '</title>' +
    '<style>' + RECEIPT_CSS + '</style></head><body>' +
    renderReceiptMarkup(order) + '</body></html>';
}

const spaces = n => " ".repeat(Math.max(0, n));
function wrapWords(text, width) {
  const result = [];
  for (const sourceLine of safeText(text).split("\n")) {
    const words = sourceLine.split(/\s+/).filter(Boolean);
    if (!words.length) { result.push(""); continue; }
    let current = "";
    for (let word of words) {
      while (word.length > width) {
        if (current) { result.push(current); current = ""; }
        result.push(word.slice(0,width));
        word=word.slice(width);
      }
      if (!word) continue;
      if (current && current.length + 1 + word.length > width) {
        result.push(current); current = word;
      } else current += (current ? " " : "") + word;
    }
    if (current) result.push(current);
  }
  return result;
}
export function receiptPlainText(order, width = 42) {
  if (!Number.isInteger(width) || width < 26 || width > 80) throw new RangeError("Invalid receipt width");
  const r = receiptData(order);
  const line = "-".repeat(width);
  const center = value => spaces(Math.floor((width - value.length)/2)) + value;
  const flush = (left,right) => {
    const room=Math.max(0,width-right.length-1);
    const lines=wrapWords(left,room);
    const last=lines.pop() || "";
    return [...lines, last+spaces(width-last.length-right.length)+right];
  };
  const text=[
    center("CAFE ELITE"),center("33 High Street, Leominster"),center("HR6 8LZ"),line,
    center("COLLECTION ORDER"),center("#"+r.number),center("COLLECT "+r.collect),line,
    ...flush("Ordered",r.ordered),...flush("Customer",r.name),
    ...flush("Phone",r.phone),...flush("Payment",r.payment),
    ...(r.status?[center(r.status)]:[]),
    line,center("ORDER ITEMS"),line,
  ];
  if (!r.items.length) text.push("No items");
  for (const item of r.items) {
    const label=(item.quantity ? item.quantity+" " : "") + item.name;
    text.push(...(item.price ? flush(label,item.price) : wrapWords(label,width)));
  }
  text.push(line,"ORDER NOTES",...wrapWords(r.notes,width),line,
    ...flush("TOTAL",r.total),line,"");
  return text.join("\n");
}
