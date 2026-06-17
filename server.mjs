import { createServer } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { menuData, priceToPence } from "./menu-data.mjs";
import { getOrderingStatus, siteSettings } from "./site-settings.mjs";

const root = process.cwd();
const port = Number(process.env.PORT || 5820);
const stripeSecretKey = process.env.STRIPE_SECRET_KEY || "";
const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "";
const orderNotificationEmail = process.env.ORDER_NOTIFICATION_EMAIL || "elitescaffe33@gmail.com";
const smtpHost = process.env.SMTP_HOST || "";
const smtpPort = Number(process.env.SMTP_PORT || 465);
const smtpUser = process.env.SMTP_USER || "";
const smtpPass = process.env.SMTP_PASS || "";
const resendApiKey = process.env.RESEND_API_KEY || "";
const resendFromEmail = process.env.RESEND_FROM_EMAIL || "CAFE ELITE Orders <onboarding@resend.dev>";
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

const catalog = new Map(
  menuData.flatMap((group) =>
    group.items.map((item) => [
      item.name,
      {
        category: group.category,
        name: item.name,
        amount: priceToPence(item.price),
      },
    ]),
  ),
);

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

function aggregateItems(itemNames) {
  const counts = new Map();

  itemNames.forEach((name) => {
    if (!catalog.has(name)) throw new Error(`Unknown item: ${name}`);
    counts.set(name, (counts.get(name) || 0) + 1);
  });

  return [...counts.entries()].map(([name, quantity]) => ({
    ...catalog.get(name),
    quantity,
  }));
}

async function createCheckoutSession(request, response) {
  if (!stripeSecretKey) {
    response.writeHead(500, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "Stripe secret key is not configured" }));
    return;
  }

  if (!siteSettings.payments.stripe) {
    response.writeHead(403, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "Online payment is currently unavailable" }));
    return;
  }

  const orderingStatus = getOrderingStatus();
  if (!orderingStatus.isOpen) {
    response.writeHead(403, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: orderingStatus.message }));
    return;
  }

  try {
    const payload = await readJson(request);
    const items = aggregateItems(Array.isArray(payload.items) ? payload.items : []);

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
    params.set("metadata[source]", "CAFE ELITE website");
    params.set("metadata[order_items]", items.map((item) => `${item.quantity}x ${item.name}`).join(", "));

    items.forEach((item, index) => {
      params.set(`line_items[${index}][quantity]`, String(item.quantity));
      params.set(`line_items[${index}][price_data][currency]`, currency);
      params.set(`line_items[${index}][price_data][unit_amount]`, String(item.amount));
      params.set(`line_items[${index}][price_data][product_data][name]`, item.name);
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
    `Collection time: ${session.metadata?.collection_time || "Not provided"}`,
    "Items:",
    items,
    `Notes: ${session.metadata?.notes || "None"}`,
  ].join("\n");

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

  await serveStatic(request, response);
}).listen(port, "0.0.0.0", () => {
  console.log(`CAFE ELITE running on http://127.0.0.1:${port}`);
});
