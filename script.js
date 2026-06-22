import { menuData } from "./menu-data.mjs";
import { defaultSiteSettings, getOrderingStatus, mergeSettings } from "./site-settings.mjs";

// Add your cafe email here to receive order notifications.
// Example: const ORDER_NOTIFICATION_EMAIL = "hello@cafeelite.co.uk";
const ORDER_NOTIFICATION_EMAIL = "elitescaffe33@gmail.com";

const STRIPE_CHECKOUT_ENDPOINT = "/api/create-checkout-session";

const menuGrid = document.querySelector("#menuGrid");
const basketList = document.querySelector("#basketList");
const basketEmpty = document.querySelector("#basketEmpty");
const basketTotal = document.querySelector("#basketTotal");
const orderMessage = document.querySelector("#orderMessage");
const orderForm = document.querySelector("#orderForm");
const navToggle = document.querySelector(".nav-toggle");
const siteNav = document.querySelector(".site-nav");
const cartToggle = document.querySelector("#cartToggle");
const cartClose = document.querySelector("#cartClose");
const cartDrawer = document.querySelector("#cartDrawer");
const cartBackdrop = document.querySelector("#cartBackdrop");
const cartCount = document.querySelector("#cartCount");
const checkoutButton = document.querySelector("#checkoutButton");
const stripeCheckoutButton = document.querySelector("#stripeCheckoutButton");
const openBasketFromForm = document.querySelector("#openBasketFromForm");
const collectionStatus = document.querySelector("#collectionStatus");
const deliveryStatus = document.querySelector("#deliveryStatus");
const orderingStatus = document.querySelector("#orderingStatus");
const publicHoursList = document.querySelector("#publicHoursList");
const publicHoursNote = document.querySelector("#publicHoursNote");
const collectionTimeInput = orderForm.querySelector('input[name="time"]');
const basket = [];
let activeSettings = defaultSiteSettings;

function getItemLabel(item) {
  return item.price ? `${item.name} - ${item.price}` : item.name;
}

function priceToNumber(price) {
  return Number(String(price || "").replace(/[\u00a3,\s]/g, "")) || 0;
}

function getBasketTotal() {
  return basket.reduce((total, item) => total + priceToNumber(item.price), 0);
}

function goToCollectionDetails() {
  closeCart();
  document.querySelector("#order").scrollIntoView({ behavior: "smooth", block: "start" });
  const firstInvalid = orderForm.querySelector(":invalid");
  if (firstInvalid) {
    window.setTimeout(() => {
      firstInvalid.focus({ preventScroll: true });
      firstInvalid.reportValidity();
    }, 350);
  }
}

function openCart() {
  cartDrawer.classList.add("is-open");
  cartDrawer.setAttribute("aria-hidden", "false");
  cartToggle.setAttribute("aria-expanded", "true");
}

function closeCart() {
  cartDrawer.classList.remove("is-open");
  cartDrawer.setAttribute("aria-hidden", "true");
  cartToggle.setAttribute("aria-expanded", "false");
}

function renderMenu() {
  menuGrid.innerHTML = menuData
    .map(
      (group, groupIndex) => `
        <article class="menu-card menu-card--${group.category.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}">
          <h3>${group.category}</h3>
          <ul>
            ${group.items
              .map(
                (item, itemIndex) => `
                  <li>
                    <button class="menu-item-button ${item.image ? "has-image" : ""}" type="button" data-group="${groupIndex}" data-item="${itemIndex}">
                      <span class="menu-item-copy">
                        <span class="menu-item-name">${item.name}</span>
                        <span class="price ${item.price ? "" : "is-empty"}">${item.price || "Add price"}</span>
                      </span>
                      ${
                        item.image
                          ? `<img class="menu-item-photo" src="${item.image}" alt="${item.name}">`
                          : ""
                      }
                    </button>
                  </li>
                `,
              )
              .join("")}
          </ul>
        </article>
      `,
    )
    .join("");
}

function renderBasket() {
  basketList.innerHTML = basket
    .map(
      (item, index) => `
        <li>
          <span>${getItemLabel(item)}</span>
          <button class="remove-item" type="button" data-index="${index}" aria-label="Remove ${item.name}">Remove</button>
        </li>
      `,
    )
    .join("");

  cartCount.textContent = String(basket.length);
  basketTotal.textContent = `Total: \u00a3${getBasketTotal().toFixed(2)}`;
  basketEmpty.hidden = basket.length > 0;
  updateOrderingControls();
  updateMessage();
}

