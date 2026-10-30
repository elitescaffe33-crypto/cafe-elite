import { createServer } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { OrderError } from "./order-catalogue.mjs";
import { createFileOrderStore, createSupabaseOrderStore, changeOrder } from "./order-store.mjs";
import { createOrderService, verifyWebhook } from "./order-service.mjs";
import { mkdir, readFile, writeFile, realpath } from "node:fs/promises";
import { extname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import { getItemKey, menuData, slugify, isRetiredProduct, isRedundantLegacyCustomItem } from "./menu-data.mjs";
import { defaultSiteSettings, mergeSettings } from "./site-settings.mjs";
import { renderPublicPage, robotsText, sitemapXml, business } from "./public-content.mjs";
import { isApprovedPublicAsset } from "./public-asset-allowlist.mjs";
import { applyManagedMenu, validateMenuSettings } from "./menu-management.mjs";
import { buildMarketingContacts } from "./marketing-consent.mjs";
import { stagingSafety, assertNotificationsAllowed, assertStagingStripeRequest, assertStagingStripeSession, DEFAULT_APP_PORT } from "./staging-safety.mjs";

const root = process.cwd();
const safety = stagingSafety(process.env);
const previewMode = process.env.CAFE_PREVIEW_MODE === "1";
// Synthetic localhost-only tests may use disposable file storage. Production
// MUST have Supabase regardless of whether NODE_ENV was accidentally omitted.
const isolatedTest = process.env.CAFE_ISOLATED_TEST === "1"
  && process.env.PORT === "0"
  && process.env.NODE_ENV !== "production"
  && root.split(/[\\/]/).some(part => /^cafe-(?:hardening-static|hardening-http|static-v2|admin-cas|public-http)-/.test(part));
if (previewMode && (!process.env.CAFE_PREVIEW_DATA_DIR || resolve(process.env.CAFE_PREVIEW_DATA_DIR) === resolve(root, "data"))) {
  throw new Error("Preview requires a separate data directory.");
}
const dataDir = previewMode ? resolve(process.env.CAFE_PREVIEW_DATA_DIR) : join(root, "data");
const settingsFile = join(dataDir, "site-settings-live.json");
const port = Number(process.env.PORT || DEFAULT_APP_PORT);
const stripeSecretKey = process.env.STRIPE_SECRET_KEY || "";
const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "";
const orderNotificationEmail = process.env.ORDER_NOTIFICATION_EMAIL || "elitescaffe33@gmail.com";
const adminPassword = process.env.ADMIN_PASSWORD || "";
const resendApiKey = process.env.RESEND_API_KEY || "";
const resendFromEmail = process.env.RESEND_FROM_EMAIL || "";
const supabaseUrl = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
// A production checkout must never silently switch to ephemeral local JSON
// because a credential or database URL was not configured during a deploy.
// A missing durable database prevents starting the whole order service.
if (!previewMode && !safety.staging && !isolatedTest) {
  if (!supabaseUrl || !supabaseSecretKey)
    throw new Error("Production requires durable Supabase order storage; order service will not start without credentials.");
  let storage;
  try { storage = new URL(supabaseUrl); }
  catch { throw new Error("Invalid production Supabase URL."); }
  if (storage.protocol !== "https:" || storage.username || storage.password || storage.pathname !== "/" || storage.search || storage.hash)
    throw new Error("Production Supabase must use an HTTPS origin without embedded credentials or URL options.");
}
const checkoutOrigin = new URL(safety.staging ? safety.origin : process.env.PUBLIC_SITE_URL || business.url);
if (checkoutOrigin.username || checkoutOrigin.password || checkoutOrigin.pathname !== "/" || checkoutOrigin.search || checkoutOrigin.hash || (checkoutOrigin.protocol !== "https:" && !(checkoutOrigin.protocol === "http:" && ["localhost", "127.0.0.1"].includes(checkoutOrigin.hostname)))) throw new Error("Invalid PUBLIC_SITE_URL configuration");
const orderStore = hasSupabase() ? createSupabaseOrderStore(supabaseRequest) : createFileOrderStore(dataDir);
const orderService = createOrderService({ store: orderStore, loadSettings: loadOrderingSettings, buildMenuData,
  createStripeSession: (params, key) => stripeApi("/checkout/sessions", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": key }, body: params }),
  notify: sendOrderEmail, notificationsDisabled: safety.notificationsDisabled, origin: checkoutOrigin.origin });
const writeLimits = new Map();

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".md": "text/markdown; charset=utf-8",
};

function isHiddenItem(item, hiddenItems) {
  const priceKey = getItemKey(item);
  return hiddenItems.has(priceKey) || hiddenItems.has(item.id) || hiddenItems.has(item.name);
}

function normalizeCustomMenuItem(item) {
  const name = String(item?.name || "").trim();
  const category = String(item?.category || "Menu").trim() || "Menu";
  const id = String(item?.id || `custom-${slugify(category)}-${slugify(name)}`);
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

function buildMenuData(settings) {
  const hiddenItems = new Set(settings?.menuCustom?.hiddenItems || []);
  const customItems = Array.isArray(settings?.menuCustom?.customItems) ? settings.menuCustom.customItems : [];
  const groups = menuData.map((group) => ({
    ...group,
    items: group.items.filter((item) => !isRetiredProduct(item) && !isHiddenItem(item, hiddenItems)),
  }));

  customItems.filter(item => !isRedundantLegacyCustomItem(item)).map(normalizeCustomMenuItem).forEach((item) => {
    if (!item.name || isRetiredProduct(item) || isHiddenItem(item, hiddenItems)) return;
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
      description: item.description,
      ...(item.image ? { image: item.image } : {}),
    };
    if (existingIndex >= 0) group.items[existingIndex] = { ...group.items[existingIndex], ...normalized };
    else group.items.push(normalized);
  });

  return applyManagedMenu(groups.filter((group) => group.items.length), settings || {});
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
  return !previewMode && Boolean(supabaseUrl && supabaseSecretKey);
}

async function supabaseRequest(pathname, options = {}) {
  if (!hasSupabase()) throw new Error("Supabase is not configured");

  const response = await fetch(`${supabaseUrl}/rest/v1${pathname}`, {
    ...options,
    ...(safety.staging ? { redirect: "error" } : {}),
    signal: AbortSignal.timeout(15_000),
    headers: {
      apikey: supabaseSecretKey,
      // Modern secret keys are API keys, not JWT bearer tokens.
      ...(supabaseSecretKey.startsWith("sb_secret_") ? {} : { Authorization: `Bearer ${supabaseSecretKey}` }),
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error("Order storage is unavailable");
  }
  return data;
}

async function loadSettings() {
  // Public and admin settings must fail closed rather than use stale local
  // settings when the authoritative production DB cannot be reached.
  if (hasSupabase()) {
    const rows = await supabaseRequest("/cafe_elite_settings?id=eq.main&select=settings&limit=1");
    const remote = rows?.[0]?.settings;
    if (!remote || typeof remote !== "object" || Array.isArray(remote))
      throw new Error("Authoritative site settings are unavailable.");
    return mergeSettings(defaultSiteSettings, remote);
  }
  const savedSettings = await readJsonFile(settingsFile, {});
  return mergeSettings(defaultSiteSettings, savedSettings);
}

function settingsRevision(rawSettings, updatedAt = null) {
  return '"' + createHash("sha256").update(JSON.stringify({ settings: rawSettings, updatedAt })).digest("hex") + '"';
}

async function readAdminSettingsSnapshot() {
  if (hasSupabase()) {
    const rows = await supabaseRequest("/cafe_elite_settings?id=eq.main&select=settings,updated_at&limit=1");
    const row = rows?.[0];
    if (!row?.settings || !row.updated_at) throw new OrderError("Site settings are temporarily unavailable.", 503);
    return {
      settings: mergeSettings(defaultSiteSettings, row.settings),
      rawSettings: row.settings,
      updatedAt: row.updated_at,
      revision: settingsRevision(row.settings, row.updated_at),
    };
  }
  const rawSettings = await readJsonFile(settingsFile, {});
  return { settings: mergeSettings(defaultSiteSettings, rawSettings), rawSettings, updatedAt: null, revision: settingsRevision(rawSettings) };
}

async function saveAdminSettingsIfUnchanged(nextSettings, expectedRevision) {
  if (typeof expectedRevision !== "string" || !/^"[a-f0-9]{64}"$/.test(expectedRevision))
    throw new OrderError("Refresh the admin settings before saving.", 428);
  const snapshot = await readAdminSettingsSnapshot();
  if (snapshot.revision !== expectedRevision)
    throw new OrderError("The settings changed in another session. Refresh before trying again.", 409);
  try { validateMenuSettings(nextSettings, snapshot.rawSettings); }
  catch (error) { throw new OrderError(error.message, 422); }
  const mergedSettings = mergeSettings(defaultSiteSettings, nextSettings);
  if (hasSupabase()) {
    // A real PostgREST conditional PATCH, not an old snapshot upsert.
    // Only the version read above can be changed; concurrent owner edits win.
    const query = "/cafe_elite_settings?id=eq.main&updated_at=eq." + encodeURIComponent(snapshot.updatedAt);
    const rows = await supabaseRequest(query, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ settings: mergedSettings, updated_at: new Date().toISOString() }),
    });
    if (!Array.isArray(rows) || rows.length !== 1)
      throw new OrderError("The settings were edited elsewhere. Refresh before saving.", 409);
    return { settings: mergeSettings(defaultSiteSettings, rows[0].settings), revision: settingsRevision(rows[0].settings, rows[0].updated_at) };
  }
  // The local-only file path is a development convenience, not production CAS.
  await writeJsonFile(settingsFile, mergedSettings);
  return { settings: mergedSettings, revision: settingsRevision(mergedSettings) };
}

