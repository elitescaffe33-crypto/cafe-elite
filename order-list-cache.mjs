// Reduces idle Supabase egress from frequent printer and notification polls.
// This caches read-only order listings in one Render instance. The existing
// durable Supabase database remains the single source of truth.
//
// Production requirements:
// - A successful/ambiguous write attempt invalidates before AND after execution.
// - The next poll after a successful order/payment/status change reads fresh data.
// - Single-flight deduplicates concurrent polls; stale in-flight reads cannot
//   repopulate the cache after an invalidation.
// - A limited TTL refreshes data changed outside this Render process.
// - A failing database lookup is never replaced with a stale cached success.
// - Each reader receives a deep clone, never the mutable cached value.
export const ORDER_LIST_CACHE_TTL_MS = 5 * 60 * 1000;

export function createCachedOrderListStore(store, {
  ttlMs = ORDER_LIST_CACHE_TTL_MS,
  now = () => Date.now(),
} = {}) {
  if (!store || typeof store.list !== "function") throw new TypeError("Order store must provide list().");
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1000 || ttlMs > 5 * 60 * 1000) {
    throw new RangeError("Order list cache TTL must be between 1 second and 5 minutes.");
  }

  let generation = 0;
  let cached = null;
  let loading = null;

  function invalidate() {
    generation++;
    cached = null;
    // Old requests may finish, but their generation is no longer current.
    loading = null;
  }

  async function getListing() {
    const clock = now();
    if (cached && clock >= cached.storedAt && clock < cached.expiresAt) {
      return cached.rows;
    }
    const version = generation;
    if (loading?.version === version) return loading.promise;
    const promise = Promise.resolve().then(() => store.list()).then(rows => {
      if (!Array.isArray(rows)) throw new TypeError("Order store.list() must return an array.");
      if (version === generation) {
        const storedAt = now();
        cached = { rows, storedAt, expiresAt: storedAt + ttlMs };
      }
      return rows;
    });
    loading = { version, promise };
    try {
      return await promise;
    } finally {
      if (loading?.promise === promise) loading = null;
    }
  }

  async function list() {
    // If a write races an in-flight list query, discard its potentially stale
    // result and requery. A finite retry bound prevents accidental loops.
    for (let retry = 0; retry < 3; retry++) {
      const before = generation;
      const rows = await getListing();
      if (before === generation) return structuredClone(rows);
    }
    // Heavy write activity must not prevent users from eventually reading.
    return structuredClone(await store.list());
  }

  const wrapper = { ...store, list };

  // Invalidate on attempted writes, even when network failures make the
  // database outcome uncertain. This protects new-order print freshness.
  for (const operation of ["insert", "cas", "applyWebhook"]) {
    if (typeof store[operation] !== "function") continue;
    wrapper[operation] = async (...args) => {
      invalidate();
      try {
        return await store[operation](...args);
      } finally {
        invalidate();
      }
    };
  }
  return wrapper;
}
