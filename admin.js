import { getItemKey, getItemOrderName, menuData, slugify, isRetiredProduct, isRedundantLegacyCustomItem } from "./menu-data.mjs";
import { dayKeys, defaultSiteSettings, mergeSettings, getOrderingStatus } from "./site-settings.mjs";
import { applyManagedMenu } from "./menu-management.mjs";
import { isApprovedPublicAsset } from "./public-asset-allowlist.mjs";
import { createProductManager } from "./manager-ui.mjs";
import { hydrateIcons } from "./manager-icons.mjs";
import { visibleOrderReference } from "./order-reference.mjs";
hydrateIcons();

const passwordInput = document.querySelector("#adminPassword");
const loginButton = document.querySelector("#loginButton");
const loginPanel = document.querySelector("#loginPanel");
const dashboard = document.querySelector("#adminDashboard");
const settingsForm = document.querySelector("#settingsForm");

const hoursTable = document.querySelector("#hoursTable");
const ordersList = document.querySelector("#ordersList");
const refreshOrders = document.querySelector("#refreshOrders");
const contactsList = document.querySelector("#contactsList");
const refreshContacts = document.querySelector("#refreshContacts");
const copyContacts = document.querySelector("#copyContacts");
const adminMessage = document.querySelector("#adminMessage");

const adminPasswordStorageKey = "cafeEliteAdminPassword";
// Remove old persistent credential copies; remember successful access only
// within the current browser tab/session, never indefinitely in localStorage.
try { window.localStorage.removeItem(adminPasswordStorageKey); } catch { /* Storage may be unavailable. */ }
let adminPassword = "";
try { adminPassword = window.sessionStorage.getItem(adminPasswordStorageKey) || ""; } catch { /* Private browsing. */ }
let currentSettings = defaultSiteSettings;
let currentContacts = [];
let adminSettingsRevision = "";
let currentOrders = [];
let sessionGeneration = 0;
const productManager = createProductManager({
  getSettings: () => currentSettings,
  getGroups: () => getEffectiveMenuData(true).filter(group => !group.featured),
  showMessage,
  navigateCategory: name => { const group = getEffectiveMenuData(true).find(group => group.category === name); if (group) openAdminSection("#menu/" + encodeURIComponent(group.id)); },
  publish: async settings => {
    currentSettings = mergeSettings(defaultSiteSettings, await adminFetch("/api/admin/settings", { method: "POST", body: JSON.stringify(settings) }));
    renderSettingsForm();
  },
});
function renderOverview() {
  const status = getOrderingStatus(new Date(), currentSettings);
  const day = new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: "Europe/London" }).format(new Date()).toLowerCase();
  const hours = currentSettings.ordering.days[day];
  document.querySelector("#managerOrdering").textContent = currentSettings.ordering.enabled ? (status.isOpen ? "Open" : "Outside hours") : "Paused";
  document.querySelector("#managerHours").textContent = hours ? hours.open + " - " + hours.close : "Not set";
  document.querySelector("#managerOrderCount").textContent = currentOrders.filter(order => !["completed", "cancelled"].includes(order.status)).length;
  const openCount = currentOrders.filter(order => !["completed", "cancelled"].includes(order.status)).length;
  const count = document.querySelector("#sidebarOrderCount"); count.textContent = String(openCount); count.hidden = openCount === 0;
  document.querySelector("#managerOrderDot").hidden = openCount === 0;
  document.querySelector("#managerNotice").textContent = currentSettings.ordering.enabled ? status.message : "New online orders are paused.";
}
const SESSION_DURATION = 30 * 60 * 1000;
const expiryKey = "cafeEliteAdminExpires";
let expires = 0;
try { expires = Number(sessionStorage.getItem(expiryKey) || 0); } catch { /* In-memory access still works. */ }
if (!expires || Date.now() >= expires) {
  adminPassword = "";
  try { sessionStorage.removeItem(adminPasswordStorageKey); } catch { /* Storage unavailable. */ }
}
function expireSession() {
  sessionGeneration++;
  adminPassword = "";
  adminSettingsRevision = "";
  try { sessionStorage.removeItem(adminPasswordStorageKey); sessionStorage.removeItem(expiryKey); } catch { /* In-memory sign-out still applies. */ }
  currentContacts = []; currentOrders = [];
  currentSettings = defaultSiteSettings;
  passwordInput.value = "";
  ordersList.replaceChildren(); contactsList.replaceChildren();
  productManager.close();
  dashboard.hidden = true; loginPanel.hidden = false;
  settingsInitial = ""; settingsForm.reset(); hoursTable.replaceChildren();
  document.body.classList.remove("products-view");
  document.querySelector("#pageTitle").textContent = "Cafe Elite Manager";
  document.querySelector("#managerSubtitle").textContent = "Owner access";
  document.querySelector("#productSearch").disabled = true;
  closeSidebar(false);
  showMessage("Session ended. Please sign in again.");
}
setInterval(() => { if (adminPassword && Date.now() >= expires) expireSession(); }, 15000);
passwordInput.addEventListener("keydown", event => { if (event.key === "Enter") loginButton.click(); });

