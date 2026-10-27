import { createHash, createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { OrderError, isRecord, canonicalItems, normaliseAndPriceOrder } from "./order-catalogue.mjs";
import { changeOrder } from "./order-store.mjs";
import { validateCollectionTime } from "./collection-time.mjs";
import { getOrderingStatus } from "./site-settings.mjs";
import { ORDER_NOTES_CONSENT, NOTES_CONSENT_ERROR, orderNotesConsentEvidence } from "./order-notes-consent.mjs";

const attemptPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function field(value, label, max, required = false) {
  if (value === undefined && !required) return "";
  if (typeof value !== "string" || value.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value) || (required && !value.trim())) throw new OrderError(`Please enter a valid ${label} (maximum ${max} characters).`);
  return value.trim();
}
export function validateOrderRequest(payload, mode) {
  if (!isRecord(payload) || !attemptPattern.test(payload.attemptId || "") || !isRecord(payload.customer)) throw new OrderError("Invalid checkout attempt. Please refresh the menu and try again.");
  const c = payload.customer;
  const customer = {
    name: field(c.name, "name", 100, true), phone: field(c.phone, "phone number", 32, true),
    email: field(c.email, "email address", 254), collectionTime: field(c.collectionTime, "collection time", 5, true),
    notes: field(c.notes, "notes", 2000),
  };
  if (c.notesConsent !== undefined && typeof c.notesConsent !== "boolean") throw new OrderError("Invalid order notes consent.", 422);
  if (c.notesConsentVersion !== undefined && typeof c.notesConsentVersion !== "string") throw new OrderError("Invalid order notes consent version.", 422);
  if (customer.notes) {
    if (c.notesConsent !== true) throw new OrderError(NOTES_CONSENT_ERROR, 422);
    if (c.notesConsentVersion !== ORDER_NOTES_CONSENT.version) throw new OrderError("Please review the current order notes consent statement before continuing.", 422);
    customer.notesConsent = true;
    customer.notesConsentVersion = ORDER_NOTES_CONSENT.version;
  }
  if (/[\r\n]/.test(customer.name) || !/^[+0-9().\s-]+$/.test(customer.phone) || !/^[0-9]{7,15}$/.test(customer.phone.replace(/\D/g, ""))) throw new OrderError("Please enter your name and a valid phone number including area code.");
  if (customer.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)) throw new OrderError("Please enter a valid email address or leave it blank.");
  if (!/^\d{2}:\d{2}$/.test(customer.collectionTime)) throw new OrderError("Please choose a valid collection time.", 422);
  // Legacy clients may still send old opt-in fields. Do not collect or store them.
  if (!["collection", "online"].includes(mode)) throw new OrderError("Invalid payment method.");
  return { attemptId: payload.attemptId.toLowerCase(), mode, items: canonicalItems(payload.items), customer };
}
function fingerprint(request) {
  return createHash("sha256").update(JSON.stringify(request)).digest("hex");
}
function orderMessage(order) {
  return ["CAFE ELITE collection order", `Reference: ${order.id}`, `Status: ${order.status}`, `Payment: ${order.paymentState === "paid" ? "Paid online" : order.payment}`,
    `Customer name: ${order.customerName}`, `Phone: ${order.phone}`, `Email: ${order.email || "Not provided"}`,
    `Collection time: ${order.collectionTime}`, `Total: ${order.amount}`, "Items:", order.items,
    `Notes: ${String(order.notes || "None").replace(/[\r\n]+/g, " ")}`].join("\n");
}
export function stripeCheckoutParams(order, origin) {
  const params = new URLSearchParams({ mode: "payment", success_url: `${origin}/success.html?session_id={CHECKOUT_SESSION_ID}`, cancel_url: `${origin}/#menu` });
  params.set("payment_method_types[0]", "card");
  params.set("client_reference_id", order.id);
  params.set("metadata[order_id]", order.id);
  params.set("metadata[source]", "CAFE ELITE website");
  if (order.email) params.set("customer_email", order.email);
  (order.pricing.checkoutItems || order.pricing.items).forEach((item, index) => {
    params.set(`line_items[${index}][quantity]`, String(item.quantity));
    params.set(`line_items[${index}][price_data][currency]`, order.pricing.currency);
    params.set(`line_items[${index}][price_data][unit_amount]`, String(item.unitPrice));
    params.set(`line_items[${index}][price_data][product_data][name]`, item.displayName);
    params.set(`line_items[${index}][price_data][product_data][description]`, item.category);
  });
  return params;
}
export function verifyWebhook(payload, header, secret, now = Date.now()) {
  if (!secret || typeof header !== "string") throw new OrderError("Invalid webhook signature.");
  const parts = header.split(",").map(part => part.trim().split("="));
  const times = parts.filter(([key]) => key === "t");
  const stamp = times[0]?.[1];
  if (times.length !== 1 || !/^\d+$/.test(stamp || "") || Math.abs(now / 1000 - Number(stamp)) > 300) throw new OrderError("Invalid webhook signature.");
  const expected = createHmac("sha256", secret).update(`${stamp}.`).update(payload).digest();
  const valid = parts.filter(([key, value]) => key === "v1" && /^[a-f0-9]{64}$/i.test(value || "")).some(([, value]) => timingSafeEqual(expected, Buffer.from(value, "hex")));
  if (!valid) throw new OrderError("Invalid webhook signature.");
}
export function sessionMatchesOrder(session, order) {
  return Boolean(order?.pricing && ["online", "paid-online"].includes(order.type) && session?.id === order.stripeSessionId && session.metadata?.order_id === order.id && session.metadata?.source === "CAFE ELITE website" && session.client_reference_id === order.id && session.mode === "payment" && session.currency === order.pricing.currency && session.amount_total === order.pricing.total);
}

