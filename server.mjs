import { createServer } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { menuData, priceToPence } from "./menu-data.mjs";
import { defaultSiteSettings, getOrderingStatus, mergeSettings } from "./site-settings.mjs";

const root = process.cwd();
const dataDir = join(root, "data");
const settingsFile = join(dataDir, "site-settings-live.json");
const ordersFile = join(dataDir, "orders.json");
const port = Number(process.env.PORT || 5820);
const stripeSecretKey = process.env.STRIPE_SECRET_KEY || "";
const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "";
const orderNotificationEmail = process.env.ORDER_NOTIFICATION_EMAIL || "elitescaffe33@gmail.com";
const adminPassword = process.env.ADMIN_PASSWORD || "";
const smtpHost = process.env.SMTP_HOST || "";
const smtpPort = Number(process.env.SMTP_PORT || 465);
const smtpUser = process.env.SMTP_USER || "";
const smtpPass = process.env.SMTP_PASS || "";
const resendApiKey = process.env.RESEND_API_KEY || "";
const resendFromEmail = process.env.RESEND_FROM_EMAIL || "CAFE ELITE Orders <onboarding@resend.dev>";
const supabaseUrl = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const currency = "gbp";

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".md": "text/markdown; charset=utf-8",
};

function getMenuPrice(item, settings) {
  return settings?.menuPrices?.[item.name] || item.price;
}

function buildCatalog(settings) {
  return new Map(
    menuData.flatMap((group) =>
      group.items.map((item) => [
        item.name,
        {
          category: group.category,
          name: item.name,
          amount: priceToPence(getMenuPrice(item, settings)),
        },
      ]),
    ),
  );
}

async function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJsonFile(filePath, data) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function hasSupabase() {
  return Boolean(supabaseUrl && supabaseServiceRoleKey);
}