async function saveSettings(settings) {
  const mergedSettings = mergeSettings(defaultSiteSettings, settings);

  if (hasSupabase()) {
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
    return mergedSettings;
  }

  await writeJsonFile(settingsFile, mergedSettings);
  return mergedSettings;
}

function isAdminRequest(request) {
  const given = request.headers["x-admin-password"];
  if (!adminPassword || typeof given !== "string" || given.length > 1024) return false;
  // Fixed-size digest comparison avoids byte-by-byte password timing leaks.
  return timingSafeEqual(createHash("sha256").update(given).digest(), createHash("sha256").update(adminPassword).digest());
}

function requireAdmin(request, response) {
  if (previewMode && !adminPassword) {
    response.writeHead(503, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "Admin login is unavailable in this preview: the existing ADMIN_PASSWORD must be configured locally. No credentials have been changed." }));
    return false;
  }
  if (isAdminRequest(request)) return true;
  response.writeHead(401, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: "Admin password is required" }));
  return false;
}

async function loadOrderingSettings() {
  if (hasSupabase()) {
    const rows = await supabaseRequest("/cafe_elite_settings?id=eq.main&select=settings&limit=1");
    const remote = rows?.[0]?.settings;
    if (!remote || typeof remote !== "object" || Array.isArray(remote))
      throw new Error("Authoritative site settings are unavailable.");
    return mergeSettings(defaultSiteSettings, remote);
  }
  let saved = {};
  try { saved = JSON.parse(await readFile(settingsFile, "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  return mergeSettings(defaultSiteSettings, saved);
}

async function loadOrders() { return orderStore.list(); }

async function updateOrderStatus(orderId, status) {
  if (!["new", "pending", "preparing", "completed", "cancelled", "paid"].includes(status)) throw new OrderError("Invalid order status.");
  if (!await orderStore.get(orderId)) {
    const legacy = (await orderStore.list()).find(order => order.id === orderId);
    if (!legacy) throw new OrderError("Order could not be found.", 404);
    await orderStore.insert({ ...legacy, revision: 0 });
  }
  await changeOrder(orderStore, orderId, order => {
    if (["online", "paid-online"].includes(order.type) && order.pricing && order.paymentState !== "paid" && status !== "cancelled") throw new OrderError("Online payment has not been verified.", 409);
    return { status };
  });
  return { ok: true, id: orderId, status };
}

function jsonReply(response, status, data) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(data));
}
function apiError(response, error) {
  const known = error instanceof OrderError;
  if (!known) console.error("request_failed", new Date().toISOString());
  jsonReply(response, known ? error.status : error instanceof SyntaxError ? 400 : 503,
    { error: known ? error.message : error instanceof SyntaxError ? "Invalid request JSON." : "The service is temporarily unavailable. Please retry the same attempt." });
}

function readJson(request) {
  return readRawBody(request).then((body) => JSON.parse(body || "{}"));
}

function readRawBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let exceededLimit = false;
    request.on("data", chunk => {
      // Once rejected, drain incoming bytes without retaining more chunks.
      // A peer sending a very large body must not grow memory unboundedly.
      if (exceededLimit) return;
      size += chunk.length;
      if (size > 100_000) {
        exceededLimit = true;
        chunks.length = 0;
        reject(new OrderError("Request is too large.", 413));
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => { if (!exceededLimit) resolve(Buffer.concat(chunks).toString("utf8")); });
    request.on("error", reject);
  });
}

