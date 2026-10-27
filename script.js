import { basketIdentifiers, saveBasket, restoreBasket, randomAttemptId, ATTEMPT_STORAGE_KEY } from "./basket-storage.mjs";
import { getGroupId, getItemKey, getItemOrderName, getItemDisplayName, getChoiceDisplayName, getDisplayDetails, menuData, isDrinkCustomisable, defaultDrinkMilk, MILK_CHOICES, SYRUP_MODIFIER_CHOICES, drinkSyrupSurchargePence, requiresSandwichBreadChoice, SANDWICH_BREAD_CHOICES, MUFFIN_FLAVOURS } from "./menu-data.mjs";
import { defaultSiteSettings, getOrderingStatus, mergeSettings } from "./site-settings.mjs";

import { allergenDisclosure, selectedAllergenSummary, renderPastaPromotions, supplierGlutenFreeBadge } from "./public-content.mjs";
import { onlineMenuGroups, CUPCAKE_VARIANTS } from "./menu-data.mjs";
import { visibleMenuItems } from "./smart-pasta-deals.mjs";

const STRIPE_CHECKOUT_ENDPOINT = "/api/create-checkout-session";
const CAFE_MUSIC_TRACKS = [];
const CAFE_MUSIC_VOLUME = 0.1;

import { getCafeHours, getCollectionWindow, validateCollectionTime } from "./collection-time.mjs";
import { priceBasket, basketDealRows, changeBasketQuantity } from "./basket-view.mjs";
import { ORDER_NOTES_CONSENT, NOTES_CONSENT_ERROR } from "./order-notes-consent.mjs";

const menuGrid = document.querySelector("#menuGrid");
const menuSection = document.querySelector("#menu");
const menuCategoryNav = document.querySelector("#menuCategoryNav");
const signatureGrid = document.querySelector("#signatureGrid");
const promoPriceTargets = document.querySelectorAll("[data-price-product]");
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
const mobileBasket = document.querySelector("#mobileBasket");
const mobileBasketButton = document.querySelector("#mobileBasketButton");
const basketAnnouncement = document.querySelector("#basketAnnouncement");
const continueToDetails = document.querySelector("#continueToDetails");
const collectionStep = document.querySelector("#order");
const basketStep = document.querySelector("#basketStep");
const paymentStep = document.querySelector("#paymentStep");
const checkoutFeedback = document.querySelector("#checkoutFeedback");
let cartStep = "basket";
let returnFocus = null;
let basketScrollY = 0;
let paymentPending = false;
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
const orderNotesInput = orderForm.elements.namedItem("notes");
const notesConsentInput = orderForm.elements.namedItem("notesConsent");
let consentedNotes = "", lastNotes = "";
document.querySelector("#notesConsentStatement").textContent = ORDER_NOTES_CONSENT.statement;

function syncNotesConsent(validate = false) {
  const notes = orderNotesInput.value.trim();
  if (!notes || notes !== lastNotes || (notesConsentInput.checked && consentedNotes !== notes)) {
    const wasGranted = notesConsentInput.checked;
    notesConsentInput.checked = false;
    consentedNotes = "";
    document.querySelector("#notesConsentAnnouncement").textContent = wasGranted
      ? (notes ? "Notes changed. Please give consent again for the updated notes." : "Notes removed. Consent is no longer required.")
      : notes && !lastNotes ? "Please review the separate consent choice for your optional notes." : "";
  }
  lastNotes = notes;
  const hasNotes = Boolean(notes);
  document.querySelector("#notesConsentPanel").hidden = !hasNotes;
  notesConsentInput.disabled = !hasNotes;
  notesConsentInput.required = hasNotes;
  const valid = !hasNotes || (notesConsentInput.checked && consentedNotes === notes);
  const message = !valid && (validate || notesConsentInput.getAttribute("aria-invalid") === "true") ? NOTES_CONSENT_ERROR : "";
  notesConsentInput.setCustomValidity(message);
  notesConsentInput.setAttribute("aria-invalid", String(Boolean(message)));
  document.querySelector("#error-notesConsent").textContent = message;
  document.querySelector("#error-notesConsent").hidden = !message;
  return valid;
}
notesConsentInput.addEventListener("change", () => {
  const notes = orderNotesInput.value.trim();
  if (notes !== lastNotes) { syncNotesConsent(true); return; }
  consentedNotes = notesConsentInput.checked ? notes : "";
  syncNotesConsent(true);
});
document.querySelector("#removeOrderNotes").addEventListener("click", () => {
  orderNotesInput.value = ""; syncNotesConsent(); updateMessage(); orderNotesInput.focus();
});
syncNotesConsent();
const basket = [];
let basketReady = false;
let attemptFingerprint = "";
let attemptId = "";
try {
  sessionStorage.removeItem("cafeElitePendingOrder");
  const savedAttempt = JSON.parse(sessionStorage.getItem(ATTEMPT_STORAGE_KEY) || "null");
  if (savedAttempt && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(savedAttempt.id || "") && Number.isFinite(savedAttempt.createdAt) && savedAttempt.createdAt <= Date.now() && Date.now() - savedAttempt.createdAt < 4 * 60 * 60 * 1000) attemptId = savedAttempt.id;
} catch { /* No personal details are persisted, even if storage is unavailable. */ }

function clearCheckoutAttempt() {
  attemptId = "";
  attemptFingerprint = "";
  notesConsentInput.checked = false;
  consentedNotes = "";
  syncNotesConsent();
  try { sessionStorage.removeItem(ATTEMPT_STORAGE_KEY); } catch { /* Optional storage. */ }
}

function checkoutPayload(mode) {
  const form = new FormData(orderForm);
  const payload = {
    items: basketIdentifiers(basket),
    customer: {
      name: form.get("customerName") || "", phone: form.get("phone") || "",
      email: form.get("email") || "", collectionTime: form.get("time") || "",
      notes: form.get("notes") || "",
      ...(orderNotesInput.value.trim() ? { notesConsent: notesConsentInput.checked && consentedNotes === orderNotesInput.value.trim(), notesConsentVersion: ORDER_NOTES_CONSENT.version } : {}),
    },
  };
  // Personal values are compared only in memory, never written to storage.
  const fingerprint = JSON.stringify({ mode, ...payload });
  if (!attemptId || (attemptFingerprint && fingerprint !== attemptFingerprint)) {
    attemptId = randomAttemptId();
    try { sessionStorage.setItem(ATTEMPT_STORAGE_KEY, JSON.stringify({ id: attemptId, createdAt: Date.now() })); } catch { /* Retry protection still works in this tab. */ }
  }
  attemptFingerprint = fingerprint;
  return { ...payload, attemptId };
}
let activeMenuData = onlineMenuGroups(menuData);
let activeSettings = defaultSiteSettings;
let openDealKey = "";
let activeMenuCategoryId = "pasta";