if (adminPassword) openAdmin();

loginButton.addEventListener("click", () => {
  sessionGeneration++;
  adminPassword = passwordInput.value.trim();
  if (!adminPassword) { showMessage("Enter the administrator password."); passwordInput.focus(); return; }
  try { window.sessionStorage.setItem(adminPasswordStorageKey, adminPassword); } catch { /* Session memory still works. */ }
  expires = Date.now() + SESSION_DURATION;
  try { sessionStorage.setItem(expiryKey, String(expires)); } catch { /* In-memory session only. */ }
  passwordInput.value = "";
  openAdmin();
});

for (const button of document.querySelectorAll("#adminLogout, #mobileLogout")) button.addEventListener("click", () => {
  if (!canLeaveSection()) return;
  expireSession();
  showMessage("Signed out of this session.");
  passwordInput.focus();
});

const narrow = window.matchMedia("(max-width:1023px)");
const sidebar = document.querySelector("#managerSidebar"), sidebarToggle = document.querySelector("#sidebarToggle");
const topbar = document.querySelector("#managerTopbar"), main = document.querySelector("#managerMain");
const backdrop = document.querySelector("#drawerBackdrop");
let drawerOpen = false, currentSectionHash = "#overview", settingsInitial = "", settingsSaving = false;
const settingsDirty = () => settingsInitial && JSON.stringify([...new FormData(settingsForm)]) !== settingsInitial;
function closeSidebar(restoreFocus = true) {
  drawerOpen = false; document.body.classList.remove("drawer-open"); document.body.style.overflow = "";
  backdrop.hidden = true; main.inert = false; topbar.inert = false; sidebar.inert = narrow.matches;
  sidebar.removeAttribute("role"); sidebar.removeAttribute("aria-modal");
  sidebarToggle.setAttribute("aria-expanded", "false");
  if (restoreFocus) sidebarToggle.focus();
}
function toggleSidebar() {
  if (!narrow.matches) {
    document.body.classList.toggle("sidebar-collapsed");
    sidebarToggle.setAttribute("aria-expanded", String(!document.body.classList.contains("sidebar-collapsed")));
    return;
  }
  if (drawerOpen) { closeSidebar(); return; }
  drawerOpen = true; sidebar.inert = false; document.body.classList.add("drawer-open"); document.body.style.overflow = "hidden";
  sidebar.setAttribute("role", "dialog"); sidebar.setAttribute("aria-modal", "true");
  backdrop.hidden = false; main.inert = true; topbar.inert = true;
  sidebarToggle.setAttribute("aria-expanded", "true"); document.querySelector("#closeSidebar").focus();
}
sidebarToggle.addEventListener("click", toggleSidebar);
document.querySelector("#closeSidebar").addEventListener("click", () => closeSidebar());
backdrop.addEventListener("click", () => closeSidebar());
document.querySelector("#menuDisclosure").addEventListener("click", event => {
  const button = event.currentTarget, expanded = button.getAttribute("aria-expanded") === "true";
  button.setAttribute("aria-expanded", String(!expanded)); document.querySelector("#sidebarCategories").hidden = expanded;
});
document.addEventListener("keydown", event => {
  if (!drawerOpen) return;
  if (event.key === "Escape") { event.preventDefault(); closeSidebar(); }
  if (event.key === "Tab") {
    const nodes = [...sidebar.querySelectorAll("a,button,input,select,summary")].filter(node => !node.disabled && node.getClientRects().length);
    const first = nodes[0], last = nodes.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
});
function updateResponsiveControls() {
  closeSidebar(false); document.body.classList.remove("sidebar-collapsed");
  const search = document.querySelector(".manager-search");
  if (narrow.matches) document.querySelector(".mobile-product-search").append(search);
  else topbar.insertBefore(search, document.querySelector("#statusButton"));
  updateHoursDay();
  if (document.body.classList.contains("products-view")) document.querySelector("#managerSubtitle").textContent = narrow.matches ? "Manage " + productManager.category().toLowerCase() + " items." : "Manage your menu items, opening hours, order options and more.";
}
narrow.addEventListener("change", updateResponsiveControls);
updateResponsiveControls();
function canLeaveSection() {
  if (settingsSaving) return false;
  if (settingsDirty()) {
    if (!window.confirm("Discard unsaved hours and ordering changes?")) return false;
    renderSettingsForm();
  }
  return productManager.canLeave();
}
document.addEventListener("click", event => {
  const link = event.target.closest('a[href^="#"]');
  if (!link || link.dataset.category || link.classList.contains("skip-link")) return;
  if (!["#overview", "#settings", "#prices", "#orders", "#customers"].includes(link.hash)) return;
  event.preventDefault(); openAdminSection(link.hash);
});
document.querySelectorAll('a[href="index.html"]').forEach(link => link.addEventListener("click", event => {
  if (!canLeaveSection()) event.preventDefault();
}));
document.querySelector("#statusButton").addEventListener("click", () => openAdminSection("#overview"));
function openAdminSection(hash = window.location.hash, { force = false } = {}) {
  if (!force && !canLeaveSection()) { history.replaceState(null, "", currentSectionHash); closeSidebar(); return false; }
  const categoryId = hash.startsWith("#menu/") ? hash.slice(6) : "";
  const group = categoryId ? getEffectiveMenuData(true).find(group => encodeURIComponent(group.id) === categoryId) : null;
  const id = categoryId ? "#prices" : ["#overview", "#settings", "#prices", "#orders", "#customers"].includes(hash) ? hash : "#overview";
  if (id === "#prices") {
    if (group) productManager.selectCategory(group.category, true);
    else productManager.render();
  }
  for (const panel of document.querySelectorAll(".admin-grid > section")) panel.hidden = panel.id !== id.slice(1);
  for (const link of document.querySelectorAll('.is-admin-nav > a[href^="#"]')) {
    if (link.hash === id) link.setAttribute("aria-current", "page"); else link.removeAttribute("aria-current");
  }
  const products = id === "#prices";
  document.body.classList.toggle("products-view", products);
  document.querySelector("#pageTitle").textContent = ({ "#overview":"Dashboard", "#settings":"Settings", "#prices":"Settings", "#orders":"Orders", "#customers":"Customers" })[id];
  document.querySelector("#managerSubtitle").textContent = ({ "#overview":"Today's business overview.", "#settings":"Opening hours and online order options.", "#prices":"Manage your menu items, opening hours, order options and more.", "#orders":"Recent orders and collection status.", "#customers":"Customer contacts from existing orders." })[id];
  if (products && narrow.matches) document.querySelector("#managerSubtitle").textContent = "Manage " + productManager.category().toLowerCase() + " items.";
  document.querySelector("#managerBreadcrumb").hidden = !products;
  document.querySelector("#mobileCategoryTitle").hidden = !products;
  document.querySelector("#headingCategoryCount").hidden = !products;
  document.querySelector("#productSearch").disabled = !products || !adminPassword;
  document.querySelector("#menuDisclosure").classList.toggle("is-active", products);
  if (id === "#customers" && adminPassword) loadContacts().catch(error => showMessage(error.message));
  currentSectionHash = group ? "#menu/" + encodeURIComponent(group.id) : id;
  if (window.location.hash !== currentSectionHash) history.pushState(null, "", currentSectionHash);
  closeSidebar(false); document.querySelector("#ownerAccount").open = false; window.scrollTo({ top:0, behavior:"instant" });
  return true;
}
window.addEventListener("hashchange", () => openAdminSection());
window.addEventListener("popstate", () => openAdminSection());
window.addEventListener("beforeunload", event => {
  if (settingsDirty() || productManager.isDirty() || settingsSaving) { event.preventDefault(); event.returnValue = ""; }
});
document.querySelector("#cancelSettings").addEventListener("click", () => {
  if (!settingsDirty() || window.confirm("Discard unsaved hours and ordering changes?")) renderSettingsForm();
});
document.querySelector("#hoursDay").addEventListener("change", updateHoursDay);
function updateHoursDay() {
  const chosen = document.querySelector("#hoursDay").value;
  for (const row of hoursTable.querySelectorAll("[data-day]")) row.hidden = narrow.matches && row.dataset.day !== chosen;
}

settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (settingsSaving || !window.confirm("Save hours and ordering changes? This affects new orders.")) return;
  const settings = readSettingsFromForm();
  settingsSaving = true;
  const button = settingsForm.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    currentSettings = mergeSettings(defaultSiteSettings, await adminFetch("/api/admin/settings", {
      method: "POST", body: JSON.stringify(settings),
    }));
    renderSettingsForm();
    showMessage("Settings saved.");
  } catch (error) {
    showMessage(error.message || "Settings could not be saved. Please try again.");
  } finally { settingsSaving = false; button.disabled = false; }
});

