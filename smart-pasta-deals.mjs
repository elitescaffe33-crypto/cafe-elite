import { getItemKey, priceToPence } from "./menu-data.mjs";

// Prices come only from the approved catalogue and trusted menu settings.
export const PASTA_GROUPS = Object.freeze([
  { id: "premium", name: "Premium Pasta Deal", products: ["pasta-bolognese-bowl", "pasta-chicken-tomato"],
    offers: [[2, "deal-bolognese-any-two"], [3, "deal-bolognese-any-three"], [4, "deal-bolognese-family-feast"]] },
  { id: "classic", name: "Classic Pasta Deal", products: ["pasta-tomato-pasta", "pasta-garlic-yogurt-pasta"],
    offers: [[2, "deal-any-two-bowls"], [3, "deal-any-three-bowls"], [4, "deal-family-feast-four-bowls"]] },
]);
export const LEGACY_PASTA_DEAL_IDS = new Set(PASTA_GROUPS.flatMap(group => group.offers.map(([, id]) => id)));

export function visibleMenuItems(group) {
  const order = ["pasta-bolognese-bowl", "pasta-chicken-tomato", "pasta-garlic-yogurt-pasta", "pasta-tomato-pasta"];
  const rank = item => order.includes(item.id) ? order.indexOf(item.id) : order.length;
  const entries = group.items.map((item, itemIndex) => ({ item, itemIndex })).filter(({ item }) => !LEGACY_PASTA_DEAL_IDS.has(item.id));
  return group.id === "pasta" ? entries.sort((a, b) => rank(a.item) - rank(b.item)) : entries;
}

export function availablePastaOffers(groups, settings = {}) {
  const hidden = new Set(settings.menuCustom?.hiddenItems || []);
  const products = new Map(groups.flatMap(group => group.items).filter(item => !item.sourceId && item.active !== false && item.orderable !== false
    && !hidden.has(getItemKey(item)) && !hidden.has(item.name)).map(item => [item.id, item]));
  return PASTA_GROUPS.map(group => ({ ...group,
    products: group.products.filter(id => products.has(id)),
    offers: group.offers.flatMap(([quantity, productId]) => {
      const item = products.get(productId);
      if (!item) return [];
      const price = priceToPence(settings.menuPrices?.[getItemKey(item)] || settings.menuPrices?.[item.name] || item.price);
      return Number.isSafeInteger(price) && price > 0 ? [{ productId, quantity, price }] : [];
    }),
  })).filter(group => group.products.length && group.offers.length);
}

function combineUnits(units) {
  const lines = new Map();
  for (const unit of units) {
    const key = JSON.stringify([unit.productId, unit.selectedOptions]);
    const line = lines.get(key) || { ...unit, quantity: 0, lineTotal: 0 };
    line.quantity++;
    line.lineTotal += unit.unitPrice;
    lines.set(key, line);
  }
  return [...lines.values()];
}

// Find the cheapest exact offer combination for each covered quantity.
// Cover expensive units first; unmatched units keep their normal prices.
// Explicit legacy deals are not eligible units, preventing double discounts.
export function applyPastaDeals(items, groups, settings = {}) {
  const checkoutItems = [], remaining = new Map(items.map(item => [item, item.quantity]));
  for (const group of availablePastaOffers(groups, settings)) {
    const units = items.filter(item => group.products.includes(item.productId))
      .flatMap(item => Array.from({ length: item.quantity }, () => item))
      .sort((a, b) => b.unitPrice - a.unitPrice || a.productId.localeCompare(b.productId));
    const prefix = [0];
    for (const unit of units) prefix.push(prefix.at(-1) + unit.unitPrice);
    const dp = Array(units.length + 1).fill(null);
    dp[0] = { price: 0, offers: [] };
    for (let n = 1; n <= units.length; n++) {
      for (const offer of group.offers) {
        const previous = dp[n - offer.quantity];
        if (!previous) continue;
        const candidate = { price: previous.price + offer.price, offers: [...previous.offers, offer] };
        if (!dp[n] || candidate.price < dp[n].price || (candidate.price === dp[n].price && candidate.offers.length < dp[n].offers.length)) dp[n] = candidate;
      }
    }
    let covered = 0, best = prefix.at(-1);
    for (let n = 1; n <= units.length; n++) {
      if (dp[n] && dp[n].price + prefix.at(-1) - prefix[n] < best) {
        best = dp[n].price + prefix.at(-1) - prefix[n];
        covered = n;
      }
    }
    let offset = 0;
    for (const offer of dp[covered].offers) {
      const selected = units.slice(offset, offset + offer.quantity);
      offset += offer.quantity;
      const components = combineUnits(selected);
      for (const unit of selected) remaining.set(unit, remaining.get(unit) - 1);
      const normalTotal = components.reduce((sum, item) => sum + item.lineTotal, 0);
      const name = `${group.name} - Any ${offer.quantity}`;
      const details = components.map(item => `${item.quantity} x ${item.displayName}`).join(" + ");
      checkoutItems.push({ productId: offer.productId, name, category: "Pasta", selectedOptions: {}, details,
        displayName: `${name} (${details})`, quantity: 1, unitPrice: offer.price, lineTotal: offer.price,
        autoPastaDeal: group.id, components, normalTotal, savings: normalTotal - offer.price });
    }
  }
  for (const [item, quantity] of remaining) {
    if (quantity) checkoutItems.push({ ...item, quantity, lineTotal: item.unitPrice * quantity });
  }
  const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
  const total = checkoutItems.reduce((sum, item) => sum + item.lineTotal, 0);
  return { items, checkoutItems, subtotal, discount: subtotal - total, total, currency: "gbp" };
}