function setupGoldSparks() {
  const field = document.querySelector(".gold-spark-field");
  if (!field || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const sparkCount = window.innerWidth < 680 ? 21 : 33;
  field.innerHTML = Array.from({ length: sparkCount }, (_, index) => {
    const left = 4 + Math.random() * 92;
    const size = 4 + Math.random() * 9;
    const duration = 8 + Math.random() * 9;
    const delay = -(Math.random() * duration);
    const drift = -42 + Math.random() * 84;
    return `<span style="--spark-left:${left.toFixed(2)}%;--spark-size:${size.toFixed(2)}px;--spark-duration:${duration.toFixed(2)}s;--spark-delay:${delay.toFixed(2)}s;--spark-drift:${drift.toFixed(2)}px"></span>`;
  }).join("");
}

function setupBackgroundMusic() {
  if (!CAFE_MUSIC_TRACKS.length) return;

  const audio = new Audio();
  audio.volume = CAFE_MUSIC_VOLUME;
  audio.preload = "none";
  let started = false;

  const pickTrack = () => CAFE_MUSIC_TRACKS[Math.floor(Math.random() * CAFE_MUSIC_TRACKS.length)];
  const playNext = () => {
    audio.src = pickTrack();
    audio.play().catch(() => {
      started = false;
    });
  };

  audio.addEventListener("ended", playNext);

  const start = () => {
    if (started) return;
    started = true;
    playNext();
    window.removeEventListener("pointerdown", start);
    window.removeEventListener("keydown", start);
  };

  window.addEventListener("pointerdown", start, { once: true });
  window.addEventListener("keydown", start, { once: true });
}
function getItemLabel(item) {
  const name = getItemOrderName(item);
  const details = item.details ? ` (${getDisplayDetails(item.details)})` : "";
  return getItemPrice(item) ? `${name}${details} - £${getBasketItemPrice(item).toFixed(2)}` : `${name}${details}`;
}

function getItemPrice(item) {
  const priceKey = getItemKey(item);
  return activeSettings.menuPrices?.[priceKey] || activeSettings.menuPrices?.[item.name] || item.price || "";
}

function priceToNumber(price) {
  return Number(String(price || "").replace(/[\u00a3\u00c2,\s]/g, "")) || 0;
}

function getBasketItemPrice(item) {
  return priceToNumber(getItemPrice(item))
    + (isDrinkCustomisable(item) ? drinkSyrupSurchargePence(item.dealChoices || {}) / 100 : 0);
}

function getBasketTotal() {
  return priceBasket(basket, activeMenuData, activeSettings).total / 100;
}

function findMenuItemById(productId) {
  return activeMenuData
    .flatMap((group) => group.items)
    .find((item) => getItemKey(item) === productId || item.id === productId);
}

function renderHomepagePromoPrices() {
  promoPriceTargets.forEach((target) => {
    const item = findMenuItemById(target.dataset.priceProduct);
    if (!item) return;
    const prefix = target.dataset.pricePrefix ? `<span>${target.dataset.pricePrefix}</span> ` : "";
    const suffix = target.dataset.priceSuffix ? ` ${target.dataset.priceSuffix}` : "";
    target.innerHTML = `${prefix}${escapeHtml(getItemPrice(item))}${suffix}`;
  });
}
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function setCartStep(step, focus = true) {
  if (step === "payment" && !syncNotesConsent(true)) step = "details";
  else syncNotesConsent();
  cartStep = basket.length ? step : "basket";
  basketStep.hidden = cartStep !== "basket";
  collectionStep.hidden = cartStep !== "details";
  paymentStep.hidden = cartStep !== "payment";
  document.querySelector("#cart-title").textContent = cartStep === "basket" ? "Your basket" : "Your collection order";
  checkoutFeedback.hidden = true;
  if (cartStep === "payment") {
    const data = new FormData(orderForm);
    document.querySelector("#paymentDetails").textContent = [
      data.get("customerName"), "Today at " + data.get("time") + " (London time)",
      data.get("phone"), data.get("email"), data.get("notes"),
      "Your items and choices:", ...basket.map(item => getItemLabel(item)),
      "Please check allergies with our team before payment. Notes are not allergy approval.",
    ].filter(Boolean).join("\n");
  }
  if (focus) window.requestAnimationFrame(() => {
    cartDrawer.querySelector(".cart-drawer-body").scrollTop = 0;
    const target = cartStep === "details" ? document.querySelector("#order-title") : cartStep === "payment" ? document.querySelector("#payment-title") : cartClose;
    target.focus({ preventScroll: true });
  });
}

function goToCollectionDetails() {
  openCart({ step: "details" });
}

function openCart({ step = "basket" } = {}) {
  if (!cartDrawer.open) {
    returnFocus = document.activeElement;
    basketScrollY = window.scrollY;
    document.body.style.top = "-" + basketScrollY + "px";
    document.body.classList.add("basket-open");
    cartDrawer.showModal();
    syncLayoutMetrics();
  }
  cartToggle.setAttribute("aria-expanded", "true");
  mobileBasketButton.setAttribute("aria-expanded", "true");
  updateOrderingControls();
  setCartStep(step);
}

function closeCart() {
  cartDrawer.close();
}

cartDrawer.addEventListener("close", () => {
  document.body.classList.remove("basket-open");
  document.body.style.top = "";
  window.scrollTo({ top: basketScrollY, behavior: "instant" });
  cartToggle.setAttribute("aria-expanded", "false");
  mobileBasketButton.setAttribute("aria-expanded", "false");
  const target = returnFocus?.isConnected && returnFocus.getClientRects().length ? returnFocus : cartToggle;
  target?.focus({ preventScroll: true });
});
cartDrawer.addEventListener("click", (event) => {
  const rect = cartDrawer.getBoundingClientRect();
  if (event.target === cartDrawer && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) closeCart();
});
cartDrawer.addEventListener("keydown", (event) => {
  if (event.key !== "Tab") return;
  const controls = [...cartDrawer.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex="0"]')].filter(node => node.getClientRects().length);
  const first = controls[0], last = controls.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault(); last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault(); first?.focus();
  }
});

function syncCollectionTime() {
  const availability = getCollectionWindow(new Date(), activeSettings);
  collectionTimeInput.min = availability.min;
  collectionTimeInput.max = availability.max;
  collectionTimeInput.disabled = !availability.available;
  collectionTimeInput.setCustomValidity(validateCollectionTime(collectionTimeInput.value, new Date(), activeSettings));
  document.querySelector("#collectionTimeHint").textContent = availability.message;
  return availability;
}

function validateCollectionForm() {
  syncCollectionTime();
  const errors = [];
  for (const name of ["customerName", "phone", "email", "time"]) {
    const field = orderForm.elements.namedItem(name);
    if (name !== "time") field.setCustomValidity("");
    let message = "";
    if (name === "time") message = validateCollectionTime(field.value, new Date(), activeSettings);
    else if (field.required && !field.value.trim()) message = name === "customerName" ? "Enter your name for collection." : "Enter a phone number we can contact about your order.";
    else if (name === "email" && !field.validity.valid) message = "Enter a valid email address, or leave this optional field empty.";
    field.setCustomValidity(message);
    field.setAttribute("aria-invalid", String(Boolean(message)));
    const error = document.querySelector("#error-" + name);
    error.textContent = message;
    error.hidden = !message;
    if (message) errors.push(field);
  }
  if (!syncNotesConsent(true)) errors.push(notesConsentInput);
  if (errors.length) {
    openCart({ step: "details" });
    window.requestAnimationFrame(() => {
      const field = errors.find((entry) => !entry.disabled);
      if (field) field.focus();
    });
    return false;
  }
  return true;
}

function showCheckoutError(message) {
  checkoutFeedback.textContent = message;
  checkoutFeedback.hidden = false;
  checkoutFeedback.scrollIntoView({ block: "nearest", behavior: "auto" });
}

function syncCategoryOverflow() {
  document.querySelector("#categoriesPrevious").disabled = menuCategoryNav.scrollLeft <= 1;
  document.querySelector("#categoriesNext").disabled = menuCategoryNav.scrollLeft + menuCategoryNav.clientWidth >= menuCategoryNav.scrollWidth - 2;
}