export function createOrderService({ store, loadSettings, buildMenuData, createStripeSession, notify, notificationsDisabled = false, origin, now = () => new Date(), log = (code, id) => console.error(code, id) }) {
  async function prepare(payload, mode) {
    const request = validateOrderRequest(payload, mode);
    const id = request.attemptId;
    const hash = fingerprint(request);
    const existing = await store.get(id);
    if (existing) {
      if (existing.fingerprint !== hash) throw new OrderError("This checkout attempt already belongs to a different order. Review your basket before starting a new attempt.", 409);
      return existing;
    }
    const settings = await loadSettings();
    if (!settings.payments[mode === "online" ? "stripe" : "payOnCollection"]) throw new OrderError("This payment method is currently unavailable.", 403);
    const status = getOrderingStatus(now(), settings);
    if (!status.isOpen) throw new OrderError(status.message, 403);
    const timeError = validateCollectionTime(request.customer.collectionTime, now(), settings);
    if (timeError) throw new OrderError(timeError, 422);
    const pricing = normaliseAndPriceOrder(request, buildMenuData(settings), settings);
    const c = request.customer;
    const createdAt = now().toISOString();
    const candidate = {
      id, createdAt, revision: 0, fingerprint: hash,
      type: mode === "online" ? "online" : "pay-on-collection", payment: mode === "online" ? "Stripe" : "Pay on collection",
      status: mode === "online" ? "awaiting_payment" : "pending", paymentState: mode === "online" ? "pending_online" : "pay_on_collection",
      pricing, amount: `${(pricing.total / 100).toFixed(2)} GBP`, customerName: c.name, phone: c.phone, email: c.email,
      collectionTime: c.collectionTime, notes: c.notes,
      ...(c.notes ? { notesConsent: orderNotesConsentEvidence(id, createdAt) } : {}),
      items: pricing.checkoutItems.map(item => `${item.quantity}x ${item.displayName} - ${(item.lineTotal / 100).toFixed(2)} GBP`).join("\n"),
      notificationStatus: mode === "online" ? "not_ready" : "pending", processedEvents: [], checkoutOrigin: origin,
    };
    candidate.message = orderMessage(candidate);
    const order = await store.insert(candidate);
    if (!order || order.fingerprint !== hash) throw new OrderError("This checkout attempt already belongs to a different order.", 409);
    return order;
  }
  async function notifyOnce(id) {
    if (notificationsDisabled) return;
    // Persist the claim BEFORE sending. Ambiguous SMTP/FormSubmit failures must not
    // trigger fallback sends: the provider might already have accepted the email.
    const token = randomUUID();
    try {
      const claimed = await changeOrder(store, id, order => order.notificationStatus === "pending" ? { notificationStatus: "sending", notificationClaim: token, notificationAttemptedAt: now().toISOString() } : null);
      if (claimed.notificationClaim !== token) return;
      try {
        await notify({ subject: claimed.paymentState === "paid" ? "Paid CAFE ELITE online order" : "New CAFE ELITE collection order", text: claimed.message, idempotencyKey: `order-notification-${id}` });
        await changeOrder(store, id, order => order.notificationClaim === token ? { notificationStatus: "sent" } : null);
      } catch {
        log("notification_delivery_uncertain", id);
        await changeOrder(store, id, order => order.notificationClaim === token ? { notificationStatus: "failed_uncertain" } : null);
      }
    } catch { log("notification_state_unavailable", id); }
  }
  return {
    notifyOnce,
    async drainNotifications() {
      if (notificationsDisabled) return;
      try {
        const pending = (await store.list()).filter(order => order.notificationStatus === "pending").slice(0, 20);
        for (const order of pending) await notifyOnce(order.id);
      } catch { log("notification_queue_unavailable", ""); }
    },
    async collection(payload) {
      const order = await prepare(payload, "collection");
      // Notification delivery can never turn a saved order into an HTTP failure.
      await notifyOnce(order.id);
      return { ok: true, orderId: order.id, collectionTime: order.collectionTime, total: order.pricing.total, currency: order.pricing.currency };
    },
    async checkout(payload) {
      let order = await prepare(payload, "online");
      if (order.checkoutUrl) {
        if (order.checkoutExpiresAt && now().getTime() / 1000 >= order.checkoutExpiresAt) throw new OrderError("This payment session has expired. Please review your basket and start a new attempt.", 409);
        return { url: order.checkoutUrl, orderId: order.id, total: order.pricing.total, currency: order.pricing.currency };
      }
      // Stripe retains keys for at least 24h. Never create a fresh session after
      // that window for an attempt whose original outcome may be unknown.
      if (now().getTime() - Date.parse(order.createdAt) > 20 * 60 * 60 * 1000) throw new OrderError("This payment attempt needs checking. Please contact the cafe before paying again.", 409);
      const session = await createStripeSession(stripeCheckoutParams(order, order.checkoutOrigin), `checkout-${order.id}`);
      if (!/^cs_(?:test|live)_[A-Za-z0-9]+$/.test(session?.id || "") || !/^https:\/\/checkout\.stripe\.com\//.test(session?.url || "") || session.amount_total !== order.pricing.total || session.currency !== order.pricing.currency) throw new OrderError("Secure payment could not be verified. Retry this same attempt.", 502);
      order = await changeOrder(store, order.id, current => {
        if (current.stripeSessionId && current.stripeSessionId !== session.id) throw new OrderError("Payment session conflict. Please contact the cafe.", 409);
        return { stripeSessionId: session.id, checkoutUrl: session.url, checkoutExpiresAt: session.expires_at };
      });
      return { url: order.checkoutUrl, orderId: order.id, total: order.pricing.total, currency: order.pricing.currency };
    },
    async event(event) {
      if (!isRecord(event) || !/^evt_[A-Za-z0-9]{1,200}$/.test(event.id || "")) throw new OrderError("Invalid payment event.");
      if (!["checkout.session.completed", "checkout.session.async_payment_succeeded", "checkout.session.expired", "checkout.session.async_payment_failed"].includes(event.type)) return null;
      const session = event.data?.object;
      if (session?.metadata?.source !== "CAFE ELITE website") return null;
      if (!attemptPattern.test(session.metadata?.order_id || "")) throw new OrderError("Payment requires order reconciliation.", 409);
      const id = session.metadata.order_id;
      const changesFor = order => {
        // A verified event may beat the POST response that stores session.id.
        const matching = { ...order, stripeSessionId: order.stripeSessionId || session.id };
        if (!sessionMatchesOrder(session, matching)) throw new OrderError("Payment does not match this order.", 409);
        const processedEvents = order.processedEvents || [];
        if (!store.applyWebhook && processedEvents.includes(event.id)) return null;
        // DB mode deduplicates in its durable event ledger, never this legacy array.
        const changes = { stripeSessionId: session.id, processedEvents: [...processedEvents.filter(value => value !== event.id), event.id].slice(-100) };
        if (session.payment_status === "paid" && ["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(event.type)) {
          if (order.paymentState !== "paid") {
            changes.paymentState = "paid";
            changes.type = "paid-online";
            changes.status = order.status === "cancelled" ? "cancelled" : "paid";
            changes.notificationStatus = "pending";
            changes.message = orderMessage({ ...order, ...changes });
          }
        } else if (order.paymentState !== "paid" && ["checkout.session.expired", "checkout.session.async_payment_failed"].includes(event.type)) {
          changes.paymentState = "failed";
          changes.status = "cancelled";
        }
        return changes;
      };
      if (!store.applyWebhook) return changeOrder(store, id, changesFor);
      if (typeof event.livemode !== "boolean") throw new OrderError("Invalid payment event mode.");
      for (let tries = 0; tries < 20; tries++) {
        const order = await store.get(id);
        if (!order) throw new OrderError("Order could not be found.", 404);
        const saved = await store.applyWebhook(order, event, changesFor(order));
        if (saved) return saved;
      }
      throw new OrderError("Order is busy. Retry this event shortly.", 503);
    },
    async paymentStatus(session) {
      const id = session?.metadata?.order_id;
      if (!attemptPattern.test(id || "")) return { paid: false, orderReference: "", collectionTime: "" };
      const order = await store.get(id);
      const paid = sessionMatchesOrder(session, order) && session.payment_status === "paid" && order.paymentState === "paid" && order.status !== "cancelled";
      return { paid, orderReference: paid ? order.id : "", collectionTime: paid ? order.collectionTime : "" };
    },
  };
}
