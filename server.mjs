import { createServer } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { menuData, priceToPence } from "./menu-data.mjs";

const root = process.cwd();
const port = Number(process.env.PORT || 5820);
const stripeSecretKey = process.env.STRIPE_SECRET_KEY || "";
const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "";
const orderNotificationEmail = process.env.ORDER_NOTIFICATION_EMAIL || "elitescaffe33@gmail.com";
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
  if (request.method === "POST" && request.url === "/api/create-checkout-session") {
    await createCheckoutSession(request, response);
    return;
  }

  if (request.method === "POST" && request.url === "/api/stripe-webhook") {
    await handleStripeWebhook(request, response);
    return;
  }

  await serveStatic(request, response);
}).listen(port, "0.0.0.0", () => {
  console.log(`CAFE ELITE running on http://127.0.0.1:${port}`);
});