function revealActiveTab() {
  const tab = menuCategoryNav.querySelector('[aria-selected="true"]');
  if (!tab) return;
  const rect = tab.getBoundingClientRect(), navRect = menuCategoryNav.getBoundingClientRect();
  menuCategoryNav.scrollTo({ left: menuCategoryNav.scrollLeft + rect.left - navRect.left - (navRect.width - rect.width) / 2, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  syncCategoryOverflow();
}

function syncLayoutMetrics() {
  document.documentElement.style.setProperty("--header-height", document.querySelector(".site-header").getBoundingClientRect().height + "px");
  const viewport = window.visualViewport;
  if (viewport) {
    document.documentElement.style.setProperty("--visible-height", viewport.height + "px");
    document.documentElement.style.setProperty("--visible-top", viewport.offsetTop + "px");
  }
  document.body.classList.toggle("keyboard-open", Boolean(viewport && window.innerHeight - viewport.height > 140));
  syncCategoryOverflow();
}

function renderMenuCategoryNav() {
  if (!menuCategoryNav) return;
  menuCategoryNav.setAttribute("role", "tablist");
  // Signature Picks is a standalone home-page feature, not a duplicate Full Menu tab.
  menuCategoryNav.innerHTML = activeMenuData
    .filter((group) => getGroupId(group) !== "signature-picks")
    .map((group) => {
      const groupId = getGroupId(group);
      const isActive = groupId === activeMenuCategoryId;
      return `<button class="menu-category-tab ${isActive ? "is-active" : ""}" id="menu-tab-${escapeHtml(groupId)}" type="button" role="tab" aria-selected="${isActive}" aria-controls="menu-panel" tabindex="${isActive ? "0" : "-1"}" data-menu-tab="${escapeHtml(groupId)}">${escapeHtml(group.category)}</button>`;
    })
    .join("");
  window.requestAnimationFrame(syncCategoryOverflow);
}

function getActiveMenuGroupIndex() {
  const requestedIndex = activeMenuData.findIndex((group) =>
    getGroupId(group) === activeMenuCategoryId && getGroupId(group) !== "signature-picks");
  if (requestedIndex >= 0) return requestedIndex;
  const pastaIndex = activeMenuData.findIndex((group) => getGroupId(group) === "pasta");
  return pastaIndex >= 0 ? pastaIndex : activeMenuData.findIndex((group) => getGroupId(group) !== "signature-picks");
}

function refreshCardAllergenNotice(card) {
  const notice = card.querySelector("[data-allergen-review-text]");
  if (!notice) return;
  const item = activeMenuData[Number(card.dataset.group)]?.items[Number(card.dataset.item)];
  if (!item) return;
  if (!notice.dataset.baseNotice) notice.dataset.baseNotice = notice.textContent;
  const selectedOptions = {};
  for (const select of card.querySelectorAll("[data-choice], [data-bread-choice], [data-muffin-choice], [data-drink-choice]")) {
    if (select.disabled || !select.value) continue;
    const key = select.dataset.choice || select.dataset.drinkChoice
      || (select.hasAttribute("data-bread-choice") ? "bread" : "muffinFlavour");
    selectedOptions[key] = select.value;
  }
  notice.textContent = notice.dataset.baseNotice + selectedAllergenSummary(item, selectedOptions);
}

function renderMenu() {
  const groupIndex = getActiveMenuGroupIndex();
  const group = activeMenuData[groupIndex];
  if (!group) {
    menuGrid.innerHTML = "";
    renderMenuCategoryNav();
    return;
  }

  activeMenuCategoryId = getGroupId(group);
  renderMenuCategoryNav();
  menuGrid.innerHTML = `
    <article class="menu-card menu-card--${activeMenuCategoryId}" id="menu-panel" role="tabpanel" aria-labelledby="menu-tab-${activeMenuCategoryId}">
      <div class="menu-card-heading">
        <h3>${escapeHtml(group.category)}</h3>
        ${group.description ? `<p class="menu-card-intro">${escapeHtml(group.description)}</p>` : ""}
      </div>
      ${activeMenuCategoryId === "pasta" ? renderPastaPromotions(activeMenuData, activeSettings) : ""}
      <ul>
        ${visibleMenuItems(group).filter(({ item }) => !CUPCAKE_VARIANTS.some(variant => variant.id === item.id)
            || item === group.items.find(entry => CUPCAKE_VARIANTS.some(variant => variant.id === entry.id)))
          .map(
            ({ item, itemIndex }) => `
              <li>${CUPCAKE_VARIANTS.some(variant => variant.id === item.id) ? renderCupcakes(groupIndex) : item.deal ? renderDealItem(item, groupIndex, itemIndex) : renderStandardItem(item, groupIndex, itemIndex)}</li>
            `,
          )
          .join("")}
      </ul>
    </article>
  `;

  menuGrid.querySelectorAll(".menu-product-card").forEach(refreshCardAllergenNotice);
  renderSignaturePicks();
  renderHomepagePromoPrices();
}

function selectMenuCategory(categoryId, { scroll = false, focusTab = false } = {}) {
  if (categoryId === "signature-picks" || !activeMenuData.some((group) => getGroupId(group) === categoryId)) return;
  activeMenuCategoryId = categoryId;
  openDealKey = "";
  renderMenu();
  history.replaceState(null, "", `#menu-${categoryId}`);

  if (scroll) {
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    menuSection.scrollIntoView({ behavior, block: "start" });
  }

  window.requestAnimationFrame(() => {
    const activeTab = menuCategoryNav.querySelector(`[data-menu-tab="${categoryId}"]`);
    revealActiveTab();
    if (focusTab) activeTab?.focus({ preventScroll: true });
  });
}

function renderSignaturePicks() {
  if (!signatureGrid) return;
  const signatureGroupIndex = activeMenuData.findIndex((group) => getGroupId(group) === "signature-picks");
  const signatureGroup = activeMenuData[signatureGroupIndex];
  if (!signatureGroup) {
    signatureGrid.innerHTML = "";
    return;
  }

  signatureGrid.innerHTML = signatureGroup.items
    .map((item, itemIndex) => {
      const badge = item.badge || "Signature";
      return `
        <article class="signature-card ${item.image ? "has-image" : "no-image"}">
          ${item.image ? `<div class="signature-photo-frame"><img class="signature-photo" src="${escapeHtml(item.image)}" alt="${escapeHtml(getItemDisplayName(item))}" loading="lazy" decoding="async"></div>` : ""}
          <div class="signature-card-body">
            <span class="signature-badge">${escapeHtml(badge)}</span>
            <h3>${escapeHtml(getItemDisplayName(item))}</h3>
            ${item.description ? `<p>${escapeHtml(item.description)}</p>` : ""}
            <div class="signature-card-foot">
              <strong>${escapeHtml(getItemPrice(item))}</strong>
              ${
                item.deal
                  ? `<button class="button outline signature-jump" type="button" data-target-group="${signatureGroupIndex}" data-target-item="${itemIndex}">Choose</button>`
                  : `<button class="button primary signature-add" type="button" data-group="${signatureGroupIndex}" data-item="${itemIndex}" ${item.orderable === false ? "disabled" : ""}>${item.orderable === false ? "Sold out" : "Add"}</button>`
              }
            </div>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderDrinkOptionFields(item, coffee = null) {
  if (!isDrinkCustomisable(item)) return "";
  const milkDefault = defaultDrinkMilk(item, coffee ? { coffee } : {});
  const milkOptions = MILK_CHOICES.map(value =>
    `<option value="${escapeHtml(value)}" ${value === milkDefault ? "selected" : ""}>${escapeHtml(value)}</option>`).join("");
  const syrupOptions = SYRUP_MODIFIER_CHOICES.map(value =>
    `<option value="${escapeHtml(value)}">${escapeHtml(value === "No syrup" ? value : value + " (+£0.50)")}</option>`).join("");
  return `<div class="drink-option-fields" aria-label="Drink options">
    <label>Milk <select data-drink-choice="milk">${milkOptions}</select></label>
    <label>Optional syrup <select data-drink-choice="syrup">${syrupOptions}</select></label>
    <small>Milk choice: no extra charge. Syrup: +£0.50 per drink. Allergens depend on your selections; <a href="allergens.html">check with our team before ordering</a>.</small>
  </div>`;
}

function renderSandwichBreadFields() {
  return `<div class="sandwich-bread-fields">
    <label>Choose sandwich bread
      <select data-bread-choice required aria-label="Choose White or Brown sandwich bread">
        <option value="" selected disabled>Choose White or Brown</option>
        ${SANDWICH_BREAD_CHOICES.map(value => `<option value="${value}">${value} bread</option>`).join("")}
      </select>
    </label>
    <small>White and Brown breads have different ingredient and allergen declarations. Please check with our team before ordering.</small>
  </div>`;
}

function renderMuffinFields(isHidden = false) {
  return `<div class="muffin-choice-fields" ${isHidden ? "hidden" : ""}>
    <label>Choose muffin flavour
      <select data-muffin-choice required aria-label="Choose muffin flavour" ${isHidden ? "disabled" : ""}>
        <option value="" selected disabled>Choose a muffin flavour</option>
        ${MUFFIN_FLAVOURS.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("")}
      </select>
    </label>
    <small>Ingredients and allergy warnings vary by flavour. Please check with our team before ordering.</small>
  </div>`;
}

function renderCupcakes(groupIndex) {
  const group = activeMenuData[groupIndex];
  const variants = CUPCAKE_VARIANTS.map(variant => ({ ...variant, item: group.items.find(item => item.id === variant.id && item.orderable !== false) }));
  return `<article class="menu-product-card cupcake-card" data-group="${groupIndex}" data-product-id="cupcake-selection">
    <img class="cupcake-assortment-image" src="assets/cafe-elite-cupcakes.jpg" alt="Four assorted cupcakes at CAFE ELITE" loading="lazy" width="1280" height="853">
    <div class="menu-product-body">
      <h4 class="menu-item-name">Cupcakes</h4>
      <label class="cupcake-choice-label">Choose your cupcake
        <select data-cupcake-choice required aria-describedby="cupcake-allergy-hint">
          <option value="" selected disabled>Choose a flavour</option>
          ${variants.map(({ id, name, item }) => `<option value="${id}" ${item ? "" : "disabled"}>${escapeHtml(item ? getItemDisplayName(item) : name)} ${item ? "— " + escapeHtml(getItemPrice(item)) : "— Currently unavailable"}</option>`).join("")}
        </select>
      </label>
      <p id="cupcake-allergy-hint" class="cupcake-allergy-hint">Ingredients and allergens vary by flavour. Check your selection before ordering.</p>
      <div data-cupcake-allergens aria-live="polite"></div>
      <div class="menu-product-footer"><span class="price" data-cupcake-price></span><button type="button" class="button primary cupcake-add" disabled>Add</button></div>
    </div>
  </article>`;
}

function selectedCupcake(card) {
  const id = card?.querySelector("[data-cupcake-choice]")?.value;
  if (!CUPCAKE_VARIANTS.some(variant => variant.id === id)) return null;
  const groupIndex = Number(card.dataset.group);
  const itemIndex = activeMenuData[groupIndex]?.items.findIndex(item => item.id === id);
  const item = activeMenuData[groupIndex]?.items[itemIndex];
  return item && item.orderable !== false && priceToNumber(getItemPrice(item)) > 0 ? { groupIndex, itemIndex, item } : null;
}

function renderStandardItem(item, groupIndex, itemIndex) {
  const price = getItemPrice(item);
  const hasDrinkOptions = isDrinkCustomisable(item);
  const hasSandwichBreadChoice = requiresSandwichBreadChoice(item);
  const isMuffin = item.id === "snack-muffins";
  return `
    <article class="menu-product-card ${item.image ? "has-image" : ""}" data-group="${groupIndex}" data-item="${itemIndex}" data-product-id="${item.id || getItemKey(item)}">
      ${item.image ? `<img class="menu-product-image" src="${item.image}" alt="${escapeHtml(getItemDisplayName(item))}" loading="lazy">` : ""}
      <div class="menu-product-body">
        <div class="menu-item-head">
          ${item.badge ? `<span class="item-badge">${item.badge}</span>` : ""}
          <h4 class="menu-item-name">${escapeHtml(getItemDisplayName(item))}</h4>
        </div>
        ${item.description ? `<p class="menu-item-description">${escapeHtml(item.description)}</p>` : ""}
        ${item.secondaryDescription ? `<p class="menu-item-description menu-item-description--secondary">${escapeHtml(item.secondaryDescription)}</p>` : ""}
        ${allergenDisclosure(item)}
        ${hasSandwichBreadChoice ? renderSandwichBreadFields() : ""}
        ${isMuffin ? renderMuffinFields() : ""}
        ${hasDrinkOptions ? `<details class="drink-customisation">
          <summary><span>Milk &amp; syrup options</span><small class="drink-customisation-current" data-drink-current>${escapeHtml(defaultDrinkMilk(item))} · No syrup (add +£0.50)</small></summary>
          ${renderDrinkOptionFields(item)}
        </details>` : ""}
        <div class="menu-product-footer">
          <span class="price ${price ? "" : "is-empty"}">${escapeHtml(price || "Currently unavailable")}</span>
          <button class="button primary ${hasDrinkOptions ? "drink-add" : hasSandwichBreadChoice ? "sandwich-add" : isMuffin ? "muffin-add" : "menu-add"}" type="button" data-group="${groupIndex}" data-item="${itemIndex}" ${priceToNumber(price) > 0 && item.orderable !== false ? "" : "disabled"}>${item.orderable === false ? "Sold out" : hasDrinkOptions ? "Add drink" : "Add"}</button>
        </div>
        ${supplierGlutenFreeBadge(item)}
      </div>
    </article>
  `;
}

function renderDealItem(item, groupIndex, itemIndex) {
  const options = (values) => values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(getChoiceDisplayName(value))}</option>`).join("");
  const dealEntries = Object.entries(item.deal);
  const hasChoices = dealEntries.length > 0;
  const inMealDeals = getGroupId(activeMenuData[groupIndex]) === "meal-deals";
  const includedLabels = { baguette: "Baguette", coffee: "Coffee", sandwich: "Sandwich", snack: "Snack" };
  const included = inMealDeals ? dealEntries.map(([key]) => includedLabels[key]).filter(Boolean) : [];
  const key = `${groupIndex}-${itemIndex}`;
  const panelId = `deal-panel-${groupIndex}-${itemIndex}`;
  const isOpen = openDealKey === key;
  return `
    <article class="deal-builder menu-product-card menu-product-card--deal ${item.image ? "has-image" : ""} ${isOpen ? "is-open" : ""}" data-group="${groupIndex}" data-item="${itemIndex}" data-product-id="${item.id || getItemKey(item)}">
      ${item.image ? `<img class="menu-product-image deal-artwork" src="${item.image}" alt="${escapeHtml(getItemDisplayName(item))}" loading="lazy">` : ""}
      <div class="menu-product-body">
        <div class="menu-item-head">
          ${item.badge ? `<span class="item-badge">${item.badge}</span>` : ""}
          <h4 class="menu-item-name">${escapeHtml(getItemDisplayName(item))}</h4>
        </div>
        ${item.description ? `<p class="menu-item-description">${escapeHtml(item.description)}</p>` : ""}
        ${included.length ? `<div class="meal-deal-includes" aria-label="Items included in this meal deal">
          <span class="meal-deal-includes-label">This deal includes</span>
          <div class="meal-deal-chips">${included.map(label => `<span>${escapeHtml(label)}</span>`).join("")}</div>
          <small>Choose the exact items, milk and optional syrup below.</small>
        </div>` : ""}
        ${allergenDisclosure(item)}
        <div class="menu-product-footer">
          <span class="price">${escapeHtml(getItemPrice(item))}</span>
          <button class="button outline deal-toggle" type="button" ${item.orderable === false ? "disabled" : ""} aria-expanded="${hasChoices && isOpen ? "true" : "false"}" ${hasChoices ? `aria-controls="${panelId}"` : ""}>
            ${hasChoices ? (isOpen ? "Close" : "Choose") : "Add"}
          </button>
        </div>
        ${
          hasChoices
            ? `<div class="deal-panel" id="${panelId}">
                <div class="deal-fields">
                  ${dealEntries
                    .map(([label, values]) => `<label>${label.replace(/^\w/, (letter) => letter.toUpperCase())} <select data-choice="${label}">${options(values)}</select></label>`)
                    .join("")}
                  ${(item.deal?.sandwich?.includes("Classic Ham & Cheese") || item.deal?.baguette?.includes("Classic Ham & Cheese"))
                    ? '<small class="meal-deal-ham-note">Classic Ham &amp; Cheese option: made with sliced chicken breast instead of pork ham.</small>'
                    : ""}
                  ${requiresSandwichBreadChoice(item) ? renderSandwichBreadFields() : ""}
                  ${Array.isArray(item.deal?.snack) && item.deal.snack.includes("Muffins") ? renderMuffinFields(item.deal.snack[0] !== "Muffins") : ""}
                  ${isDrinkCustomisable(item) ? renderDrinkOptionFields(item, item.deal.coffee?.[0]) : ""}
                </div>
                <button class="button primary deal-add" type="button" ${item.orderable === false ? "disabled" : ""}>${item.orderable === false ? "Sold out" : "Add deal"}</button>
              </div>`
            : ""
        }
      </div>
    </article>
  `;
}

function playBasketChime() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;

  const context = playBasketChime.context || new AudioContext();
  playBasketChime.context = context;
  if (context.state === "suspended") context.resume();

  const now = context.currentTime;
  const filter = context.createBiquadFilter();
  const master = context.createGain();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(1050, now);
  filter.Q.setValueAtTime(0.72, now);
  master.gain.setValueAtTime(0.0001, now);
  master.gain.exponentialRampToValueAtTime(0.065, now + 0.026);
  master.gain.exponentialRampToValueAtTime(0.0001, now + 0.58);
  filter.connect(master).connect(context.destination);

  [
    { frequency: 196, start: 0, level: 0.58, length: 0.38 },
    { frequency: 247, start: 0.038, level: 0.34, length: 0.4 },
    { frequency: 330, start: 0.078, level: 0.2, length: 0.34 },
  ].forEach(({ frequency, start, level, length }) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(frequency, now + start);
    oscillator.frequency.exponentialRampToValueAtTime(frequency * 0.985, now + start + length);
    gain.gain.setValueAtTime(0.0001, now + start);
    gain.gain.exponentialRampToValueAtTime(level, now + start + 0.024);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + start + length);
    oscillator.connect(gain).connect(filter);
    oscillator.start(now + start);
    oscillator.stop(now + start + length + 0.05);
  });
}
function burstBasketCount() {
  if (!cartCount || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const rect = cartCount.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const particleCount = 48;

  cartCount.classList.remove("is-bursting");
  void cartCount.offsetWidth;
  cartCount.classList.add("is-bursting");
  window.setTimeout(() => cartCount.classList.remove("is-bursting"), 420);

  Array.from({ length: particleCount }, (_, index) => {
    const angle = (Math.PI * 2 * index) / particleCount + Math.random() * 0.35;
    const distance = 42 + Math.random() * 96;
    const particle = document.createElement("span");
    particle.className = "basket-burst-particle";
    particle.style.setProperty("--burst-left", `${centerX}px`);
    particle.style.setProperty("--burst-top", `${centerY}px`);
    particle.style.setProperty("--burst-x", `${Math.cos(angle) * distance}px`);
    particle.style.setProperty("--burst-y", `${Math.sin(angle) * distance}px`);
    particle.style.setProperty("--burst-size", `${5 + Math.random() * 8}px`);
    document.body.append(particle);
    particle.addEventListener("animationend", () => particle.remove(), { once: true });
    return particle;
  });
}
function renderBasket() {
  if (basketReady) {
    try { saveBasket(localStorage, basket); } catch { /* Browser storage may be disabled. */ }
    if (!basket.length) clearCheckoutAttempt();
  }
  const pricing = priceBasket(basket, activeMenuData, activeSettings);
  const money = value => "\u00a3" + (value / 100).toFixed(2);
  const renderRow = ({ item, indices }, component = false) => {
    const label = item.name;
    const scope = `data-indices="${indices.join(",")}"`;
    const price = component ? "" : `<span>${money(item.lineTotal)}</span>`;
    return `<li><div class="basket-item-copy"><strong>${escapeHtml(label)}</strong>${item.details ? '<small>' + escapeHtml(getDisplayDetails(item.details)) + '</small>' : ''}${isDrinkCustomisable(basket[indices[0]]) ? '<small>Drink allergens and cross-contact depend on the milk and syrup selected. <a href="allergens.html">Ask us before paying.</a></small>' : ''}${price}</div>
      <div class="basket-quantity"><button type="button" data-basket-action="decrease" data-index="${indices[0]}" ${scope} aria-label="Decrease quantity of ${escapeHtml(label)}">&minus;</button><span aria-label="Quantity">${indices.length}</span><button type="button" data-basket-action="increase" data-index="${indices[0]}" ${scope} aria-label="Increase quantity of ${escapeHtml(label)}">+</button></div>
      <button class="remove-item" type="button" data-basket-action="remove" data-index="${indices[0]}" ${scope} aria-label="Remove ${escapeHtml(label)} from this group">Remove</button></li>`;
  };
  basketList.innerHTML = basketDealRows(basket, pricing, activeMenuData, activeSettings).map(row => row.components
    ? `<li class="basket-pasta-deal"><h3>${escapeHtml(row.item.name)}</h3><ul>${row.components.map(component => renderRow(component, true)).join("")}</ul><dl class="pasta-deal-totals"><div><dt>Normal</dt><dd><s>${money(row.item.normalTotal)}</s></dd></div><div><dt>Deal price</dt><dd>${money(row.item.lineTotal)}</dd></div></dl><p class="pasta-saving">You save ${money(row.item.savings)}</p></li>`
    : renderRow(row)).join("");
  const totalText = money(pricing.total);
  cartCount.textContent = String(basket.length);
  cartToggle.setAttribute("aria-label", "Open basket, " + basket.length + " items, " + totalText);
  basketTotal.textContent = "Total: " + totalText;
  document.querySelector("#paymentTotal").textContent = "Total: " + totalText;
  mobileBasketButton.textContent = "View basket \u00b7 " + basket.length + (basket.length === 1 ? " item" : " items") + " \u00b7 " + totalText;
  basketAnnouncement.textContent = basket.length + (basket.length === 1 ? " item" : " items") + " in basket. Total " + totalText;
  mobileBasket.hidden = basket.length === 0;
  document.body.classList.toggle("has-basket", basket.length > 0);
  basketEmpty.hidden = basket.length > 0;
  if (!basket.length && cartStep !== "basket") setCartStep("basket");
  updateOrderingControls();
  updateMessage();
}

function updateOrderingControls() {
  const status = getOrderingStatus(new Date(), activeSettings);
  const availability = syncCollectionTime();
  const orderingDisabled = !status.isOpen || !availability.available || !basket.length || paymentPending;
  collectionStatus.textContent = activeSettings.services.collection ? "Collection available" : "Collection unavailable";
  deliveryStatus.textContent = activeSettings.services.delivery ? "Delivery available" : "";
  deliveryStatus.hidden = !activeSettings.services.delivery;
  orderingStatus.textContent = status.message;
  orderingStatus.classList.toggle("is-closed", !status.isOpen);
  document.querySelector("#cartOrderingStatus").textContent = status.isOpen && availability.available ? status.message : availability.message + " You can still browse and build your basket.";
  continueToDetails.disabled = !basket.length || paymentPending;
  checkoutButton.hidden = !activeSettings.payments.payOnCollection;
  stripeCheckoutButton.hidden = !activeSettings.payments.stripe;
  document.querySelector("#collectionPaymentHelp").hidden = checkoutButton.hidden;
  document.querySelector("#stripePaymentHelp").hidden = stripeCheckoutButton.hidden;
  checkoutButton.disabled = orderingDisabled || !activeSettings.payments.payOnCollection;
  stripeCheckoutButton.disabled = orderingDisabled || !activeSettings.payments.stripe;
  if (!activeSettings.payments.payOnCollection && !activeSettings.payments.stripe) document.querySelector("#cartOrderingStatus").textContent = "Payment options are currently unavailable. You can still browse the menu.";
  renderOpeningHours(status);
}

function renderOpeningHours(status = getOrderingStatus(new Date(), activeSettings)) {
  const hours = getCafeHours(new Date(), activeSettings);
  document.querySelector("#todayHours").textContent = hours.label;
  document.querySelector("#heroTodayHours").textContent = hours.label;
  document.querySelector("#todayOrderHours").textContent = (hours.today ? (hours.isOpen ? "Cafe open now. " : "Cafe closed now. ") : "") + status.message + " View weekly hours.";
  publicHoursList.innerHTML = Object.entries(activeSettings.ordering.days).map(([key, day]) => `<div class="public-hours-row ${hours.weekday === key ? "is-today" : ""}"><strong>${escapeHtml(day.label)}${hours.weekday === key ? " (today)" : ""}</strong><span>${escapeHtml(day.open)} - ${escapeHtml(day.close)}</span><small>Online orders until ${escapeHtml(day.lastOrder)}</small></div>`).join("");
  publicHoursNote.textContent = status.message + " All times are London local time.";
}

function ensureOrderingOpen() {
  const availability = getCollectionWindow(new Date(), activeSettings);
  if (availability.available) return true;
  updateOrderingControls();
  showCheckoutError(availability.message);
  return false;
}

function updateMessage() {
  const formData = new FormData(orderForm);
  const name = formData.get("customerName") || "";
  const phone = formData.get("phone") || "";
  const email = formData.get("email") || "";
  const time = formData.get("time") || "";
  const notes = formData.get("notes") || "";
  const service = activeSettings.services.delivery ? "Collection / delivery" : "Collection";
  const items = basket.length
    ? priceBasket(basket, activeMenuData, activeSettings).checkoutItems.map(item => `${item.quantity} x ${item.displayName} - \u00a3${(item.lineTotal / 100).toFixed(2)}`).join("\n")
    : "No items selected";
  const total = getBasketTotal().toFixed(2);

  orderMessage.value = [
    "CAFE ELITE order",
    `Service: ${service}`,
    "Payment: Pay on collection",
    `Name: ${name}`,
    `Phone: ${phone}`,
    `Email: ${email}`,
    `Collection time: ${time}`,
    `Total: \u00a3${total}`,
    "Items:",
    items,
    `Notes: ${notes}`,
  ].join("\n");
}

function basketDrinkOptions(item, provided = {}) {
  if (!isDrinkCustomisable(item)) return {};
  return {
    milk: MILK_CHOICES.includes(provided.milk) ? provided.milk : defaultDrinkMilk(item, provided),
    syrup: SYRUP_MODIFIER_CHOICES.includes(provided.syrup) ? provided.syrup : "No syrup",
  };
}

function drinkSelectionDetails(options) {
  return [options.milk, ...(options.syrup !== "No syrup" ? [options.syrup + " syrup"] : [])].join(" + ");
}

function addItemToBasket(groupIndex, itemIndex, drinkChoices = {}, breadChoice = "", muffinFlavour = "") {
  const item = activeMenuData[groupIndex]?.items[itemIndex];
  if (!item || item.orderable === false || priceToNumber(getItemPrice(item)) <= 0) return false;
  const needsBread = requiresSandwichBreadChoice(item);
  if (needsBread && !SANDWICH_BREAD_CHOICES.includes(breadChoice)) return false;
  const needsMuffin = item.id === "snack-muffins";
  if (needsMuffin && !MUFFIN_FLAVOURS.includes(muffinFlavour)) return false;
  const drink = isDrinkCustomisable(item) ? basketDrinkOptions(item, drinkChoices) : {};
  const selectedOptions = { ...drink, ...(needsBread ? { bread: breadChoice } : {}), ...(needsMuffin ? { muffinFlavour } : {}) };
  const details = [
    ...(needsBread ? [breadChoice + " bread"] : []),
    ...(needsMuffin ? [muffinFlavour + " muffin"] : []),
    ...(isDrinkCustomisable(item) ? [drinkSelectionDetails(drink)] : []),
  ].filter(Boolean).join(" + ");
  basket.push(Object.keys(selectedOptions).length
    ? { ...item, dealChoices: selectedOptions, details }
    : item);
  try { priceBasket(basket, activeMenuData, activeSettings); }
  catch (error) { basket.pop(); openCart(); showCheckoutError(error.message); return false; }
  renderBasket();
  playBasketChime();
  burstBasketCount();
  return true;
}

function addDealToBasket(builder) {
  const groupIndex = Number(builder.dataset.group);
  const itemIndex = Number(builder.dataset.item);
  const item = activeMenuData[groupIndex]?.items[itemIndex];
  if (!item?.deal || item.orderable === false || priceToNumber(getItemPrice(item)) <= 0) return;

  const choices = Object.fromEntries(
    [...builder.querySelectorAll("[data-choice]")].map((select) => [select.dataset.choice, select.value]),
  );
  if (requiresSandwichBreadChoice(item)) {
    const breadSelect = builder.querySelector("[data-bread-choice]");
    if (!breadSelect || !SANDWICH_BREAD_CHOICES.includes(breadSelect.value)) {
      breadSelect?.reportValidity?.();
      breadSelect?.focus?.();
      return false;
    }
    choices.bread = breadSelect.value;
  }
  if (Array.isArray(item.deal?.snack) && choices.snack === "Muffins") {
    const select = builder.querySelector("[data-muffin-choice]");
    if (!select || !MUFFIN_FLAVOURS.includes(select.value)) {
      select?.reportValidity?.();
      select?.focus?.();
      return false;
    }
    choices.muffinFlavour = select.value;
  }
  const baseDetails = item.fixedDetails || [
    ...Object.entries(choices).filter(([key]) => !["bread", "muffinFlavour"].includes(key)).map(([, value]) => value),
    ...(choices.bread ? [choices.bread + " bread"] : []),
    ...(choices.muffinFlavour ? [choices.muffinFlavour + " muffin"] : []),
  ].join(" + ");
  if (isDrinkCustomisable(item)) {
    const userDrinkOptions = Object.fromEntries(
      [...builder.querySelectorAll("[data-drink-choice]")]
        .filter(select => select.dataset.drinkChoice)
        .map(select => [select.dataset.drinkChoice, select.value]),
    );
    Object.assign(choices, basketDrinkOptions(item, { ...choices, ...userDrinkOptions }));
  }
  basket.push({
    ...item,
    details: isDrinkCustomisable(item) ? [baseDetails, drinkSelectionDetails(choices)].filter(Boolean).join(" + ") : baseDetails,
    dealChoices: choices,
  });
  try { priceBasket(basket, activeMenuData, activeSettings); }
  catch (error) { basket.pop(); showCheckoutError(error.message); return false; }
  renderBasket();
  playBasketChime();
  burstBasketCount();
  openCart();
}

async function sendCollectionOrder() {
  if (paymentPending) return;
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

  if (!validateCollectionForm()) return;

  if (window.location.protocol === "file:") {
    alert(
      "Ordering is unavailable when this page is opened as a local file. Please use the website.",
    );
    return;
  }

  submitOrderForm();
}

function payOnlineWithStripe() {
  if (paymentPending) return;
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

  if (!validateCollectionForm()) return;

  if (window.location.protocol === "file:") {
    alert(
      "Online payment is unavailable here. Please open the CAFE ELITE website to order.",
    );
    return;
  }

  paymentPending = true;
  updateOrderingControls();
  stripeCheckoutButton.disabled = true;
  stripeCheckoutButton.textContent = "Opening secure payment...";

  fetch(STRIPE_CHECKOUT_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(checkoutPayload("online")),
  })
    .then((response) => {
      return response.json().then((data) => {
        if (!response.ok) throw new Error(data.error || "Stripe checkout failed");
        return data;
      });
    })
    .then((data) => {
      if (!data.url) throw new Error("Missing Stripe checkout URL");
      if (!Number.isSafeInteger(data.total) || data.currency !== "gbp" || data.total !== priceBasket(basket, activeMenuData, activeSettings).total) {
        throw new Error("The saved checkout amount differs from this basket. Please contact the cafe before paying again; your existing payment attempt has been preserved.");
      }
      window.location.href = data.url;
    })
    .catch((error) => {
      showCheckoutError(`Secure payment could not be opened: ${error.message}`);
    })
    .finally(() => {
      paymentPending = false;
      stripeCheckoutButton.textContent = "Pay securely online";
      updateOrderingControls();
    });
}

