import { createHash } from "node:crypto";

// Weak validators represent the order JSON semantically, regardless of any
// gzip/Brotli compression applied by the Render reverse proxy. Values are
// derived from the entire authenticated response, including order statuses.
// Never use a timestamp or 'most recent order' alone: payment and status
// changes on old orders must change the validator too.
export function orderListRepresentation(orders) {
  if (!Array.isArray(orders)) throw new TypeError("Order listing must be an array.");
  const body = JSON.stringify(orders);
  const digest = createHash("sha256").update(body).digest("hex");
  return { body, etag: 'W/"orderlist-' + digest + '"' };
}

// Only the in-memory printer poll client sends If-None-Match. Ordinary legacy
// clients will never receive 304 and still get the full, original JSON array.
// A matching response must be checked AFTER the admin password is verified.
export function orderListNotModified(ifNoneMatch, etag) {
  if (typeof ifNoneMatch !== "string" || ifNoneMatch.length > 4096) return false;
  if (!/^W\/"orderlist-[0-9a-f]{64}"$/.test(etag)) return false;
  return ifNoneMatch.split(",").some(token => {
    const candidate = token.trim();
    return candidate === etag || candidate === etag.slice(2);
  });
}
