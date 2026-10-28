import { mkdir, readFile, rename, open, unlink, readdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { OrderError } from "./order-catalogue.mjs";

const safeId = id => {
  if (typeof id !== "string" || !/^[a-zA-Z0-9-]{1,100}$/.test(id)) throw new OrderError("Invalid order reference.");
  return id;
};
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export function toRow(order) {
  return {
    id: order.id, created_at: order.createdAt, type: order.type, payment: order.payment,
    status: order.status, stripe_session_id: order.stripeSessionId || null, amount: order.amount,
    customer_name: order.customerName, phone: order.phone, email: order.email,
    collection_time: order.collectionTime, items: order.items, notes: order.notes, message: order.message,
    revision: order.revision, order_data: order,
  };
}
export function fromRow(row) {
  if (!row) return null;
  return { ...(row.order_data || {}), id: row.id, createdAt: row.created_at, type: row.type,
    payment: row.payment, status: row.status, stripeSessionId: row.stripe_session_id,
    amount: row.amount, customerName: row.customer_name, phone: row.phone, email: row.email,
    collectionTime: row.collection_time, items: row.items, notes: row.notes, message: row.message,
    orderNumber: row.order_number ?? null, revision: row.revision ?? 0 };
}

// Supabase PK insertion and revision compare-and-swap are atomic across app instances.
// Never fall back to a second write store after an ambiguous database response.
export function createSupabaseOrderStore(request) {
  return {
    async get(id) { return fromRow((await request(`/cafe_elite_orders?id=eq.${safeId(id)}&select=*&limit=1`))?.[0]); },
    async insert(order) {
      const rows = await request("/cafe_elite_orders?on_conflict=id", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=representation" }, body: JSON.stringify(toRow(order)) });
      return rows?.length ? fromRow(rows[0]) : this.get(order.id);
    },
    async cas(previous, next) {
      const rows = await request(`/cafe_elite_orders?id=eq.${safeId(previous.id)}&revision=eq.${previous.revision}`, { method: "PATCH", body: JSON.stringify(toRow(next)) });
      return rows?.length ? fromRow(rows[0]) : null;
    },
    async applyWebhook(previous, event, changes) {
      const row = await request("/rpc/cafe_elite_apply_webhook", { method: "POST", body: JSON.stringify({
        p_event_id: event.id, p_order_id: previous.id, p_session_id: event.data.object.id,
        p_event_type: event.type, p_livemode: event.livemode,
        p_expected_revision: previous.revision, p_changes: changes,
      }) });
      return fromRow(row);
    },
    async list() { return (await request("/cafe_elite_orders?select=*&order=created_at.desc&limit=500")).map(fromRow); },
  };
}

export function createFileOrderStore(directory) {
  const records = join(directory, "order-records");
  async function get(id) {
    try { return JSON.parse(await readFile(join(records, `${safeId(id)}.json`), "utf8")); }
    catch (error) { if (error.code === "ENOENT") return null; throw error; }
  }
  async function locked(id, action) {
    await mkdir(records, { recursive: true });
    const lock = join(records, `${safeId(id)}.lock`);
    let handle;
    for (let tries = 0; tries < 100; tries++) {
      try { handle = await open(lock, "wx"); break; }
      catch (error) { if (error.code !== "EEXIST") throw error; await pause(20); }
    }
    // A crash leaves the lock for operator investigation, never unsafe lock stealing.
    if (!handle) throw new OrderError("Order is still being processed. Retry the same attempt shortly.", 503);
    try { return await action(); }
    finally { await handle.close(); await unlink(lock); }
  }
  async function put(order) {
    const temp = join(records, `${safeId(order.id)}.${randomUUID()}.tmp`);
    const handle = await open(temp, "wx", 0o600);
    try { await handle.writeFile(JSON.stringify(order)); await handle.sync(); }
    finally { await handle.close(); }
    await rename(temp, join(records, `${order.id}.json`));
    return order;
  }
  return {
    get,
    insert: order => locked(order.id, async () => (await get(order.id)) || put(order)),
    cas: (previous, next) => locked(previous.id, async () => (await get(previous.id))?.revision === previous.revision ? put(next) : null),
    async list() {
      let files;
      try { files = await readdir(records); } catch (error) { if (error.code === "ENOENT") files = []; else throw error; }
      const current = await Promise.all(files.filter(file => file.endsWith(".json")).map(file => get(file.slice(0, -5))));
      let legacy = [];
      try { legacy = JSON.parse(await readFile(join(directory, "orders.json"), "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
      const ids = new Set(current.map(order => order.id));
      return [...current, ...legacy.filter(order => !ids.has(order.id))].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 500);
    },
  };
}

export async function changeOrder(store, id, update) {
  for (let tries = 0; tries < 20; tries++) {
    const previous = await store.get(id);
    if (!previous) throw new OrderError("Order could not be found.", 404);
    const changes = update(previous);
    if (!changes) return previous;
    const saved = await store.cas(previous, { ...previous, ...changes, revision: previous.revision + 1 });
    if (saved) return saved;
  }
  throw new OrderError("Order is busy. Retry the same attempt shortly.", 503);
}