function submitOrderForm() {
  const fields = checkoutPayload("collection");

  paymentPending = true;
  updateOrderingControls();
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
    .then((data) => {
      showOrderSentMessage(data, data.collectionTime || fields.customer.collectionTime);
    })
    .catch((error) => {
      showCheckoutError(`Order could not be sent: ${error.message}`);
    })
    .finally(() => {
      paymentPending = false;
      checkoutButton.textContent = "Pay on collection";
      updateOrderingControls();
    });
}

function showOrderSentMessage(result, collectionTime) {
  if (!result?.ok || !result.orderId) return;
  const closing = getCafeHours(new Date(), activeSettings).today?.close;
  const late = closing && collectionTime > closing
    ? " This collection time is shortly after normal closing; the cafe will contact you if it needs adjustment." : "";
  document.querySelector("#confirmationDetails").textContent = `Today at ${collectionTime} (London time). Reference: ${result.orderId}. Payment due on collection.${late}`;
  const confirmation = document.querySelector("#orderConfirmation");
  confirmation.hidden = false;
  basket.length = 0;
  renderBasket();
  closeCart();
  confirmation.scrollIntoView({ block: "start", behavior: "auto" });
  confirmation.focus({ preventScroll: true });
  history.replaceState(null, "", window.location.pathname + window.location.search);
}