refreshOrders.addEventListener("click", () => loadOrders().catch(error => showMessage(error.message)));
refreshContacts.addEventListener("click", () => loadContacts().catch(error => showMessage(error.message)));
for (const button of document.querySelectorAll("#reloadSettings, #mobileReload")) button.addEventListener("click", async () => {
  if (!canLeaveSection()) return;
  if (!window.confirm("Reload the latest saved settings?")) return;
  try {
    currentSettings = mergeSettings(defaultSiteSettings, await adminFetch("/api/admin/settings"));
    renderSettingsForm(); renderPriceEditor(); closeSidebar(false); showMessage("Latest settings loaded.");
  } catch (error) { showMessage(error.message); }
});

copyContacts.addEventListener("click", async () => {
  const csv = [
    "name,email,phone,email_marketing_consent,sms_marketing_consent,channel_consent_recorded,order_count,latest_order",
    ...currentContacts.map((contact) =>
      [contact.name, contact.email, contact.phone, contact.marketingEmailConsent ? "yes" : "no", contact.marketingSmsConsent ? "yes" : "no", contact.channelConsentRecorded ? "yes" : "no", contact.orderCount, contact.latestOrderAt]
        .map((value) => `"${String(value || "").replace(/"/g, '""')}"`)
        .join(","),
    ),
  ].join("\n");
  await navigator.clipboard.writeText(csv);
  showMessage("Contacts copied as CSV.");
});