function updateOrderingControls() {
  const status = getOrderingStatus(new Date(), activeSettings);
  const hasItems = basket.length > 0;
  const orderingDisabled = !status.isOpen || !hasItems;

  collectionStatus.textContent = activeSettings.services.collection ? "Collection available" : "Collection unavailable";
  deliveryStatus.textContent = activeSettings.services.delivery ? "Delivery available" : "Delivery currently unavailable";
  orderingStatus.textContent = status.message;
  orderingStatus.classList.toggle("is-closed", !status.isOpen);

  checkoutButton.hidden = !activeSettings.payments.payOnCollection;
  stripeCheckoutButton.hidden = !activeSettings.payments.stripe;
  checkoutButton.disabled = orderingDisabled || !activeSettings.payments.payOnCollection;
  stripeCheckoutButton.disabled = orderingDisabled || !activeSettings.payments.stripe;

  if (collectionTimeInput && status.today) {
    collectionTimeInput.min = status.today.open;
    collectionTimeInput.max = status.today.lastOrder;
  }

  renderOpeningHours(status);
}

function renderOpeningHours(status = getOrderingStatus(new Date(), activeSettings)) {
  if (!publicHoursList) return;

  publicHoursList.innerHTML = Object.entries(activeSettings.ordering.days)
    .map(([key, day]) => {
      const isToday = status.weekday === key;
      return `
        <div class="public-hours-row ${isToday ? "is-today" : ""}">
          <strong>${day.label}</strong>
          <span>${day.open} - ${day.close}</span>
          <small>Last order ${day.lastOrder}</small>
        </div>
      `;
    })
    .join("");

  if (publicHoursNote) {
    publicHoursNote.textContent = status.isOpen
      ? `Online ordering is open now. Last order today: ${status.today.lastOrder}.`
      : status.message;
  }
}

function ensureOrderingOpen() {
  const status = getOrderingStatus(new Date(), activeSettings);
  if (status.isOpen) return true;
  document.querySelector("#order").scrollIntoView({ behavior: "smooth", block: "start" });
  orderingStatus.textContent = status.message;
  orderingStatus.classList.add("is-closed");
  window.setTimeout(() => orderingStatus.classList.remove("is-closed"), 1800);
  return false;
}

function updateMessage() {
  const formData = new FormData(orderForm);
  const name = formData.get("customerName") || "";
  const phone = formData.get("phone") || "";
  const time = formData.get("time") || "";
  const notes = formData.get("notes") || "";
  const service = activeSettings.services.delivery ? "Collection / delivery" : "Collection";
  const items = basket.length
    ? basket.map((item, index) => `${index + 1}. ${getItemLabel(item)}`).join("\n")
    : "No items selected";
  const total = getBasketTotal().toFixed(2);

  orderMessage.value = [
    "CAFE ELITE order",
    `Service: ${service}`,
    "Payment: Pay on collection",
    `Name: ${name}`,
    `Phone: ${phone}`,
    `Collection time: ${time}`,
    `Total: \u00a3${total}`,
    "Items:",
    items,
    `Notes: ${notes}`,
  ].join("\n");
}

function addItemToBasket(groupIndex, itemIndex) {
  const item = menuData[groupIndex]?.items[itemIndex];
  if (!item) return;
  basket.push(item);
  renderBasket();
}

async function sendCollectionOrder() {
  updateMessage();

  if (!basket.length) {
    alert("Please add at least one item to the basket.");
    return;
  }

  if (!ensureOrderingOpen()) return;

  if (!activeSettings.payments.payOnCollection) {
    alert("Pay on collection is currently unavailable.");
    return;
  }

  if (!orderForm.checkValidity()) {
    goToCollectionDetails();
    return;
  }

  if (window.location.protocol === "file:") {
    alert(
      "Siparis sistemi bilgisayardan direkt acilan HTML dosyasinda calismaz. Siteyi internette yayinladiktan sonra siparisler elitescaffe33@gmail.com adresine gidecek.",
    );
    return;
  }

  submitOrderForm();
  return;

  if (ORDER_NOTIFICATION_EMAIL) {
    const subject = encodeURIComponent("New CAFE ELITE collection order");
    const body = encodeURIComponent(orderMessage.value);
    window.location.href = `mailto:${ORDER_NOTIFICATION_EMAIL}?subject=${subject}&body=${body}`;
    return;
  }

  navigator.clipboard?.writeText(orderMessage.value);
  alert("Order message is ready. Add your cafe email in script.js to receive this as a notification.");
}