menuGrid.addEventListener("click", (event) => {
  const dealToggle = event.target.closest(".deal-toggle");
  if (dealToggle) {
    const builder = dealToggle.closest(".deal-builder");
    const item = activeMenuData[Number(builder.dataset.group)]?.items[Number(builder.dataset.item)];
    if (item?.deal && Object.keys(item.deal).length === 0) {
      addDealToBasket(builder);
      return;
    }
    const key = `${builder.dataset.group}-${builder.dataset.item}`;
    openDealKey = openDealKey === key ? "" : key;
    renderMenu();
    menuGrid.querySelector(`[data-group="${builder.dataset.group}"][data-item="${builder.dataset.item}"] .deal-toggle`)?.focus({ preventScroll: true });
    return;
  }

  const dealButton = event.target.closest(".deal-add");
  if (dealButton) {
    addDealToBasket(dealButton.closest(".deal-builder"));
    return;
  }

  const drinkButton = event.target.closest(".drink-add");
  if (drinkButton) {
    const card = drinkButton.closest(".menu-product-card");
    const selected = Object.fromEntries(
      [...card.querySelectorAll("[data-drink-choice]")].map(select => [select.dataset.drinkChoice, select.value]),
    );
    addItemToBasket(Number(drinkButton.dataset.group), Number(drinkButton.dataset.item), selected);
    return;
  }

  const sandwichButton = event.target.closest(".sandwich-add");
  if (sandwichButton) {
    const card = sandwichButton.closest(".menu-product-card");
    const breadSelect = card?.querySelector("[data-bread-choice]");
    if (!breadSelect || !SANDWICH_BREAD_CHOICES.includes(breadSelect.value)) {
      breadSelect?.reportValidity?.();
      breadSelect?.focus?.();
      return;
    }
    addItemToBasket(Number(sandwichButton.dataset.group), Number(sandwichButton.dataset.item), {}, breadSelect.value);
    return;
  }

  const cupcakeButton = event.target.closest(".cupcake-add");
  if (cupcakeButton) {
    const card = cupcakeButton.closest(".cupcake-card");
    const selected = selectedCupcake(card);
    if (selected) addItemToBasket(selected.groupIndex, selected.itemIndex);
    else card?.querySelector("[data-cupcake-choice]")?.reportValidity();
    return;
  }
  const muffinButton = event.target.closest(".muffin-add");
  if (muffinButton) {
    const card = muffinButton.closest(".menu-product-card");
    const flavourSelect = card?.querySelector("[data-muffin-choice]");
    if (!flavourSelect || !MUFFIN_FLAVOURS.includes(flavourSelect.value)) {
      flavourSelect?.reportValidity?.();
      flavourSelect?.focus?.();
      return;
    }
    addItemToBasket(Number(muffinButton.dataset.group), Number(muffinButton.dataset.item), {}, "", flavourSelect.value);
    return;
  }
  const button = event.target.closest(".menu-add");
  if (!button) return;
  addItemToBasket(Number(button.dataset.group), Number(button.dataset.item));
});