async function createCheckoutSession(request, response) {
  try {
    if (!stripeSecretKey) throw new OrderError("Online payment is currently unavailable.", 503);
    const result = await orderService.checkout(await readJson(request));
    if (safety.staging) {
      const order = await orderStore.get(result.orderId);
      if (order?.checkoutOrigin !== safety.origin || !/^cs_test_[A-Za-z0-9]+$/.test(order?.stripeSessionId || "")) throw new OrderError("Staging checkout requires a new local TEST attempt.", 409);
    }
    jsonReply(response, 200, result);
  } catch (error) { apiError(response, error); }
}

async function createCollectionOrder(request, response) {
  try { jsonReply(response, 200, await orderService.collection(await readJson(request))); }
  catch (error) { apiError(response, error); }
}

async function sendOrderEmail({ subject, text, idempotencyKey }) {
  assertNotificationsAllowed(safety);
  // Owner-approved provider: Resend only. Never silently send order notes to
  // SMTP/FormSubmit when Resend is unavailable or not configured.
  if (!resendApiKey || !resendFromEmail || !orderNotificationEmail) {
    throw new Error("Order notification provider is not configured. The saved order requires staff review.");
  }
  // Retry only the same provider with the same documented idempotency key.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await sendResendMail({ subject, text, idempotencyKey });
      return;
    } catch (error) {
      if (attempt === 1) throw error;
    }
  }
}