async function supabaseRequest(pathname, options = {}) {
  if (!hasSupabase()) throw new Error("Supabase is not configured");

  const response = await fetch(`${supabaseUrl}/rest/v1${pathname}`, {
    ...options,
    headers: {
      apikey: supabaseServiceRoleKey,
      Authorization: `Bearer ${supabaseServiceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(data?.message || data?.error || `Supabase failed with status ${response.status}`);
  }
  return data;
}

async function loadSettings() {
  if (hasSupabase()) {
    try {
      const rows = await supabaseRequest("/cafe_elite_settings?id=eq.main&select=settings&limit=1");
      return mergeSettings(defaultSiteSettings, rows?.[0]?.settings || {});
    } catch (error) {
      console.error("Supabase settings read failed, using file fallback:", error.message);
    }
  }

  const savedSettings = await readJsonFile(settingsFile, {});
  return mergeSettings(defaultSiteSettings, savedSettings);
}

async function saveSettings(settings) {
  const mergedSettings = mergeSettings(defaultSiteSettings, settings);

  if (hasSupabase()) {
    try {
      await supabaseRequest("/cafe_elite_settings", {
        method: "POST",
        headers: {
          Prefer: "resolution=merge-duplicates,return=representation",
        },
        body: JSON.stringify({
          id: "main",
          settings: mergedSettings,
          updated_at: new Date().toISOString(),
        }),
      });
    } catch (error) {
      console.error("Supabase settings write failed, using file fallback:", error.message);
    }
  }

  await writeJsonFile(settingsFile, mergedSettings);
  return mergedSettings;
}

function isAdminRequest(request) {
  return Boolean(adminPassword) && request.headers["x-admin-password"] === adminPassword;
}

function requireAdmin(request, response) {
  if (isAdminRequest(request)) return true;
  response.writeHead(401, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: "Admin password is required" }));
  return false;
}

async function saveOrder(order) {
  const nextOrder = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    ...order,
  };

  if (hasSupabase()) {
    try {
      await supabaseRequest("/cafe_elite_orders", {
        method: "POST",
        body: JSON.stringify({
          id: nextOrder.id,
          created_at: nextOrder.createdAt,
          type: nextOrder.type,
          payment: nextOrder.payment,
          status: nextOrder.status,
          stripe_session_id: nextOrder.stripeSessionId || null,
          amount: nextOrder.amount || null,
          customer_name: nextOrder.customerName || "",
          phone: nextOrder.phone || "",
          email: nextOrder.email || "",
          collection_time: nextOrder.collectionTime || "",
          items: nextOrder.items || "",
          notes: nextOrder.notes || "",
          message: nextOrder.message || "",
        }),
      });
    } catch (error) {
      console.error("Supabase order write failed, using file fallback:", error.message);
    }
  }

  const orders = await readJsonFile(ordersFile, []);
  orders.unshift(nextOrder);
  await writeJsonFile(ordersFile, orders.slice(0, 500));
  return nextOrder;
}

async function loadOrders() {
  if (hasSupabase()) {
    try {
      const rows = await supabaseRequest("/cafe_elite_orders?select=*&order=created_at.desc&limit=500");
      return rows.map((row) => ({
        id: row.id,
        createdAt: row.created_at,
        type: row.type,
        payment: row.payment,
        status: row.status,
        stripeSessionId: row.stripe_session_id,
        amount: row.amount,
        customerName: row.customer_name,
        phone: row.phone,
        email: row.email,
        collectionTime: row.collection_time,
        items: row.items,
        notes: row.notes,
        message: row.message,
      }));
    } catch (error) {
      console.error("Supabase orders read failed, using file fallback:", error.message);
    }
  }

  return readJsonFile(ordersFile, []);
}

async function updateOrderStatus(orderId, status) {
  const allowedStatuses = new Set(["new", "pending", "preparing", "completed", "cancelled", "paid"]);
  if (!orderId) throw new Error("Order id is required");
  if (!allowedStatuses.has(status)) throw new Error("Invalid order status");

  if (hasSupabase()) {
    try {
      await supabaseRequest(`/cafe_elite_orders?id=eq.${encodeURIComponent(orderId)}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
    } catch (error) {
      console.error("Supabase order status update failed, using file fallback:", error.message);
    }
  }

  const orders = await readJsonFile(ordersFile, []);
  const nextOrders = orders.map((order) => (order.id === orderId ? { ...order, status } : order));
  await writeJsonFile(ordersFile, nextOrders);
  return { ok: true, id: orderId, status };
}

function getOrigin(request) {
  const proto = request.headers["x-forwarded-proto"] || "http";
  const host = request.headers["x-forwarded-host"] || request.headers.host;
  return `${proto}://${host}`;
}

function readJson(request) {
  return readRawBody(request).then((body) => JSON.parse(body || "{}"));
}

function readRawBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk.toString("utf8");
      if (body.length > 200_000) {
        request.destroy();
        reject(new Error("Request body too large"));
      }
    });
    request.on("end", () => {
      resolve(body);
    });
    request.on("error", reject);
  });
}

function verifyStripeSignature(payload, signatureHeader) {
  if (!stripeWebhookSecret) throw new Error("Stripe webhook secret is not configured");
  if (!signatureHeader) throw new Error("Missing Stripe signature");

  const parts = Object.fromEntries(
    signatureHeader.split(",").map((part) => {
      const [key, value] = part.split("=");
      return [key, value];
    }),
  );

  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) throw new Error("Invalid Stripe signature header");

  const expected = createHmac("sha256", stripeWebhookSecret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");

  const received = Buffer.from(signature, "hex");
  const computed = Buffer.from(expected, "hex");

  if (received.length !== computed.length || !timingSafeEqual(received, computed)) {
    throw new Error("Stripe signature verification failed");
  }
}

function normalizeOrderItem(item) {
  if (typeof item === "string") return { name: item, details: "" };
  return {
    name: String(item?.name || ""),
    details: String(item?.details || ""),
  };
}

function aggregateItems(itemNames, settings) {
  const catalog = buildCatalog(settings);
  const counts = new Map();

  itemNames.map(normalizeOrderItem).forEach(({ name, details }) => {
    if (!catalog.has(name)) throw new Error(`Unknown item: ${name}`);
    const key = `${name}::${details}`;
    const existing = counts.get(key) || {
      ...catalog.get(name),
      name,
      displayName: details ? `${name} (${details})` : name,
      details,
      quantity: 0,
    };
    existing.quantity += 1;
    counts.set(key, existing);
  });

  return [...counts.values()];
}