menuGrid.addEventListener("change", event => {
  if (!event.target?.matches?.("[data-cupcake-choice]")) return;
  const card = event.target.closest(".cupcake-card");
  const selected = selectedCupcake(card);
  card.querySelector(".cupcake-add").disabled = !selected;
  card.querySelector("[data-cupcake-price]").textContent = selected ? getItemPrice(selected.item) : "";
  card.querySelector("[data-cupcake-allergens]").innerHTML = selected ? allergenDisclosure(selected.item) : "";
});

// Muffins in a sandwich meal deal need their own variant-specific selection.
menuGrid.addEventListener("change", event => {
  const select = event.target;
  if (!select?.matches?.('[data-choice="snack"]')) return;
  const card = select.closest(".menu-product-card");
  const fields = card?.querySelector(".muffin-choice-fields");
  if (!fields) return;
  const needsChoice = select.value === "Muffins";
  fields.hidden = !needsChoice;
  const flavour = fields.querySelector("[data-muffin-choice]");
  if (flavour) {
    flavour.disabled = !needsChoice;
    if (!needsChoice) flavour.value = "";
  }
});

// Keep the displayed price in sync with the server-calculated +£0.50 syrup option.
menuGrid.addEventListener("change", event => {
  const select = event.target;
  if (!select?.matches?.('[data-drink-choice], [data-choice="coffee"]')) return;
  const card = select.closest(".menu-product-card");
  if (!card) return;
  const item = activeMenuData[Number(card.dataset.group)]?.items[Number(card.dataset.item)];
  if (!isDrinkCustomisable(item)) return;
  if (select.dataset.choice === "coffee") {
    const milk = card.querySelector('[data-drink-choice="milk"]');
    if (milk) milk.value = defaultDrinkMilk(item, { coffee: select.value });
  }
  const syrup = card.querySelector('[data-drink-choice="syrup"]')?.value || "No syrup";
  const displayPrice = card.querySelector(".menu-product-footer .price");
  if (displayPrice) displayPrice.textContent = "£" + (
    priceToNumber(getItemPrice(item)) + drinkSyrupSurchargePence({ syrup }) / 100
  ).toFixed(2);
  const choiceLabel = card.querySelector("[data-drink-current]");
  if (choiceLabel) {
    const milk = card.querySelector('[data-drink-choice="milk"]')?.value || defaultDrinkMilk(item);
    choiceLabel.textContent = milk + (syrup === "No syrup" ? " · No syrup" : " · " + syrup + " syrup (+£0.50)");
  }
});

