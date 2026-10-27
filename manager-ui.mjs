import { getItemKey, getItemDisplayName, isDrinkCustomisable, requiresSandwichBreadChoice, MUFFIN_FLAVOURS, MILK_CHOICES, SYRUP_MODIFIER_CHOICES } from "./menu-data.mjs";
import { managerPhotos, managerPrice, customProductCategories, customProductId, validateMenuSettings } from "./menu-management.mjs";
import { escapeMarkup as esc } from "./public-content.mjs";
import { icon, categoryIcon } from "./manager-icons.mjs";

export function managerStatusFromSwitches(visible, soldOut) { return !visible ? "hidden" : soldOut ? "sold_out" : "active"; }
export function createProductManager({ getSettings, getGroups, publish, showMessage, navigateCategory }) {
  const list = document.querySelector("#priceEditor"), editor = document.querySelector("#productEditor");
  const workspace = document.querySelector("#productWorkspace"), form = document.querySelector("#productForm");
  const search = document.querySelector("#productSearch"), category = document.querySelector("#productCategory"), status = document.querySelector("#productStatus");
  const error = document.querySelector("#productError"), save = document.querySelector("#publishProduct");
  let selected = null, returnFocus = null, busy = false, initial = "", selectedCategory = "";
  const field = name => form.elements.namedItem("product" + name);
  const groups = () => {
    const order = ["Coffee", "Teas", "Soft Drinks", "Pasta", "Fresh Baguettes", "Sandwiches", "Cakes", "Snacks", "Autumn Drinks", "Meal Deals"];
    return [...getGroups()].sort((a, b) => (order.indexOf(a.category) < 0 ? 100 : order.indexOf(a.category)) - (order.indexOf(b.category) < 0 ? 100 : order.indexOf(b.category)));
  };
  const all = () => groups().flatMap(group => group.items.map(item => ({ ...item, managerCategory: group.category })));
  const itemPrice = item => getSettings().menuPrices?.[getItemKey(item)] || getSettings().menuPrices?.[item.name] || item.price;
  const statusName = value => ({ active: "Active", sold_out: "Sold out", hidden: "Hidden" })[value || "active"];
  const photoPath = item => item?.image || (item?.id?.includes("cupcake") ? "assets/cafe-elite-cupcakes.jpg" : "");
  function photo(item, className = "") {
    const path = photoPath(item);
    return path ? `<img class="${className}" src="${esc(path)}" alt="${esc(getItemDisplayName(item))}" loading="lazy">` : `<span class="manager-no-photo">${icon(categoryIcon(item?.managerCategory))}<span>No individual photo</span></span>`;
  }
  function preview(item, amount) { return `${photo(item)}<strong>${esc(getItemDisplayName(item))}</strong><p>${esc(item.description || "")}</p><b>${esc(amount || "")}</b>`; }
  function values() {
    return { name: field("Name").value.trim(), description: field("Description").value.trim(), price: field("Price").value.trim(),
      category: field("Category").value, image: field("Image").value, status: managerStatusFromSwitches(field("Visible").checked, field("SoldOut").checked) };
  }
  function updatePreview() {
    if (!field("Visible").checked) field("SoldOut").checked = false;
    field("SoldOut").disabled = !field("Visible").checked;
    const value = values(), item = { id: selected?.id, name: value.name, description: value.description, image: value.image, managerCategory: value.category };
    document.querySelector("#productAfter").innerHTML = preview(item, value.price ? "\u00a3" + value.price : "");
    document.querySelector("#productPhoto").innerHTML = photo(item);
    document.querySelector("#descriptionCount").textContent = value.description.length + "/1000";
    const badge = document.querySelector("#editorStatus");
    badge.textContent = statusName(value.status); badge.dataset.status = value.status;
    document.querySelector("#hideProduct").disabled = value.status === "hidden";
    for (const thumb of document.querySelectorAll("[data-photo]")) thumb.setAttribute("aria-pressed", String(thumb.dataset.photo === value.image));
  }
  function renderCategories() {
    const current = groups().find(group => group.category === selectedCategory);
    if (!current) return;
    const links = (kind) => groups().map(group => `<a href="#menu/${encodeURIComponent(group.id)}" data-category="${esc(group.category)}" ${group.category === selectedCategory ? 'aria-current="page"' : ""}>${icon(categoryIcon(group.category))}<span>${esc(kind === "tiles" && group.category === "Fresh Baguettes" ? "Baguettes" : group.category)}</span></a>`).join("");
    document.querySelector("#sidebarCategories").innerHTML = links("sidebar");
    document.querySelector("#categoryTiles").innerHTML = links("tiles");
    document.querySelector("#jumpCategories").innerHTML = links("jump");
    category.innerHTML = groups().map(group => `<option>${esc(group.category)}</option>`).join("");
    category.value = selectedCategory;
    document.querySelector("#breadcrumbCategory").textContent = selectedCategory;
    document.querySelector("#mobileCategoryTitle").innerHTML = `<span class="category-heading-icon">${icon(categoryIcon(selectedCategory))}</span>${esc(selectedCategory)}`;
    document.querySelector("#headingCategoryCount").textContent = current.items.length + " items";
  }
  function render() {
    if (!groups().some(group => group.category === selectedCategory)) selectedCategory = groups()[0]?.category || "";
    renderCategories();
    const rows = all().filter(item => item.managerCategory === selectedCategory
      && (!status.value || (item.managerStatus || "active") === status.value)
      && (!search.value || getItemDisplayName(item).toLocaleLowerCase("en-GB").includes(search.value.toLocaleLowerCase("en-GB"))));
    document.querySelector("#productCount").textContent = `${rows.length} items`;
    document.querySelector("#productListTitle").textContent = "All " + selectedCategory + " Items";
    list.innerHTML = rows.length ? rows.map(item => `<article class="manager-product-row" data-row-id="${esc(item.id)}">
      ${photo(item, "manager-product-thumb")}<div class="manager-product-copy"><h3>${esc(getItemDisplayName(item))}</h3><p>${esc(item.description || "")}</p></div>
      <strong class="manager-product-price">${esc(itemPrice(item))}</strong><span class="manager-status" data-status="${item.managerStatus || "active"}">${statusName(item.managerStatus)}</span>
      <div class="manager-product-actions"><button class="button secondary" type="button" data-edit="${esc(item.id)}" aria-label="Edit ${esc(getItemDisplayName(item))}">${icon("pencil")}<span>Edit</span></button>
      ${item.managerStatus === "hidden" ? `<button class="icon-button" type="button" data-restore="${esc(item.id)}" title="Restore ${esc(getItemDisplayName(item))}" aria-label="Restore ${esc(getItemDisplayName(item))}">${icon("rotate-ccw")}</button>` : ""}</div></article>`).join("") : '<p class="manager-empty">No matching products.</p>';
  }
  const isDirty = () => !editor.hidden && JSON.stringify(values()) !== initial;
  function closeEditor() { editor.hidden = true; workspace.hidden = true; selected = null; initial = ""; returnFocus?.focus({ preventScroll: true }); }
  function canLeave() {
    if (busy) return false;
    if (isDirty() && !window.confirm("Discard unsaved product changes?")) return false;
    closeEditor(); return true;
  }
  function selectCategory(name, force = false) {
    if (!groups().some(group => group.category === name) || (!force && !canLeave())) return false;
    closeEditor(); selectedCategory = name; search.value = ""; status.value = ""; render(); return true;
  }
  function open(item = null, restoring = false) {
    if (!canLeave()) return;
    selected = item; returnFocus = document.activeElement; error.textContent = ""; form.reset();
    document.querySelector(".photo-options").open = false;
    document.querySelector("#editorTitle").innerHTML = `<span class="desktop-editor-title">${item ? "Edit Product" : "Add Product"}</span><span class="mobile-editor-title">${esc(item ? getItemDisplayName(item) : "Add product")}</span>`;
    document.querySelector("#backCategory").textContent = "Back to " + selectedCategory;
    field("Name").value = item ? getItemDisplayName(item) : "";
    field("Description").value = item?.description || "";
    field("Price").value = item ? itemPrice(item).replace("\u00a3", "") : "";
    const customRecord = item && getSettings().menuCustom?.customItems?.find(entry => customProductId(entry) === item.id);
    const custom = !item || Boolean(customRecord?.id);
    const categories = custom ? [...new Set([...customProductCategories, ...(item ? [item.managerCategory] : [])])] : [item.managerCategory];
    field("Category").innerHTML = categories.map(name => `<option>${esc(name)}</option>`).join("");
    field("Category").value = item?.managerCategory || (customProductCategories.includes(selectedCategory) ? selectedCategory : "Snacks");
    field("Category").disabled = !custom;
    field("Category").title = custom ? "" : "Catalogue category is protected to preserve existing variants and deal choices.";
    const currentStatus = restoring ? "active" : item ? item.managerStatus || "active" : "hidden";
    field("Visible").checked = currentStatus !== "hidden"; field("SoldOut").checked = currentStatus === "sold_out";
    field("Image").innerHTML = '<option value="">No individual photo</option>' + managerPhotos.map(path => `<option value="${esc(path)}">${esc(path.replace(/^assets\//, "").replace(/\.(jpg|png|webp|jpeg)$/, "").replaceAll("-", " "))}</option>`).join("");
    field("Image").value = item?.image || "";
    const thumbnails = [...new Set([photoPath(item), ...all().filter(row => row.managerCategory === selectedCategory).map(photoPath)].filter(path => managerPhotos.includes(path)))].slice(0, 3);
    document.querySelector("#photoChoices").innerHTML = thumbnails.map(path => `<button type="button" data-photo="${esc(path)}" aria-label="Choose ${esc(path.split("/").pop())}" title="Choose existing photo" aria-pressed="${path === field("Image").value}"><img src="${esc(path)}" alt=""></button>`).join("") + `<button type="button" disabled title="Upload not enabled" aria-label="Upload new photo unavailable">${icon("plus")}</button>`;
    const variants = Object.entries(item?.deal || {}).map(([name, choices]) => name + ": " + choices.join(", "));
    if (item && isDrinkCustomisable(item)) variants.push("Milk: " + MILK_CHOICES.join(", "), "Syrup: " + SYRUP_MODIFIER_CHOICES.join(", "));
    if (item && requiresSandwichBreadChoice(item)) variants.push("Bread: White, Brown");
    if (item?.id === "snack-muffins") variants.push("Flavours: " + MUFFIN_FLAVOURS.join(", "));
    if (item?.id?.includes("cupcake")) variants.push("This flavour remains in the shared Cupcakes selector; the group photo is unchanged.");
    document.querySelector("#editorOptions").textContent = variants.length ? variants.join("\n") : "No editable variants in this version.";
    document.querySelector("#productBefore").innerHTML = item ? preview(item, itemPrice(item)) : "<p>New product</p>";
    updatePreview(); initial = JSON.stringify(values()); editor.hidden = false; workspace.hidden = false;
    document.querySelector("#editorTitle").focus({ preventScroll: true });
    editor.scrollIntoView({ block: "nearest", behavior: "instant" });
  }
  for (const id of ["closeProductEditor", "cancelProductEditor", "mobileEditorBack"]) document.querySelector("#" + id).addEventListener("click", canLeave);
  document.querySelector("#addProductButton").addEventListener("click", () => open());
  document.querySelector("#hideProduct").addEventListener("click", () => { field("Visible").checked = false; updatePreview(); });
  form.addEventListener("input", updatePreview); form.addEventListener("change", updatePreview);
  document.querySelector("#photoChoices").addEventListener("click", event => {
    const button = event.target.closest("[data-photo]"); if (!button) return;
    field("Image").value = button.dataset.photo; updatePreview();
  });
  search.addEventListener("input", render); status.addEventListener("change", render);
  category.addEventListener("change", () => navigateCategory ? navigateCategory(category.value) : selectCategory(category.value));
  for (const id of ["sidebarCategories", "categoryTiles", "jumpCategories"]) document.querySelector("#" + id).addEventListener("click", event => {
    const link = event.target.closest("[data-category]"); if (!link) return;
    event.preventDefault(); if (navigateCategory) navigateCategory(link.dataset.category); else selectCategory(link.dataset.category);
  });
  list.addEventListener("click", event => {
    const button = event.target.closest("[data-edit], [data-restore]"); if (!button) return;
    const item = all().find(item => item.id === (button.dataset.edit || button.dataset.restore));
    if (item) open(item, Boolean(button.dataset.restore));
  });
  form.addEventListener("submit", async event => {
    event.preventDefault(); if (busy) return; error.textContent = "";
    try {
      const value = values(), before = getSettings(), next = structuredClone(before), price = managerPrice(value.price);
      next.menuCustom ||= { hiddenItems: [], customItems: [] }; next.menuOverrides ||= {}; next.menuPrices ||= {};
      let id = selected?.id;
      if (!id) {
        id = "custom-" + crypto.randomUUID();
        next.menuCustom.customItems.push({ id, priceKey: id, category: value.category, name: value.name, price, description: value.description, image: value.image });
      } else {
        const custom = next.menuCustom.customItems.find(item => customProductId(item) === id);
        if (custom && custom.category !== value.category) custom.category = value.category;
      }
      next.menuPrices[selected ? getItemKey(selected) : id] = price;
      next.menuOverrides[id] = { displayName: value.name, description: value.description, image: value.image, status: value.status };
      if (selected && value.status !== "hidden") next.menuCustom.hiddenItems = next.menuCustom.hiddenItems.filter(key => ![id, getItemKey(selected), selected.name].includes(key));
      validateMenuSettings(next, before);
      if (!window.confirm(value.status === "hidden" ? "Save as hidden? Existing orders will not change." : "Save these product changes to the menu?")) return;
      busy = true; save.disabled = true; save.textContent = "Saving...";
      await publish(next); initial = JSON.stringify(values()); selectedCategory = value.category; closeEditor(); render(); showMessage("Product changes saved.");
    } catch (problem) { error.textContent = problem.message || "Nothing was saved. Please refresh and try again."; }
    finally { busy = false; save.disabled = false; save.textContent = "Save changes"; }
  });
  return { render, canLeave, isDirty, selectCategory, category: () => selectedCategory, close: () => { closeEditor(); form.reset(); list.replaceChildren(); } };
}
