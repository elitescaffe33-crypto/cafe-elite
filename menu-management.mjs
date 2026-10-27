import { menuData, getItemKey, isRetiredProduct, slugify } from "./menu-data.mjs";
import { PUBLIC_ASSET_PATHS } from "./public-asset-allowlist.mjs";

export const managerPhotos = Object.freeze(PUBLIC_ASSET_PATHS.filter(path => path.startsWith("assets/") && !path.includes("manager-icon") && /\.(jpg|jpeg|png|webp)$/i.test(path)));
const photos = new Set(managerPhotos);
const base = menuData.flatMap(group => group.items);
const canonical = new Map(base.filter(item => !item.sourceId).map(item => [item.id, item]));
export const customProductCategories = Object.freeze(["Cakes", "Snacks", "Teas", "Soft Drinks"]);
export const customProductId = item => item.id || `custom-${slugify(String(item.category || "Menu").trim() || "Menu")}-${slugify(String(item.name || "").trim())}`;
const plain = value => value && typeof value === "object" && !Array.isArray(value);
function fail(message) { throw new Error(message); }
function text(value, max, label, required = false) {
  if (typeof value !== "string" || value.length > max || /[<>\x00-\x1f]/.test(value) || (required && !value.trim())) fail("Invalid " + label + ".");
}
export function managerPrice(value) {
  if (typeof value !== "string" || !/^(?:\u00a3)?(?:0|[1-9]\d{0,2})(?:\.\d{1,2})?$/.test(value.trim())) fail("Enter a price between GBP0.01 and GBP999.99, with at most two decimal places.");
  const amount = Number(value.trim().replace("\u00a3", ""));
  if (amount <= 0 || amount > 999.99) fail("Price must be greater than zero.");
  return "\u00a3" + amount.toFixed(2);
}

// Runs BEFORE the existing authenticated ETag/CAS persistence. Unchanged legacy
// settings are retained; newly changed menu fields must meet the new contract.
export function validateMenuSettings(next, previous = {}) {
  if (!plain(next)) fail("Invalid settings.");
  function checkKeys(object) {
    if (!object || typeof object !== "object") return;
    for (const [key, value] of Object.entries(object)) {
      if (["__proto__", "prototype", "constructor"].includes(key)) fail("Invalid settings key.");
      checkKeys(value);
    }
  }
  checkKeys(next);
  const custom = next.menuCustom || {};
  if (!plain(custom) || (custom.customItems && !Array.isArray(custom.customItems)) || (custom.hiddenItems && !Array.isArray(custom.hiddenItems))) fail("Invalid menu configuration.");
  if ((custom.customItems?.length || 0) > 500 || (custom.hiddenItems?.length || 0) > 1000) fail("Menu limit exceeded.");
  for (const key of custom.hiddenItems || []) text(key, 150, "hidden product reference", true);
  const oldCustom = previous.menuCustom?.customItems || [];
  const ids = new Set();
  for (const item of custom.customItems || []) {
    if (!plain(item)) fail("Invalid product.");
    if (item.id && ids.has(item.id)) fail("Duplicate product ID.");
    ids.add(item.id);
    if (oldCustom.some(old => JSON.stringify(old) === JSON.stringify(item))) continue;
    if (!/^custom-[a-z0-9-]{1,100}$/.test(item.id || "") || canonical.has(item.id) || isRetiredProduct(item)) fail("Invalid custom product ID.");
    if (Object.keys(item).some(key => !["id", "priceKey", "category", "name", "price", "description", "image"].includes(key))) fail("Unsupported product field. Allergen and variant approval is separate.");
    if (item.priceKey && item.priceKey !== item.id) fail("Product price reference must match its ID.");
    text(item.name, 100, "product name", true);
    text(item.description || "", 1000, "description");
    if (!customProductCategories.includes(item.category)) fail("This category requires a separately reviewed product configuration.");
    managerPrice(item.price);
    if (item.image && !photos.has(item.image)) fail("Choose an approved existing photograph.");
    if (base.some(entry => entry.name.toLowerCase() === item.name.trim().toLowerCase())) fail("Use Edit on the existing product instead of creating a duplicate.");
    if (custom.customItems.some(entry => entry !== item && entry.category?.toLowerCase() === item.category.toLowerCase() && entry.name?.trim().toLowerCase() === item.name.trim().toLowerCase())) fail("A custom product with this name already exists in this category.");
  }
  if (next.menuPrices && !plain(next.menuPrices)) fail("Invalid prices.");
  for (const [key, price] of Object.entries(next.menuPrices || {})) {
    if (previous.menuPrices?.[key] !== price) managerPrice(price);
  }
  const overrides = next.menuOverrides || {};
  if (!plain(overrides) || Object.keys(overrides).length > 1000) fail("Invalid product overrides.");
  for (const [id, item] of Object.entries(overrides)) {
    const product = canonical.get(id) || (custom.customItems || []).find(entry => customProductId(entry) === id);
    if (!product || isRetiredProduct(product) || !plain(item)) fail("Unknown or retired product reference.");
    if (Object.keys(item).some(key => !["displayName", "description", "image", "status"].includes(key))) fail("Unsupported product edit. IDs, ingredients, categories and variants are protected.");
    if (item.displayName !== undefined) text(item.displayName, 100, "product name", true);
    if (item.description !== undefined) text(item.description, 1000, "description");
    if (item.image !== undefined && item.image !== "" && !photos.has(item.image)) fail("Choose an approved existing photograph.");
    if (item.status !== undefined && !["active", "sold_out", "hidden"].includes(item.status)) fail("Invalid product status.");
  }
}

export function applyManagedMenu(groups, settings, includeHidden = false) {
  const hidden = new Set(settings.menuCustom?.hiddenItems || []);
  return groups.map(group => ({ ...group, items: group.items.flatMap(item => {
    const id = item.sourceId || item.id;
    const original = canonical.get(id) || item;
    const edit = settings.menuOverrides?.[id];
    const status = hidden.has(id) || hidden.has(getItemKey(original)) || hidden.has(original.name) ? "hidden" : edit?.status || "active";
    if (status === "hidden" && !includeHidden) return [];
    // With no edit, preserve the legacy catalogue contract exactly.
    if (!edit && status === "active") return [item];
    const output = { ...item };
    if (edit?.displayName) {
      output.displayName = edit.displayName;
      output.displayBasketName = edit.displayName;
    }
    if (edit?.description !== undefined) output.description = edit.description;
    if (edit?.image !== undefined && (!edit.image || photos.has(edit.image))) output.image = edit.image;
    output.managerStatus = status;
    output.orderable = status === "active";
    return [output];
  }) })).filter(group => group.items.length);
}