async function createCheckoutSession(request, response) {
  if (!stripeSecretKey) {
    response.writeHead(500, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "Stripe secret key is not configured" }));
    return;
  }

  const settings = await loadSettings();

  if (!settings.payments.stripe) {
    response.writeHead(403, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "Online payment is currently unavailable" }));
    return;
  }

  const orderingStatus = getOrderingStatus(new Date(), settings);
  if (!orderingStatus.isOpen) {
    response.writeHead(403, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: orderingStatus.message }));
    return;
  }

  try {
    const payload = await readJson(request);
    const items = aggregateItems(Array.isArray(payload.items) ? payload.items : [], settings);

    if (!items.length) throw new Error("No items selected");

    const origin = getOrigin(request);
    const params = new URLSearchParams();
    params.set("mode", "payment");
    params.set("success_url", `${origin}/success.html`);
    params.set("cancel_url", `${origin}/#order`);
    params.set("payment_method_types[0]", "card");
    params.set("phone_number_collection[enabled]", "true");
    params.set("metadata[customer_name]", payload.customer?.name || "");
    params.set("metadata[phone]", payload.customer?.phone || "");
    params.set("metadata[collection_time]", payload.customer?.collectionTime || "");
    params.set("metadata[notes]", payload.customer?.notes || "");
    params.set("metadata[marketing_consent]", payload.customer?.marketingConsent ? "yes" : "no");
    params.set("metadata[source]", "CAFE ELITE website");
    params.set("metadata[order_items]", items.map((item) => `${item.quantity}x ${item.displayName || item.name}`).join(", "));
    if (payload.customer?.email) params.set("customer_email", payload.customer.email);

    items.forEach((item, index) => {
      params.set(`line_items[${index}][quantity]`, String(item.quantity));
      params.set(`line_items[${index}][price_data][currency]`, currency);
      params.set(`line_items[${index}][price_data][unit_amount]`, String(item.amount));
      params.set(`line_items[${index}][price_data][product_data][name]`, item.displayName || item.name);
      params.set(`line_items[${index}][price_data][product_data][description]`, item.category);
    });

    const stripeResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeSecretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
    });

    const data = await stripeResponse.json();

    if (!stripeResponse.ok) {
      response.writeHead(stripeResponse.status, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: data.error?.message || "Stripe error" }));
      return;
    }

    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ url: data.url }));
  } catch (error) {
    response.writeHead(400, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: error.message }));
  }
}

async function createCollectionOrder(request, response) {
  const settings = await loadSettings();

  if (!settings.payments.payOnCollection) {
    response.writeHead(403, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "Pay on collection is currently unavailable" }));
    return;
  }

  const orderingStatus = getOrderingStatus(new Date(), settings);
  if (!orderingStatus.isOpen) {
    response.writeHead(403, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: orderingStatus.message }));
    return;
  }

  try {
    const payload = await readJson(request);
    const message = payload.full_message || "New CAFE ELITE collection order";
    const marketingConsent = payload.marketing_consent === "yes";
    const order = await saveOrder({
      type: "pay-on-collection",
      payment: "Pay on collection",
      status: "pending",
      customerName: payload.customer_name || "",
      phone: payload.phone || "",
      email: payload.email || "",
      collectionTime: payload.collection_time || "",
      items: payload.items || "",
      notes: payload.notes || "",
      message: marketingConsent ? `${message}\nMarketing consent: yes` : message,
    });

    await sendOrderEmail({
      subject: "New CAFE ELITE collection order",
      text: message,
    });

    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, orderId: order.id }));
  } catch (error) {
    response.writeHead(400, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: error.message }));
  }
}

async function sendOrderEmail({ subject, text }) {
  if (resendApiKey) {
    await sendResendMail({ subject, text });
    return;
  }

  if (smtpHost && smtpUser && smtpPass) {
    await sendSmtpMail({ subject, text });
    return;
  }

  const formData = new URLSearchParams();
  formData.set("_subject", subject);
  formData.set("_captcha", "false");
  formData.set("_template", "table");
  formData.set("message", text);

  const formSubmitResponse = await fetch(`https://formsubmit.co/ajax/${encodeURIComponent(orderNotificationEmail)}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: formData,
  });

  if (!formSubmitResponse.ok) {
    throw new Error(`Order notification failed with status ${formSubmitResponse.status}`);
  }
}

async function stripeApi(pathname, options = {}) {
  const stripeResponse = await fetch(`https://api.stripe.com/v1${pathname}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${stripeSecretKey}`,
      ...(options.headers || {}),
    },
  });

  const data = await stripeResponse.json();
  if (!stripeResponse.ok) throw new Error(data.error?.message || "Stripe API error");
  return data;
}