ordersList.addEventListener("click", async (event) => {
  const actionButton = event.target.closest("[data-action]");
  if (actionButton) {
    const orderCard = actionButton.closest(".order-history-card");
    const orderText = orderCard?.querySelector(".printable-order")?.textContent || "";

    if (actionButton.dataset.action === "copy") {
      await navigator.clipboard.writeText(orderText);
      showMessage("Order copied.");
      return;
    }

    if (actionButton.dataset.action === "print") {
      printOrder(orderText);
      return;
    }
  }

  const button = event.target.closest("[data-status]");
  if (!button) return;

  button.disabled = true;
  try {
    await adminFetch("/api/admin/order-status", {
      method: "POST",
      body: JSON.stringify({
        id: button.dataset.orderId,
        status: button.dataset.status,
      }),
    });
    showMessage("Order status updated.");
    await loadOrders();
  } catch (error) {
    showMessage(error.message || "Order status could not be updated.");
    button.disabled = false;
  }
});

async function openAdmin() {
  const generation = sessionGeneration;
  try {
    currentSettings = mergeSettings(defaultSiteSettings, await adminFetch("/api/admin/settings"));
    renderSettingsForm();
    renderPriceEditor();
    await loadOrders();
    if (generation !== sessionGeneration || !adminPassword) return;

    loginPanel.hidden = true;
    dashboard.hidden = false;
    openAdminSection(window.location.hash, { force: true });
    renderOverview();
    showMessage("");
  } catch (error) {
    if (generation !== sessionGeneration) return;
    dashboard.hidden = true;
    loginPanel.hidden = false;
    showMessage(error.message || "Login failed.");
  }
}