// Update only the clearly marked PARTIAL supplier evidence; never assert allergy safety.
menuGrid.addEventListener("change", event => {
  if (!event.target?.matches?.('[data-choice], [data-bread-choice], [data-muffin-choice], [data-drink-choice]')) return;
  const card = event.target.closest(".menu-product-card");
  if (card) refreshCardAllergenNotice(card);
});

signatureGrid?.addEventListener("click", (event) => {
  const addButton = event.target.closest(".signature-add");
  if (addButton) {
    addItemToBasket(Number(addButton.dataset.group), Number(addButton.dataset.item));
    return;
  }

  const jumpButton = event.target.closest(".signature-jump");
  if (!jumpButton) return;
  const targetGroup = activeMenuData[Number(jumpButton.dataset.targetGroup)];
  if (!targetGroup) return;
  activeMenuCategoryId = getGroupId(targetGroup);
  openDealKey = `${jumpButton.dataset.targetGroup}-${jumpButton.dataset.targetItem}`;
  renderMenu();
  menuSection.scrollIntoView({ behavior: "smooth", block: "start" });
});

menuCategoryNav.addEventListener("click", (event) => {
  const tab = event.target.closest("[data-menu-tab]");
  if (!tab) return;
  selectMenuCategory(tab.dataset.menuTab, { focusTab: true });
});

