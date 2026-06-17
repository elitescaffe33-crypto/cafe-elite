import { dayKeys, defaultSiteSettings, mergeSettings } from "./site-settings.mjs";

const passwordInput = document.querySelector("#adminPassword");
const loginButton = document.querySelector("#loginButton");
const loginPanel = document.querySelector("#loginPanel");
const dashboard = document.querySelector("#adminDashboard");
const settingsForm = document.querySelector("#settingsForm");
const hoursTable = document.querySelector("#hoursTable");
const ordersList = document.querySelector("#ordersList");
const refreshOrders = document.querySelector("#refreshOrders");
const adminMessage = document.querySelector("#adminMessage");

let adminPassword = window.localStorage.getItem("cafeEliteAdminPassword") || "";
let currentSettings = defaultSiteSettings;

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
});

refreshOrders.addEventListener("click", loadOrders);

ordersList.addEventListener("click", async (event) => {
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
    await loadOrders();
    loginPanel.hidden = true;
    dashboard.hidden = false;
    showMessage("");
  } catch (error) {
    dashboard.hidden = true;
    loginPanel.hidden = false;
    showMessage(error.message || "Login failed.");
  }
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

function renderOrder(order) {
  const date = new Date(order.createdAt).toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const paymentLabel = order.type === "paid-online" ? "Paid online" : "Pay on collection";
  const status = order.status || "new";
  const phone = order.phone || "";

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
      <div class="order-actions" aria-label="Update order status">
        ${renderStatusButton(order.id, status, "new", "New")}
        ${renderStatusButton(order.id, status, "preparing", "Preparing")}
        ${renderStatusButton(order.id, status, "completed", "Completed")}
        ${renderStatusButton(order.id, status, "cancelled", "Cancelled")}
      </div>
    </article>
  `;
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
