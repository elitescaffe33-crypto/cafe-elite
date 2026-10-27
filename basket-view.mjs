import { getItemKey, menuData } from "./menu-data.mjs";
import { basketIdentifiers } from "./basket-storage.mjs";
import { normaliseAndPriceOrder } from "./order-catalogue.mjs";

export function priceBasket(basket, groups, settings) {
  return basket.length ? normaliseAndPriceOrder({ items: basketIdentifiers(basket) }, groups, settings)
    : { items: [], checkoutItems: [], subtotal: 0, discount: 0, total: 0, currency: "gbp" };
}

export function basketDealRows(basket, pricing, groups = menuData, settings = {}) {
  const key = line => JSON.stringify([line.productId, Object.fromEntries(Object.entries(line.selectedOptions).sort(([a], [b]) => a.localeCompare(b)))]);
  const available = new Map();
  basket.forEach((item, index) => {
    const line = normaliseAndPriceOrder({ items: basketIdentifiers([item]) }, groups, settings).items[0];
    if (!available.has(key(line))) available.set(key(line), []);
    available.get(key(line)).push(index);
  });
  const take = item => ({ item, indices: available.get(key(item)).splice(0, item.quantity) });
  return pricing.checkoutItems.map(item => item.autoPastaDeal ? { item, components: item.components.map(take) } : take(item));
}

// Group only for presentation; the existing checkout still receives one entry per item.
export function groupBasketItems(basket) {
  const groups = new Map();
  basket.forEach((item, index) => {
    const key = JSON.stringify([getItemKey(item), item.details || "", item.dealChoices || null]);
    if (!groups.has(key)) groups.set(key, { item, indices: [] });
    groups.get(key).indices.push(index);
  });
  return [...groups.values()];
}

export function changeBasketQuantity(basket, index, action, subset) {
  const row = subset ? { item: basket[index], indices: subset } : groupBasketItems(basket).find((group) => group.indices[0] === index);
  if (!row) return;
  if (action === "increase") basket.push({ ...row.item });
  if (action === "decrease") basket.splice(row.indices.at(-1), 1);
  if (action === "remove") [...row.indices].reverse().forEach((i) => basket.splice(i, 1));
}