function renderPriceEditor() { productManager.render(); }

function getMenuCustom() {
  currentSettings.menuCustom ||= { hiddenItems: [], customItems: [] };
  currentSettings.menuCustom.hiddenItems ||= [];
  currentSettings.menuCustom.customItems ||= [];
  return currentSettings.menuCustom;
}

function baseItemKeys() {
  return new Set(menuData.flatMap((group) => group.items.map((item) => getItemKey(item))));
}

function isHiddenItem(item, hiddenItems) {
  const key = getItemKey(item);
  return hiddenItems.has(key) || hiddenItems.has(item.id) || hiddenItems.has(item.name);
}

function normalizeCustomMenuItem(item) {
  const name = String(item?.name || "").trim();
  const category = String(item?.category || "Menu").trim() || "Menu";
  const id = item?.id || `custom-${slugify(category)}-${slugify(name)}`;
  return {
    id,
    priceKey: item?.priceKey || id,
    category,
    name,
    price: item?.price || "\u00a30.00",
    description: item?.description || "",
    ...(isApprovedPublicAsset(item?.image) ? { image: item.image } : {}),
  };
}

function getEffectiveMenuData(includeHidden = false) {
  const custom = getMenuCustom();
  const hidden = new Set(includeHidden ? [] : custom.hiddenItems);
  const groups = menuData
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !isRetiredProduct(item) && !isHiddenItem(item, hidden)),
    }))
    .filter((group) => group.items.length);

  custom.customItems.filter(item => !isRedundantLegacyCustomItem(item)).map(normalizeCustomMenuItem).forEach((item) => {
    if (!item.name || isRetiredProduct(item) || isHiddenItem(item, hidden)) return;
    let group = groups.find((entry) => entry.category.toLowerCase() === item.category.toLowerCase());
    if (!group) {
      group = { id: slugify(item.category), category: item.category, items: [] };
      groups.push(group);
    }
    const existingIndex = group.items.findIndex((entry) => getItemKey(entry) === getItemKey(item) || entry.name === item.name);
    const normalized = {
      id: item.id,
      priceKey: item.priceKey,
      name: item.name,
      price: item.price,
      description: item.description || "",
      ...(item.image ? { image: item.image } : {}),
    };
    if (existingIndex >= 0) group.items[existingIndex] = { ...group.items[existingIndex], ...normalized };
    else group.items.push(normalized);
  });

  return applyManagedMenu(groups, currentSettings, includeHidden);
}

function getPriceEditorMenuData() {
  return getEffectiveMenuData().filter((group) => !group.featured);
}