async function notifyPaidOrder(session) {
  console.log(`Preparing paid order email for Stripe session ${session.id}`);
  const lineItems = await stripeApi(`/checkout/sessions/${session.id}/line_items?limit=100`);
  const items = lineItems.data
    .map((item) => `${item.quantity}x ${item.description} - ${(item.amount_total / 100).toFixed(2)} GBP`)
    .join("\n");

  const message = [
    "Paid CAFE ELITE online order",
    `Stripe session: ${session.id}`,
    `Payment status: ${session.payment_status}`,
    `Amount paid: ${(session.amount_total / 100).toFixed(2)} GBP`,
    `Customer name: ${session.metadata?.customer_name || "Not provided"}`,
    `Phone: ${session.metadata?.phone || session.customer_details?.phone || "Not provided"}`,
    `Email: ${session.customer_details?.email || "Not provided"}`,
    `Marketing consent: ${session.metadata?.marketing_consent || "no"}`,
    `Collection time: ${session.metadata?.collection_time || "Not provided"}`,
    "Items:",
    items,
    `Notes: ${session.metadata?.notes || "None"}`,
  ].join("\n");

  await saveOrder({
    type: "paid-online",
    payment: "Stripe",
    status: "paid",
    stripeSessionId: session.id,
    amount: `${(session.amount_total / 100).toFixed(2)} GBP`,
    customerName: session.metadata?.customer_name || "",
    phone: session.metadata?.phone || session.customer_details?.phone || "",
    email: session.customer_details?.email || "",
    collectionTime: session.metadata?.collection_time || "",
    items,
    notes: session.metadata?.notes || "",
    message,
  });

  if (resendApiKey) {
    console.log(`Sending paid order email to ${orderNotificationEmail} using Resend`);
    await sendResendMail({
      subject: "Paid CAFE ELITE online order",
      text: message,
    });
    console.log(`Paid order Resend email sent to ${orderNotificationEmail}`);
    return;
  }

  if (smtpHost && smtpUser && smtpPass) {
    console.log(`Sending paid order email to ${orderNotificationEmail} using SMTP ${smtpHost}:${smtpPort}`);
    try {
      await sendSmtpMail({
        subject: "Paid CAFE ELITE online order",
        text: message,
      });
      console.log(`Paid order email sent to ${orderNotificationEmail}`);
      return;
    } catch (error) {
      console.error(`SMTP paid order email failed, trying FormSubmit fallback: ${error.message}`);
    }
  }

  await sendFormSubmitNotification(session, message, items);
}

