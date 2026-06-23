import { menuData } from "./menu-data.mjs";
import { dayKeys, defaultSiteSettings, mergeSettings } from "./site-settings.mjs";

const passwordInput = document.querySelector("#adminPassword");
const loginButton = document.querySelector("#loginButton");
const loginPanel = document.querySelector("#loginPanel");
const dashboard = document.querySelector("#adminDashboard");
const settingsForm = document.querySelector("#settingsForm");
const pricesForm = document.querySelector("#pricesForm");
const priceEditor = document.querySelector("#priceEditor");
const hoursTable = document.querySelector("#hoursTable");
const ordersList = document.querySelector("#ordersList");
const refreshOrders = document.querySelector("#refreshOrders");
const contactsList = document.querySelector("#contactsList");
const refreshContacts = document.querySelector("#refreshContacts");
const copyContacts = document.querySelector("#copyContacts");
const adminMessage = document.querySelector("#adminMessage");

let adminPassword = window.localStorage.getItem("cafeEliteAdminPassword") || "";
let currentSettings = defaultSiteSettings;
let currentContacts = [];

if (adminPassword) {
  passwordInput.value = adminPassword;
  openAdmin();
}

loginButton.addEventListener("click", () => {
  adminPassword = passwordInput.value.trim();
  window.localStorage.setItem("cafeEliteAdminPassword", adminPassword);
  openAdmin();
});

settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const settings = readSettingsFromForm();
  await adminFetch("/api/admin/settings", {
    method: "POST",
    body: JSON.stringify(settings),
  });
  currentSettings = settings;
  showMessage("Settings saved.");
  window.setTimeout(() => window.location.reload(), 450);
});

refreshOrders.addEventListener("click", loadOrders);
refreshContacts.addEventListener("click", loadContacts);

pricesForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const settings = mergeSettings(defaultSiteSettings, currentSettings);
  settings.menuPrices = readPricesFromForm();
  await adminFetch("/api/admin/settings", {
    method: "POST",
    body: JSON.stringify(settings),
  });
  currentSettings = settings;
  showMessage("Prices saved.");
});

copyContacts.addEventListener("click", async () => {
  const csv = [
    "name,email,phone,marketing_consent,order_count,latest_order",
    ...currentContacts.map((contact) =>
      [contact.name, contact.email, contact.phone, contact.marketingConsent ? "yes" : "no", contact.orderCount, contact.latestOrderAt]
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
  try {
    currentSettings = mergeSettings(defaultSiteSettings, await adminFetch("/api/admin/settings"));
    renderSettingsForm();
    renderPriceEditor();
    await loadOrders();
    await loadContacts();
    loginPanel.hidden = true;
    dashboard.hidden = false;
    showMessage("");
  } catch (error) {
    dashboard.hidden = true;
    loginPanel.hidden = false;
    showMessage(error.message || "Login failed.");
  }
}

function renderPriceEditor() {
  priceEditor.innerHTML = menuData
    .map(
      (group) => `
        <section class="price-group">
          <h3>${escapeHtml(group.category)}</h3>
          ${group.items
            .map(
              (item) => `
                <label class="price-row">
                  <span>${escapeHtml(item.name)}</span>
                  <input name="${escapeHtml(item.name)}" type="text" value="${escapeHtml(currentSettings.menuPrices?.[item.name] || item.price)}" />
                </label>
              `,
            )
            .join("")}
        </section>
      `,
    )
    .join("");
}

function readPricesFromForm() {
  const prices = {};
  menuData.forEach((group) => {
    group.items.forEach((item) => {
      const value = pricesForm.elements[item.name]?.value.trim();
      if (value && value !== item.price) prices[item.name] = value;
    });
  });
  return prices;
}

async function adminFetch(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Password": adminPassword,
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Admin request failed");
  return data;
}

function renderSettingsForm() {
  settingsForm.orderingEnabled.checked = currentSettings.ordering.enabled;
  settingsForm.collection.checked = currentSettings.services.collection;
  settingsForm.delivery.checked = currentSettings.services.delivery;
  settingsForm.payOnCollection.checked = currentSettings.payments.payOnCollection;
  settingsForm.stripe.checked = currentSettings.payments.stripe;

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
}

function readSettingsFromForm() {
  const settings = mergeSettings(defaultSiteSettings, currentSettings);
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
      <p><b>Offers consent:</b> ${contact.marketingConsent ? "Yes" : "No"}</p>
      <p><b>Orders:</b> ${escapeHtml(contact.orderCount || 0)} | <b>Latest:</b> ${escapeHtml(date)}</p>
    </article>
  `;
}

function renderOrder(order) {
  const date = new Date(order.createdAt).toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const paymentLabel = order.type === "paid-online" ? "Paid online" : "Pay on collection";
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
      <p><b>Name:</b> ${escapeHtml(order.customerName || "Not provided")}</p>
      <p><b>Phone:</b> ${
        phone
          ? `<a href="tel:${escapeHtml(phone)}">${escapeHtml(phone)}</a>`
          : "Not provided"
      }</p>
      <p><b>Collection:</b> ${escapeHtml(order.collectionTime || "Not provided")}</p>
      <p><b>Total:</b> ${escapeHtml(order.amount || "Pay at collection")}</p>
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