async function stripeApi(pathname, options = {}) {
  assertStagingStripeRequest(safety, stripeSecretKey, pathname, options.body);
  const stripeResponse = await fetch(`https://api.stripe.com/v1${pathname}`, {
    ...options,
    ...(safety.staging ? { redirect: "error" } : {}),
    signal: AbortSignal.timeout(15_000),
    headers: {
      Authorization: `Bearer ${stripeSecretKey}`,
      ...(options.headers || {}),
    },
  });

  const data = await stripeResponse.json();
  if (!stripeResponse.ok) throw new OrderError("Secure payment is temporarily unavailable. Retry this same attempt.", 502);
  assertStagingStripeSession(safety, data);
  return data;
}

function buildContacts(orders) {
  return buildMarketingContacts(orders);
}

async function sendResendMail({ subject, text, idempotencyKey }) {
  assertNotificationsAllowed(safety);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    signal: AbortSignal.timeout(10_000),
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

async function handleStripeWebhook(request, response) {
  try {
    const payload = await readRawBody(request);
    verifyWebhook(payload, request.headers["stripe-signature"], stripeWebhookSecret);
    const event = JSON.parse(payload);
    if (safety.staging) {
      if (event.livemode !== false) throw new OrderError("Staging accepts TEST events only.");
      if (event.type?.startsWith("checkout.session.")) assertStagingStripeSession(safety, event.data?.object);
    }
    const order = await orderService.event(event);
    // Acknowledge only after the paid state and event id are durably persisted.
    jsonReply(response, 200, { received: true });
    if (order) void orderService.notifyOnce(order.id);
  } catch (error) { apiError(response, error); }
}

async function serveStatic(request, response) {
  const reject = (status, message) => {
    if (status === 405) response.setHeader("Allow", "GET, HEAD");
    response.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
    response.end(message);
  };
  // Integrates the live a79057b security fix: one decode, trusted path base,
  // explicit public resources, no Windows aliases/traversal and realpath checking.
  const rawPath = (request.url || "/").split(/[?#]/, 1)[0];
  let decodedPath;
  try { decodedPath = decodeURIComponent(rawPath); }
  catch { return reject(400, "Bad request"); }
  if (!decodedPath.startsWith("/") || decodedPath.startsWith("//") || /[\\:\x00-\x1f\x7f]/.test(decodedPath)) return reject(400, "Bad request");
  if (decodedPath.split("/").some(part => part === ".." || (part !== "." && /[. ]$/.test(part)) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) return reject(400, "Bad request");
  const path = posix.normalize(decodedPath).replace(/^\/+/, "") || "index.html";
  const publicFiles = new Set(["index.html", "admin.html", "admin.js", "admin-refinements.css", "styles.css", "ux-refinements.css", "script.js", "menu-data.mjs", "site-settings.mjs", "collection-time.mjs", "basket-view.mjs", "basket-storage.mjs", "order-notes-consent.mjs", "order-catalogue.mjs", "order-reference.mjs", "smart-pasta-deals.mjs", "public-content.mjs", "public-allergen-sources.mjs", "partial-allergen-hints.mjs", "success.html", "success.js", "privacy.html", "terms.html", "allergens.html", "menu-management.mjs", "public-asset-allowlist.mjs", "manager-ui.mjs", "manager-icons.mjs", "manager.webmanifest"]);
  if (!publicFiles.has(path) && !isApprovedPublicAsset(path)) return reject(404, "Not found");
  if (!["GET", "HEAD"].includes(request.method)) return reject(405, "Method not allowed");

  try {
    const rootReal = await realpath(root);
    const filePath = await realpath(resolve(root, path));
    const actualRelative = relative(rootReal, filePath).split(sep).join("/");
    // Symlinks and junctions must never turn a public URL into private bytes.
    if (actualRelative !== path) return reject(404, "Not found");
    let body = await readFile(filePath);
    if (path === "index.html") {
      const settings = await loadOrderingSettings();
      body = renderPublicPage(body.toString(), buildMenuData(settings), settings);
    }
    if (["admin.html", "success.html"].includes(path)) response.setHeader("X-Robots-Tag", "noindex, nofollow");
    response.writeHead(200, {
      "content-type": path === "manager.webmanifest" ? "application/manifest+json" : contentTypes[extname(filePath).toLowerCase()] || "application/octet-stream",
    });
    response.end(request.method === "HEAD" ? undefined : body);
  } catch (error) {
    if (["ENOENT", "ENOTDIR", "ELOOP", "EPERM", "EACCES"].includes(error?.code)) return reject(404, "Not found");
    // An authoritative settings database outage is not a missing page:
    // never pretend the order site is healthy or silently use stale defaults.
    apiError(response, error);
  }
}

async function handleRequest(request, response) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader("Content-Security-Policy", "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https://www.google.com https://maps.googleapis.com; connect-src 'self'; frame-src https://www.google.com https://maps.google.com");
  if (!previewMode && !safety.staging) response.setHeader("Strict-Transport-Security", "max-age=31536000");
  if (previewMode) {
    const allowed = ["/api/health", "/api/settings", "/api/menu", "/api/admin/settings", "/api/admin/orders", "/api/admin/contacts"];
    if ((request.method !== "GET" && !(request.method === "POST" && request.url === "/api/admin/settings")) || !allowed.includes(request.url)) {
      response.writeHead(403, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "Preview only. Order, payment and customer-message submissions are blocked." }));
      return;
    }
  }
  if (request.method === "POST" && ["/api/collection-order", "/api/create-checkout-session"].includes(request.url)) {
    if (request.headers["content-type"]?.split(";")[0].trim().toLowerCase() !== "application/json") {
      jsonReply(response, 415, { error: "Please send this order as JSON." }); return;
    }
    const now = Date.now();
    for (const [key, value] of writeLimits) if (value.until <= now) writeLimits.delete(key);
    // Actual peer only, never untrusted forwarded IPs. Behind a proxy this is a
    // shared safety ceiling, not distributed per-customer abuse protection.
    const peer = request.socket.remoteAddress || "unknown";
    const entry = writeLimits.get(peer) || { count: 0, until: now + 60_000 };
    entry.count++;
    if (writeLimits.size >= 5000 || entry.count > 120) {
      response.setHeader("Retry-After", "60");
      jsonReply(response, 429, { error: "Too many order attempts. Please wait a minute before retrying." }); return;
    }
    writeLimits.set(peer, entry);
  }
  if (request.method === "GET" && request.url === "/api/health") {
    console.log("Health check received");
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, service: "CAFE ELITE" }));
    return;
  }

  if (request.method === "GET" && ["/robots.txt", "/sitemap.xml"].includes(request.url)) {
    const sitemap = request.url === "/sitemap.xml";
    response.writeHead(200, { "content-type": sitemap ? "application/xml; charset=utf-8" : "text/plain; charset=utf-8" });
    response.end(sitemap ? sitemapXml() : robotsText());
    return;
  }

  if (request.method === "GET" && request.url.startsWith("/api/payment-status?")) {
    const id = new URL(request.url, "http://localhost").searchParams.get("session_id");
    if (!stripeSecretKey || !/^cs_(?:test|live)_[A-Za-z0-9]{10,200}$/.test(id || "")) {
      response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "Payment could not be verified. Please speak to the cafe before placing another order." }));
      return;
    }
    try {
      const session = await stripeApi(`/checkout/sessions/${encodeURIComponent(id)}`);
      jsonReply(response, 200, await orderService.paymentStatus(session));
    } catch {
      response.writeHead(502, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "We could not verify your payment. Please speak to the cafe before paying again." }));
    }
    return;
  }

  if (request.method === "GET" && request.url === "/api/settings") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(await loadSettings()));
    return;
  }

  if (request.method === "GET" && request.url === "/api/menu") {
    const settings = await loadSettings();
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(buildMenuData(settings)));
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
    try {
      const snapshot = await readAdminSettingsSnapshot();
      response.setHeader("ETag", snapshot.revision);
      jsonReply(response, 200, snapshot.settings);
    } catch (error) { apiError(response, error); }
    return;
  }

  if (request.method === "POST" && request.url === "/api/admin/settings") {
    if (!requireAdmin(request, response)) return;
    try {
      const settings = await readJson(request);
      const saved = await saveAdminSettingsIfUnchanged(settings, request.headers["if-match"]);
      response.setHeader("ETag", saved.revision);
      jsonReply(response, 200, saved.settings);
    } catch (error) { apiError(response, error); }
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
}
const server = createServer((request, response) => {
  handleRequest(request, response).catch(error => {
    if (!response.headersSent) apiError(response, error);
    else response.end();
  });
});
server.requestTimeout = 20_000;
server.headersTimeout = 10_000;
server.listen(port, previewMode || safety.staging || isolatedTest ? "127.0.0.1" : "0.0.0.0", () => {
  if (previewMode && process.send) process.send({ previewPort: server.address().port });
  console.log("CAFE ELITE server ready on port " + server.address().port);
});
if (previewMode) process.on("disconnect", () => server.close(() => process.exit(0)));
if (!previewMode && !safety.notificationsDisabled) {
  let draining = false;
  const notifications = setInterval(async () => {
    if (draining) return;
    draining = true;
    try { await orderService.drainNotifications(); }
    finally { draining = false; }
  }, 30_000);
  notifications.unref();
  server.on("close", () => clearInterval(notifications));
}