async function adminFetch(url, options = {}) {
  if (!adminPassword || Date.now() >= expires) { expireSession(); throw new Error("Please sign in again."); }
  const isSettings = url === "/api/admin/settings";
  if (isSettings && options.method === "POST" && !adminSettingsRevision) {
    throw new Error("Refresh site settings before saving changes.");
  }
  const generation = sessionGeneration;
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Password": adminPassword,
      ...(isSettings && options.method === "POST" ? { "If-Match": adminSettingsRevision } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (generation !== sessionGeneration || !adminPassword || Date.now() >= expires) {
    if (generation === sessionGeneration) expireSession();
    throw new Error("Session ended. Please sign in again.");
  }
  if (!response.ok) {
    if (response.status === 401) expireSession();
    throw new Error(data.error || "Admin request failed");
  }
  if (isSettings) {
    const revision = response.headers.get("ETag");
    if (!revision || !/^"[0-9a-f]{64}"$/.test(revision)) {
      throw new Error("Settings version could not be verified. Refresh before making changes.");
    }
    adminSettingsRevision = revision;
  }
  return data;
}

function renderSettingsForm() {
  renderOverview();
  settingsForm.orderingEnabled.checked = currentSettings.ordering.enabled;
  settingsForm.collection.checked = currentSettings.services.collection;
  settingsForm.delivery.checked = currentSettings.services.delivery;
  settingsForm.payOnCollection.checked = currentSettings.payments.payOnCollection;
  settingsForm.stripe.checked = currentSettings.payments.stripe;

  const chosenDay = document.querySelector("#hoursDay").value || new Intl.DateTimeFormat("en-GB", { weekday:"long", timeZone:"Europe/London" }).format(new Date()).toLowerCase();
  document.querySelector("#hoursDay").innerHTML = dayKeys.map(key => `<option value="${key}">${currentSettings.ordering.days[key].label}</option>`).join("");
  document.querySelector("#hoursDay").value = chosenDay;
  hoursTable.innerHTML = dayKeys
    .map((key) => {
      const day = currentSettings.ordering.days[key];
      return `
        <div class="hours-row" data-day="${key}">
          <strong>${day.label}</strong>
          <label>Open <input name="${key}-open" type="time" value="${day.open}" /></label>
          <label>Close <input name="${key}-close" type="time" value="${day.close}" /></label>
          <label>Last order <input name="${key}-lastOrder" type="time" value="${day.lastOrder}" /></label>
        </div>
      `;
    })
    .join("");
  updateHoursDay();
  settingsInitial = JSON.stringify([...new FormData(settingsForm)]);
}

function readSettingsFromForm() {
  const settings = structuredClone(mergeSettings(defaultSiteSettings, currentSettings));
  settings.ordering.enabled = settingsForm.orderingEnabled.checked;
  settings.services.collection = settingsForm.collection.checked;
  settings.services.delivery = settingsForm.delivery.checked;
  settings.payments.payOnCollection = settingsForm.payOnCollection.checked;
  settings.payments.stripe = settingsForm.stripe.checked;

  dayKeys.forEach((key) => {
    settings.ordering.days[key].open = settingsForm.querySelector(`[name="${key}-open"]`).value;
    settings.ordering.days[key].close = settingsForm.querySelector(`[name="${key}-close"]`).value;
    settings.ordering.days[key].lastOrder = settingsForm.querySelector(`[name="${key}-lastOrder"]`).value;
  });

  return settings;
}

async function loadOrders() {
  const orders = await adminFetch("/api/admin/orders");
  currentOrders = orders;
  renderOverview();
  ordersList.innerHTML = orders.length
    ? orders.map(renderOrder).join("")
    : `<p class="basket-empty">No orders saved yet.</p>`;
}

async function loadContacts() {
  currentContacts = await adminFetch("/api/admin/contacts");
  contactsList.innerHTML = currentContacts.length
    ? currentContacts.map(renderContact).join("")
    : `<p class="basket-empty">No customer contacts saved yet.</p>`;
}

function renderContact(contact) {
  const date = contact.latestOrderAt
    ? new Date(contact.latestOrderAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })
    : "Not provided";

  return `
    <article class="contact-card">
      <strong>${escapeHtml(contact.name || "Unnamed customer")}</strong>
      <p><b>Email:</b> ${contact.email ? `<a href="mailto:${escapeHtml(contact.email)}">${escapeHtml(contact.email)}</a>` : "Not provided"}</p>
      <p><b>Phone:</b> ${contact.phone ? `<a href="tel:${escapeHtml(contact.phone)}">${escapeHtml(contact.phone)}</a>` : "Not provided"}</p>
      <p><b>Email offers:</b> ${contact.marketingEmailConsent ? "Yes" : "No"} | <b>Text offers:</b> ${contact.marketingSmsConsent ? "Yes" : "No"}</p>
      ${contact.channelConsentRecorded ? "" : "<p>Separate channel consent not recorded. Do not use legacy consent for marketing.</p>"}
      <p><b>Orders:</b> ${escapeHtml(contact.orderCount || 0)} | <b>Latest:</b> ${escapeHtml(date)}</p>
    </article>
  `;
}