menuCategoryNav.addEventListener("keydown", (event) => {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const tabs = [...menuCategoryNav.querySelectorAll("[data-menu-tab]")];
  const currentIndex = tabs.findIndex((tab) => tab.dataset.menuTab === activeMenuCategoryId);
  if (currentIndex < 0) return;
  event.preventDefault();
  const nextIndex = event.key === "Home"
    ? 0
    : event.key === "End"
      ? tabs.length - 1
      : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  selectMenuCategory(tabs[nextIndex].dataset.menuTab, { focusTab: true });
});

document.addEventListener("click", (event) => {
  const orderLink = event.target.closest("[data-order-start]");
  if (orderLink) {
    event.preventDefault();
    if (basket.length) openCart();
    else selectMenuCategory("pasta", { scroll: true, focusTab: true });
    return;
  }
  const categoryLink = event.target.closest("[data-menu-category]");
  if (!categoryLink) return;
  event.preventDefault();
  const productId = categoryLink.dataset.menuProduct;
  selectMenuCategory(categoryLink.dataset.menuCategory, { scroll: true, focusTab: !productId });
  if (productId) {
    const card = [...menuGrid.querySelectorAll("[data-product-id]")].find(card => card.dataset.productId === productId);
    card?.scrollIntoView({ block: "center", behavior: "auto" });
    card?.querySelector(".menu-add")?.focus({ preventScroll: true });
  }
});
basketList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-basket-action]");
  if (!button || paymentPending) return;
  const index = Number(button.dataset.index), action = button.dataset.basketAction;
  const previous = [...basket];
  changeBasketQuantity(basket, index, action, button.dataset.indices?.split(",").map(Number));
  try { priceBasket(basket, activeMenuData, activeSettings); }
  catch (error) { basket.splice(0, basket.length, ...previous); showCheckoutError(error.message); return; }
  renderBasket();
  const replacement = basketList.querySelector('[data-index="' + index + '"][data-basket-action="' + action + '"]') || basketList.querySelector("button") || cartClose;
  replacement.focus({ preventScroll: true });
});

orderForm.addEventListener("input", (event) => {
  const field = event.target;
  if (field.setCustomValidity) field.setCustomValidity("");
  if (field.name) {
    field.removeAttribute("aria-invalid");
    const error = document.querySelector("#error-" + field.name);
    if (error) error.hidden = true;
  }
  if (field === orderNotesInput) syncNotesConsent();
  updateMessage();
});

orderForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!validateCollectionForm()) return;
  updateMessage();
  setCartStep("payment");
});

continueToDetails.addEventListener("click", goToCollectionDetails);
mobileBasketButton.addEventListener("click", openCart);
document.querySelector("#editCollectionDetails").addEventListener("click", goToCollectionDetails);
document.querySelector("#reviewBasket").addEventListener("click", () => setCartStep("basket"));
menuCategoryNav.addEventListener("scroll", syncCategoryOverflow, { passive: true });
for (const [id, direction] of [["categoriesPrevious", -1], ["categoriesNext", 1]]) {
  document.querySelector("#" + id).addEventListener("click", () => menuCategoryNav.scrollBy({ left: direction * menuCategoryNav.clientWidth * 0.75, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }));
}
new ResizeObserver(syncLayoutMetrics).observe(document.querySelector(".site-header"));
window.addEventListener("resize", syncLayoutMetrics);
window.visualViewport?.addEventListener("resize", syncLayoutMetrics);
window.visualViewport?.addEventListener("scroll", syncLayoutMetrics);
document.fonts.ready.then(syncLayoutMetrics);

checkoutButton.addEventListener("click", sendCollectionOrder);
stripeCheckoutButton.addEventListener("click", payOnlineWithStripe);
cartToggle.addEventListener("click", openCart);
cartClose.addEventListener("click", closeCart);
openBasketFromForm.addEventListener("click", openCart);

navToggle.addEventListener("click", () => {
  const isOpen = siteNav.classList.toggle("is-open");
  navToggle.setAttribute("aria-expanded", String(isOpen));
  navToggle.setAttribute("aria-label", isOpen ? "Close menu" : "Open menu");
});

siteNav.addEventListener("click", () => {
  siteNav.classList.remove("is-open");
  navToggle.setAttribute("aria-expanded", "false");
  navToggle.setAttribute("aria-label", "Open menu");
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !siteNav.classList.contains("is-open") || cartDrawer.open) return;
  siteNav.classList.remove("is-open");
  navToggle.setAttribute("aria-expanded", "false");
  navToggle.setAttribute("aria-label", "Open menu");
  navToggle.focus();
});

const categoryAliases = { deals: "meal-deals", baguettes: "fresh-baguettes", "cold-drinks": "soft-drinks" };
function categoryFromHash() {
  const hash = window.location.hash.slice(1);
  return hash.startsWith("menu-") ? hash.slice(5) : categoryAliases[hash] || hash;
}
const hashCategory = categoryFromHash();
if (hashCategory !== "signature-picks" && menuData.some((group) => getGroupId(group) === hashCategory)) activeMenuCategoryId = hashCategory;

setupBackgroundMusic();
document.querySelector("#copyrightYear").textContent = String(new Date().getFullYear());
document.querySelector("#loadMap").addEventListener("click", () => {
  const map = document.querySelector("#visitMap");
  map.src = map.dataset.src;
  map.hidden = false;
  document.querySelector("#loadMap").hidden = true;
  document.querySelector("#mapPrivacy").hidden = true;
});
window.addEventListener("hashchange", () => {
  const category = categoryFromHash();
  if (category !== "signature-picks" && activeMenuData.some(group => getGroupId(group) === category)) selectMenuCategory(category, { scroll: true, focusTab: true });
});
renderMenu();
loadSettings().then(() => {
  try { basket.push(...restoreBasket(localStorage, activeMenuData, activeSettings)); } catch { /* Storage is optional. */ }
  basketReady = true;
  renderBasket();
  updateOrderingControls();
  window.setInterval(updateOrderingControls, 60_000);
  showOrderSentMessage();
});

function disableOrderingForUnavailableCatalogue() {
  // Never allow an open browser to use default 'ordering enabled' state after
  // either authoritative settings or the trusted menu API stops responding.
  // The local catalogue remains browse-only; all actual order writes stay closed.
  activeSettings = mergeSettings(activeSettings, {
    ordering: { enabled: false, closedMessage: "Online ordering is temporarily unavailable. Please call the cafe." },
    payments: { payOnCollection: false, stripe: false },
  });
}

async function loadSettings() {
  try {
    const [settingsResponse, menuResponse] = await Promise.all([fetch("/api/settings"), fetch("/api/menu")]);
    if (!settingsResponse.ok || !menuResponse.ok) throw new Error("Authoritative menu unavailable");
    const settings = await settingsResponse.json();
    activeSettings = mergeSettings(defaultSiteSettings, settings);
    activeMenuData = onlineMenuGroups(await menuResponse.json());
    renderMenu();
    return;
  } catch {
    try {
      const response = await fetch("/api/settings");
      if (!response.ok) throw new Error("Settings unavailable");
      const settings = await response.json();
      activeSettings = mergeSettings(defaultSiteSettings, settings);
      activeMenuData = onlineMenuGroups(applyMenuPrices(menuData, activeSettings.menuPrices || {}));
    } catch {
      activeSettings = mergeSettings(defaultSiteSettings, {});
      activeMenuData = onlineMenuGroups(menuData);
    }
    disableOrderingForUnavailableCatalogue();
    renderMenu();
  }
}

function applyMenuPrices(groups, prices = {}) {
  return groups.map((group) => ({
    ...group,
    items: group.items.map((item) => ({
      ...item,
      price: prices[getItemKey(item)] || prices[item.name] || item.price,
    })),
  }));
}
