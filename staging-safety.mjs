export const STAGING_SUPABASE_URL = "https://lpuavzoaaaqvfkfuewwn.supabase.co";
export const DEFAULT_APP_PORT = 5820;

export function stagingRunnerEnvironment(local, inherited = {}) {
  const safe = {};
  for (const name of ["SystemRoot", "WINDIR", "PATH", "TEMP", "TMP"]) if (inherited[name]) safe[name] = inherited[name];
  for (const name of ["CAFE_ELITE_STAGING", "CAFE_ELITE_DISABLE_NOTIFICATIONS", "SUPABASE_URL", "SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "PUBLIC_SITE_URL", "PORT", "ADMIN_PASSWORD"]) {
    if (Object.hasOwn(local, name)) safe[name] = local[name];
  }
  if (!stagingSafety(safe).staging) throw new Error("Explicit staging flag required.");
  return safe;
}

export function stagingSafety(env) {
  for (const name of ["CAFE_ELITE_STAGING", "CAFE_ELITE_DISABLE_NOTIFICATIONS"]) {
    if (env[name] !== undefined && !["", "true", "false"].includes(env[name])) throw new Error(`Invalid ${name}; use true or false.`);
  }
  const staging = env.CAFE_ELITE_STAGING === "true";
  const notificationsDisabled = env.CAFE_ELITE_DISABLE_NOTIFICATIONS === "true";
  if (!staging) {
    if (notificationsDisabled) throw new Error("Notification disable requires explicit staging mode.");
    return Object.freeze({ staging: false, notificationsDisabled: false });
  }
  if (!notificationsDisabled) throw new Error("Staging requires notifications disabled.");
  if (env.SUPABASE_URL !== STAGING_SUPABASE_URL) throw new Error("Staging Supabase identity mismatch.");
  if (!(env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY)?.trim()) throw new Error("Staging Supabase server key missing.");
  if (env.CAFE_PREVIEW_MODE === "1") throw new Error("Staging cannot use preview/file persistence mode.");
  const port = Number(env.PORT || DEFAULT_APP_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid staging port.");
  let origin;
  try { origin = new URL(env.PUBLIC_SITE_URL); } catch { throw new Error("Staging requires explicit local PUBLIC_SITE_URL."); }
  if (origin.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(origin.hostname) || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash || Number(origin.port || 80) !== port) {
    throw new Error("Staging PUBLIC_SITE_URL must match the local HTTP listening port.");
  }
  const safety = Object.freeze({ staging: true, notificationsDisabled: true, port, origin: origin.origin });
  assertStagingStripeKey(safety, env.STRIPE_SECRET_KEY, true);
  return safety;
}

export function assertNotificationsAllowed(safety) {
  if (safety.staging || safety.notificationsDisabled) throw new Error("Real notification transport is disabled in staging.");
}

export function assertStagingStripeKey(safety, key, allowMissing = false) {
  if (!safety.staging) return;
  if (!key && allowMissing) return;
  if (typeof key !== "string" || !key.startsWith("sk_test_") || key === "sk_test_" || /\s|["']/.test(key)) {
    throw new Error("Staging requires a Stripe TEST secret key; live or unknown keys are forbidden.");
  }
}

export function assertStagingStripeRequest(safety, key, pathname, params) {
  assertStagingStripeKey(safety, key);
  if (!safety.staging) return;
  if (pathname === "/checkout/sessions") {
    for (const field of ["success_url", "cancel_url"]) {
      let url;
      try { url = new URL(params?.get(field)); } catch { throw new Error("Staging checkout redirect is invalid."); }
      if (url.origin !== safety.origin || url.username || url.password) throw new Error("Staging checkout redirect must stay local.");
    }
  } else if (!/^\/checkout\/sessions\/cs_test_[A-Za-z0-9]+$/.test(pathname)) {
    throw new Error("Staging Stripe route or session is not allowed.");
  }
}

export function assertStagingStripeSession(safety, session) {
  if (safety.staging && (session?.livemode !== false || !/^cs_test_[A-Za-z0-9]+$/.test(session?.id || ""))) {
    throw new Error("Staging refused a non-TEST Stripe session.");
  }
}