function renderOrder(order) {
  const date = new Date(order.createdAt).toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const paymentLabel = order.paymentState === "paid" || order.type === "paid-online" ? "Paid online" : order.type === "online" ? (order.paymentState === "failed" ? "Online payment not completed" : "Awaiting online payment") : "Pay on collection";
  const status = order.status || "new";
  const phone = order.phone || "";
  const printableOrder = formatPrintableOrder(order, paymentLabel, date);

  return `
    <article class="order-history-card">
      <div class="order-card-head">
        <div>
          <strong>${paymentLabel}</strong>
          <span class="order-status is-${escapeHtml(status)}">${escapeHtml(status)}</span>
        </div>
        <span>${date}</span>
      </div>
      <p><b>Order #:</b> <strong>${escapeHtml(visibleOrderReference(order))}</strong></p>
      <p><b>Name:</b> ${escapeHtml(order.customerName || "Not provided")}</p>
      <p><b>Phone:</b> ${
        phone
          ? `<a href="tel:${escapeHtml(phone)}">${escapeHtml(phone)}</a>`
          : "Not provided"
      }</p>
      <p><b>Collection:</b> ${escapeHtml(order.collectionTime || "Not provided")}</p>
      <p><b>Total:</b> ${escapeHtml(order.amount || "Pay at collection")}</p>
      ${order.notificationStatus ? `<p><b>Order notification:</b> ${escapeHtml(({ pending: "Pending", not_ready: "Waiting for payment", sending: "Sending / awaiting delivery confirmation", sent: "Sent", failed_uncertain: "Delivery uncertain - check before resending" })[order.notificationStatus] || "Check delivery status")}</p>` : ""}
      <pre>${escapeHtml(order.items || order.message || "")}</pre>
      ${order.notes ? `<p><b>Notes:</b> ${escapeHtml(order.notes)}</p>` : ""}
      <pre class="printable-order" hidden>${escapeHtml(printableOrder)}</pre>
      <div class="order-tools" aria-label="Order tools">
        <button class="status-button" type="button" data-action="print">Print</button>
        <button class="status-button" type="button" data-action="copy">Copy order</button>
      </div>
      <div class="order-actions" aria-label="Update order status">
        ${renderStatusButton(order.id, status, "new", "New")}
        ${renderStatusButton(order.id, status, "preparing", "Preparing")}
        ${renderStatusButton(order.id, status, "completed", "Completed")}
        ${renderStatusButton(order.id, status, "cancelled", "Cancelled")}
      </div>
    </article>
  `;
}

function formatPrintableOrder(order, paymentLabel, date) {
  return [
    "CAFE ELITE",
    "33 High Street, Leominster HR6 8LZ",
    "------------------------------",
    `Order #: ${visibleOrderReference(order)}`,
    `Order time: ${date}`,
    `Payment: ${paymentLabel}`,
    `Status: ${order.status || "new"}`,
    `Name: ${order.customerName || "Not provided"}`,
    `Phone: ${order.phone || "Not provided"}`,
    `Collection: ${order.collectionTime || "Not provided"}`,
    `Total: ${order.amount || "Pay at collection"}`,
    "------------------------------",
    "Items:",
    order.items || order.message || "No items",
    order.notes ? `Notes: ${order.notes}` : "Notes: None",
    "------------------------------",
  ].join("\n");
}

function printOrder(orderText) {
  const printWindow = window.open("", "_blank", "width=420,height=680");
  if (!printWindow) {
    showMessage("Print window was blocked. Use Copy order instead.");
    return;
  }

  printWindow.document.write(`
    <!doctype html>
    <html>
      <head>
        <title>CAFE ELITE Order</title>
        <style>
          body { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; margin: 18px; color: #111; }
          pre { white-space: pre-wrap; font-size: 14px; line-height: 1.35; }
        </style>
      </head>
      <body><pre>${escapeHtml(orderText)}</pre></body>
    </html>
  `);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}

function renderStatusButton(orderId, currentStatus, status, label) {
  return `
    <button
      class="status-button ${currentStatus === status ? "is-active" : ""}"
      type="button"
      data-order-id="${escapeHtml(orderId)}"
      data-status="${status}"
      ${currentStatus === status ? "disabled" : ""}
    >
      ${label}
    </button>
  `;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return entities[character];
  });
}

function showMessage(message) {
  adminMessage.textContent = message;
}