async function sendFormSubmitNotification(session, message, items) {
  const formData = new URLSearchParams();
  formData.set("_subject", "Paid CAFE ELITE online order");
  formData.set("_captcha", "false");
  formData.set("_template", "table");
  formData.set("message", message);
  formData.set("stripe_session", session.id);
  formData.set("payment_status", session.payment_status || "");
  formData.set("amount_paid", `${(session.amount_total / 100).toFixed(2)} GBP`);
  formData.set("customer_name", session.metadata?.customer_name || "");
  formData.set("phone", session.metadata?.phone || session.customer_details?.phone || "");
  formData.set("email", session.customer_details?.email || "");
  formData.set("marketing_consent", session.metadata?.marketing_consent || "no");
  formData.set("collection_time", session.metadata?.collection_time || "");
  formData.set("items", items);
  formData.set("notes", session.metadata?.notes || "");

  const response = await fetch(`https://formsubmit.co/ajax/${encodeURIComponent(orderNotificationEmail)}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`Order notification failed with status ${response.status}`);
  }

  console.log(`Paid order FormSubmit notification sent to ${orderNotificationEmail}`);
}

function buildContacts(orders) {
  const contacts = new Map();

  orders.forEach((order) => {
    const email = String(order.email || "").trim().toLowerCase();
    const phone = String(order.phone || "").trim();
    if (!email && !phone) return;

    const key = email || phone;
    const hasMarketingConsent =
      order.marketingConsent === true || /marketing consent:\s*(yes|true)/i.test(order.message || "");
    const existing = contacts.get(key) || {
      name: order.customerName || "",
      email,
      phone,
      marketingConsent: false,
      orderCount: 0,
      latestOrderAt: order.createdAt || "",
    };

    existing.name = existing.name || order.customerName || "";
    existing.email = existing.email || email;
    existing.phone = existing.phone || phone;
    existing.marketingConsent = existing.marketingConsent || hasMarketingConsent;
    existing.orderCount += 1;
    if (order.createdAt && (!existing.latestOrderAt || new Date(order.createdAt) > new Date(existing.latestOrderAt))) {
      existing.latestOrderAt = order.createdAt;
    }
    contacts.set(key, existing);
  });

  return [...contacts.values()].sort((a, b) => new Date(b.latestOrderAt) - new Date(a.latestOrderAt));
}

async function sendResendMail({ subject, text }) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: resendFromEmail,
      to: [orderNotificationEmail],
      subject,
      text,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || data.error || `Resend failed with status ${response.status}`);
  }
}

async function sendSmtpMail({ subject, text }) {
  const nodemailerModule = await import("nodemailer");
  const nodemailer = nodemailerModule.default || nodemailerModule;
  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 15_000,
    auth: {
      user: smtpUser,
      pass: smtpPass.replace(/\s/g, ""),
    },
  });

  await transporter.sendMail({
    from: `"CAFE ELITE Orders" <${smtpUser}>`,
    to: orderNotificationEmail,
    subject,
    text,
  });
}

async function handleStripeWebhook(request, response) {
  try {
    const payload = await readRawBody(request);
    verifyStripeSignature(payload, request.headers["stripe-signature"]);
    const event = JSON.parse(payload);

    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ received: true }));

    if (event.type === "checkout.session.completed") {
      notifyPaidOrder(event.data.object).catch((error) => {
        console.error("Paid order notification failed:", error.message);
      });
    }
  } catch (error) {
    response.writeHead(400, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: error.message }));
  }
}

async function serveStatic(request, response) {
  const url = new URL(request.url || "/", `http://${request.headers.host}`);
  const cleanPath = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(root, cleanPath === "/" ? "index.html" : cleanPath);

  try {
    const body = await readFile(filePath);
    response.writeHead(200, {
      "content-type": contentTypes[extname(filePath).toLowerCase()] || "application/octet-stream",
    });
    response.end(body);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}

createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/api/health") {
    console.log("Health check received");
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, service: "CAFE ELITE" }));
    return;
  }

  if (request.method === "GET" && request.url === "/api/settings") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(await loadSettings()));
    return;
  }

  if (request.method === "POST" && request.url === "/api/collection-order") {
    console.log("Collection order request received");
    await createCollectionOrder(request, response);
    return;
  }

  if (request.method === "POST" && request.url === "/api/create-checkout-session") {
    console.log("Create checkout session request received");
    await createCheckoutSession(request, response);
    return;
  }

  if (request.method === "POST" && request.url === "/api/stripe-webhook") {
    console.log("Stripe webhook request received");
    await handleStripeWebhook(request, response);
    return;
  }

  if (request.method === "GET" && request.url === "/api/admin/settings") {
    if (!requireAdmin(request, response)) return;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(await loadSettings()));
    return;
  }

  if (request.method === "POST" && request.url === "/api/admin/settings") {
    if (!requireAdmin(request, response)) return;
    const settings = await readJson(request);
    const savedSettings = await saveSettings(settings);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(savedSettings));
    return;
  }

  if (request.method === "GET" && request.url === "/api/admin/orders") {
    if (!requireAdmin(request, response)) return;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(await loadOrders()));
    return;
  }

  if (request.method === "GET" && request.url === "/api/admin/contacts") {
    if (!requireAdmin(request, response)) return;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(buildContacts(await loadOrders())));
    return;
  }

  if (request.method === "POST" && request.url === "/api/admin/order-status") {
    if (!requireAdmin(request, response)) return;
    const payload = await readJson(request);
    const result = await updateOrderStatus(payload.id, payload.status);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(result));
    return;
  }

  await serveStatic(request, response);
}).listen(port, "0.0.0.0", () => {
  console.log(`CAFE ELITE running on http://127.0.0.1:${port}`);
});
