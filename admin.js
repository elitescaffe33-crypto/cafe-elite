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

  return `
    <article class="order-history-card">
      <div>
        <strong>${order.type === "paid-online" ? "Paid online" : "Pay on collection"}</strong>
        <span>${date}</span>
      </div>
      <p><b>Name:</b> ${escapeHtml(order.customerName || "Not provided")}</p>
      <p><b>Phone:</b> ${escapeHtml(order.phone || "Not provided")}</p>
      <p><b>Collection:</b> ${escapeHtml(order.collectionTime || "Not provided")}</p>
      <p><b>Status:</b> ${escapeHtml(order.status || "")}</p>
      <pre>${escapeHtml(order.items || order.message || "")}</pre>
    </article>
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