function payOnlineWithStripe() {
  updateMessage();

  if (!basket.length) {
    alert("Please add at least one item to the basket.");
    return;
  }

  if (!ensureOrderingOpen()) return;

  if (!activeSettings.payments.stripe) {
    alert("Online payment is currently unavailable.");
    return;
  }

  if (!orderForm.checkValidity()) {
    goToCollectionDetails();
    return;
  }

  if (window.location.protocol === "file:") {
    alert(
      "Online payment needs the site to run through the backend server. It will work after publishing or when running the local server.",
    );
    return;
  }

  stripeCheckoutButton.disabled = true;
  stripeCheckoutButton.textContent = "Opening Stripe...";

  fetch(STRIPE_CHECKOUT_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      items: basket.map((item) => item.name),
      customer: {
        name: new FormData(orderForm).get("customerName") || "",
        phone: new FormData(orderForm).get("phone") || "",
        collectionTime: new FormData(orderForm).get("time") || "",
        notes: new FormData(orderForm).get("notes") || "",
      },
      orderMessage: orderMessage.value,
    }),
  })
    .then((response) => {
      return response.json().then((data) => {
        if (!response.ok) throw new Error(data.error || "Stripe checkout failed");
        return data;
      });
    })
    .then((data) => {
      if (!data.url) throw new Error("Missing Stripe checkout URL");
      sessionStorage.setItem("cafeElitePendingOrder", orderMessage.value);
      window.location.href = data.url;
    })
    .catch((error) => {
      alert(`Stripe checkout could not be opened: ${error.message}`);
      stripeCheckoutButton.disabled = false;
      stripeCheckoutButton.textContent = "Pay online with Stripe";
    });
}

function submitOrderForm() {
  const formData = new FormData(orderForm);
  const fields = {
    _subject: "New CAFE ELITE collection order",
    _captcha: "false",
    _template: "table",
    _next: window.location.href.split("#")[0] + "#order-sent",
    service: activeSettings.services.delivery ? "Collection / delivery" : "Collection",
    payment: "Pay on collection",
    customer_name: formData.get("customerName") || "",
    phone: formData.get("phone") || "",
    collection_time: formData.get("time") || "",
    items: basket.map((item, index) => `${index + 1}. ${getItemLabel(item)}`).join("\n"),
    notes: formData.get("notes") || "",
    full_message: orderMessage.value,
  };

  checkoutButton.disabled = true;
  checkoutButton.textContent = "Sending order...";
  fetch("/api/collection-order", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(fields),
  })
    .then((response) =>
      response.json().then((data) => {
        if (!response.ok) throw new Error(data.error || "Order could not be sent");
        return data;
      }),
    )
    .then(() => {
      window.location.hash = "order-sent";
      showOrderSentMessage();
    })
    .catch((error) => {
      alert(`Order could not be sent: ${error.message}`);
      checkoutButton.disabled = false;
      checkoutButton.textContent = "Pay on collection";
    });
}

function showOrderSentMessage() {
  if (window.location.hash !== "#order-sent") return;
  alert("Order sent. Payment will be taken on collection.");
  basket.length = 0;
  renderBasket();
  closeCart();
  history.replaceState(null, "", window.location.pathname + window.location.search);
}

menuGrid.addEventListener("click", (event) => {
  const button = event.target.closest(".menu-item-button");
  if (!button) return;
  addItemToBasket(Number(button.dataset.group), Number(button.dataset.item));
});

basketList.addEventListener("click", (event) => {
  const button = event.target.closest(".remove-item");
  if (!button) return;
  basket.splice(Number(button.dataset.index), 1);
  renderBasket();
});

orderForm.addEventListener("input", updateMessage);

orderForm.addEventListener("submit", (event) => {
  event.preventDefault();
  updateMessage();
  openCart();
});

checkoutButton.addEventListener("click", sendCollectionOrder);
stripeCheckoutButton.addEventListener("click", payOnlineWithStripe);
cartToggle.addEventListener("click", openCart);
cartClose.addEventListener("click", closeCart);
cartBackdrop.addEventListener("click", closeCart);
openBasketFromForm.addEventListener("click", openCart);

navToggle.addEventListener("click", () => {
  const isOpen = siteNav.classList.toggle("is-open");
  navToggle.setAttribute("aria-expanded", String(isOpen));
});

siteNav.addEventListener("click", () => {
  siteNav.classList.remove("is-open");
  navToggle.setAttribute("aria-expanded", "false");
});

renderMenu();
loadSettings().then(() => {
  renderBasket();
  updateOrderingControls();
  window.setInterval(updateOrderingControls, 60_000);
  showOrderSentMessage();
});

async function loadSettings() {
  try {
    const response = await fetch("/api/settings");
    if (!response.ok) throw new Error("Settings unavailable");
    const settings = await response.json();
    activeSettings = mergeSettings(defaultSiteSettings, settings);
  } catch {
    activeSettings = defaultSiteSettings;
  }
}
