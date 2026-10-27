import {
  menuData, getItemKey, getItemOrderName, getDisplayDetails, priceToPence, isRetiredProduct,
  isDrinkCustomisable, defaultDrinkMilk, MILK_CHOICES, SYRUP_MODIFIER_CHOICES, drinkSyrupSurchargePence,
  requiresSandwichBreadChoice, SANDWICH_BREAD_CHOICES, MUFFIN_FLAVOURS,
} from "./menu-data.mjs";
import { applyPastaDeals } from "./smart-pasta-deals.mjs";

export class OrderError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);
const optionCategories = { coffee: "coffee", sandwich: "sandwiches", baguette: "fresh-baguettes", snack: "snacks" };

export function canonicalItems(items) {
  if (!Array.isArray(items) || !items.length || items.length > 50) throw new OrderError("Choose between 1 and 50 order lines.");
  let count = 0;
  return items.map(line => {
    if (!isRecord(line) || typeof line.productId !== "string" || !/^[a-z0-9-]{1,120}$/.test(line.productId)) throw new OrderError("Invalid product identifier.");
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 20) throw new OrderError("Quantity must be a whole number between 1 and 20.");
    count += line.quantity;
    if (count > 50) throw new OrderError("An order can contain at most 50 items.");
    const options = line.selectedOptions ?? {};
    if (!isRecord(options) || Object.keys(options).length > 8) throw new OrderError("Invalid product options.");
    const selectedOptions = {};
    for (const key of Object.keys(options).sort()) {
      if (!/^[a-zA-Z][a-zA-Z0-9]{0,30}$/.test(key) || typeof options[key] !== "string" || options[key].length > 100) throw new OrderError("Invalid product options.");
      selectedOptions[key] = options[key];
    }
    // Legacy price/name/total fields deliberately have no influence on this result.
    return { productId: line.productId, quantity: line.quantity, selectedOptions };
  });
}

export function normaliseAndPriceOrder(payload, groups = menuData, settings = {}) {
  if (!isRecord(payload)) throw new OrderError("Invalid order request.");
  const entries = groups.flatMap(group => group.items.map(item => ({ ...item, category: group.category, categoryId: group.id })));
  const products = new Map(entries.filter(item => !item.sourceId).map(item => [item.id, item]));
  const aliases = new Map(entries.filter(item => item.sourceId).map(item => [item.id, item.sourceId]));
  const original = menuData.flatMap(group => group.items);
  const combined = new Map();
  for (const line of canonicalItems(payload.items)) {
    const id = aliases.get(line.productId) || line.productId;
    const item = products.get(id);
    if (!item || isRetiredProduct(item) || item.active === false || item.orderable === false) throw new OrderError("A selected product is no longer available.", 422);
    const rules = item.deal || {};
    const keys = Object.keys(rules);
    const drinkOptionsAllowed = isDrinkCustomisable(item);
    const sandwichBreadRequired = requiresSandwichBreadChoice(item);
    const muffinChoiceRequired = item.id === "snack-muffins" || (Array.isArray(item.deal?.snack) && line.selectedOptions.snack === "Muffins");
    const allowedKeys = [...keys, ...(drinkOptionsAllowed ? ["milk", "syrup"] : []), ...(sandwichBreadRequired ? ["bread"] : []), ...(muffinChoiceRequired ? ["muffinFlavour"] : [])];
    if (keys.some(key => !Object.hasOwn(line.selectedOptions, key))
      || Object.keys(line.selectedOptions).some(key => !allowedKeys.includes(key)))
      throw new OrderError("Please complete all required product choices.", 422);
    for (const key of keys) {
      const value = line.selectedOptions[key];
      if (!Array.isArray(rules[key]) || !rules[key].includes(value)) throw new OrderError("A selected option is not available for this product.", 422);
      const category = key.startsWith("bowl") ? "pasta" : optionCategories[key];
      if (category && original.some(entry => entry.categoryId === category && entry.name === value) && !entries.some(entry => entry.categoryId === category && entry.name === value && entry.active !== false && entry.orderable !== false)) throw new OrderError("A selected deal item is currently unavailable.", 422);
    }
    if (id.startsWith("deal-bolognese-") && (!products.has("pasta-bolognese-bowl") || products.get("pasta-bolognese-bowl").orderable === false)) throw new OrderError("Bolognese bowls are currently unavailable.", 422);
    const options = Object.fromEntries(keys.map(key => [key, line.selectedOptions[key]]));
    if (muffinChoiceRequired) {
      if (!MUFFIN_FLAVOURS.includes(line.selectedOptions.muffinFlavour))
        throw new OrderError("Choose Blueberry, Cherry, Chocolate Chip or Double Chocolate muffin.", 422);
      options.muffinFlavour = line.selectedOptions.muffinFlavour;
    }
    if (sandwichBreadRequired) {
      if (!SANDWICH_BREAD_CHOICES.includes(line.selectedOptions.bread))
        throw new OrderError("Choose White or Brown bread for the sandwich.", 422);
      options.bread = line.selectedOptions.bread;
    }
    if (drinkOptionsAllowed) {
      const milk = line.selectedOptions.milk ?? defaultDrinkMilk(item, options);
      const syrup = line.selectedOptions.syrup ?? "No syrup";
      if (!MILK_CHOICES.includes(milk) || !SYRUP_MODIFIER_CHOICES.includes(syrup))
        throw new OrderError("An unavailable drink option was selected.", 422);
      options.milk = milk;
      options.syrup = syrup;
    }
    const basePrice = priceToPence(settings.menuPrices?.[getItemKey(item)] || settings.menuPrices?.[item.name] || item.price);
    if (!Number.isSafeInteger(basePrice) || basePrice <= 0) throw new OrderError("A selected product cannot currently be ordered.", 422);
    const unitPrice = basePrice + (drinkOptionsAllowed ? drinkSyrupSurchargePence(options) : 0);
    const displayOptions = [
      ...keys.map(key => options[key]),
      ...(sandwichBreadRequired ? [options.bread + " bread"] : []),
      ...(muffinChoiceRequired ? [options.muffinFlavour + " muffin"] : []),
      ...(drinkOptionsAllowed ? [options.milk, ...(options.syrup === "No syrup" ? [] : [options.syrup + " syrup"])] : []),
    ];
    const details = getDisplayDetails(item.fixedDetails || displayOptions.join(" + "));
    const name = getItemOrderName(item);
    const key = JSON.stringify([id, options]);
    const trusted = combined.get(key) || { productId: id, name, description: item.description || "", category: item.category, selectedOptions: options, details, displayName: details ? `${name} (${details})` : name, unitPrice, quantity: 0 };
    trusted.quantity += line.quantity;
    if (trusted.quantity > 20) throw new OrderError("Quantity must not exceed 20 for the same product and choices.");
    trusted.lineTotal = trusted.unitPrice * trusted.quantity;
    combined.set(key, trusted);
  }
  const items = [...combined.values()];
  const total = items.reduce((sum, item) => sum + item.lineTotal, 0);
  if (!Number.isSafeInteger(total) || total <= 0) throw new OrderError("Invalid order total.");
  return applyPastaDeals(items, groups, settings);
}
