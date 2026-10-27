import { normaliseAndPriceOrder } from "./order-catalogue.mjs";

export const BASKET_STORAGE_KEY = "cafeEliteBasketV1";
export const ATTEMPT_STORAGE_KEY = "cafeEliteCheckoutAttemptV1";
export const BASKET_MAX_AGE = 4 * 60 * 60 * 1000;

export function basketIdentifiers(basket) {
  const lines = new Map();
  for (const item of basket) {
    const selectedOptions = Object.fromEntries(Object.entries(item.dealChoices || {}).sort(([a], [b]) => a.localeCompare(b)));
    const productId = item.sourceId || item.id;
    const key = JSON.stringify([productId, selectedOptions]);
    const line = lines.get(key) || { productId, quantity: 0, selectedOptions };
    line.quantity++;
    lines.set(key, line);
  }
  return [...lines.values()];
}

export function saveBasket(storage, basket, now = Date.now()) {
  try {
    if (!basket.length) { storage.removeItem(BASKET_STORAGE_KEY); return; }
    const items = basketIdentifiers(basket);
    const previous = JSON.parse(storage.getItem(BASKET_STORAGE_KEY) || "null");
    if (previous?.version === 1 && JSON.stringify(previous.items) === JSON.stringify(items) && now - previous.savedAt < BASKET_MAX_AGE) return;
    storage.setItem(BASKET_STORAGE_KEY, JSON.stringify({ version: 1, savedAt: now, items }));
  } catch { /* Private browsing or storage quota must not break ordering. */ }
}

export function restoreBasket(storage, groups, settings, now = Date.now()) {
  try {
    const stored = JSON.parse(storage.getItem(BASKET_STORAGE_KEY) || "null");
    if (!stored) return [];
    if (stored.version !== 1 || !Number.isFinite(stored.savedAt) || stored.savedAt > now || now - stored.savedAt >= BASKET_MAX_AGE || !Array.isArray(stored.items) || stored.items.length > 50) throw new Error("Stale basket");
    const result = [];
    const products = groups.flatMap(group => group.items);
    for (const line of stored.items) {
      try {
        const priced = normaliseAndPriceOrder({ items: [line] }, groups, settings).items[0];
        const item = products.find(entry => entry.id === priced.productId && !entry.sourceId);
        if (!item || result.length + priced.quantity > 50) continue;
        for (let quantity = 0; quantity < priced.quantity; quantity++) result.push({ ...item, dealChoices: priced.selectedOptions, details: priced.details });
      } catch { /* Discard removed products and invalid selections individually. */ }
    }
    // Canonical rewrite strips any unexpected (including personal) stored fields.
    storage.removeItem(BASKET_STORAGE_KEY);
    if (result.length) storage.setItem(BASKET_STORAGE_KEY, JSON.stringify({ version: 1, savedAt: stored.savedAt, items: basketIdentifiers(result) }));
    return result;
  } catch {
    try { storage.removeItem(BASKET_STORAGE_KEY); } catch { /* Storage unavailable. */ }
    return [];
  }
}

export function randomAttemptId() {
  if (globalThis.crypto.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
