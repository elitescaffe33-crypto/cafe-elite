import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";
import {
  createCachedOrderListStore, ORDER_LIST_CACHE_TTL_MS,
} from "../order-list-cache.mjs";
import {createOrderService} from "../order-service.mjs";

function fixture() {
  let tick = 0;
  let reads = 0;
  const rows = [
    {id:"order-01",status:"paid",notificationStatus:"sent",createdAt:"2026-11-16T11:00:00Z",items:"1x Pasta",customerName:"Guest"},
  ];
  const get = id => rows.find(order=>order.id===id);
  const store={
    async list(){reads++;return rows.map(row=>structuredClone(row));},
    async get(id){const row=get(id);return row?structuredClone(row):null;},
    async insert(row){if(!get(row.id))rows.push(structuredClone(row));return this.get(row.id);},
    async cas(previous,next){
      const index=rows.findIndex(row=>row.id===previous.id&&row.revision===previous.revision);
      if(index<0)return null;
      rows[index]=structuredClone(next);
      return structuredClone(next);
    },
    async applyWebhook(previous,event,changes){
      const index=rows.findIndex(row=>row.id===previous.id);
      if(index<0)return null;
      rows[index]={...rows[index],...changes};
      return structuredClone(rows[index]);
    },
  };
  return {
    store,
    cached:createCachedOrderListStore(store,{now:()=>tick,ttlMs:ORDER_LIST_CACHE_TTL_MS}),
    advance:ms=>{tick+=ms;},
    reads:()=>reads,
    rows,
  };
}

test("One 5-minute read serves both 8-second printer and 30-second notification polls",async()=>{
  const p=fixture();
  for(let second=0;second<3600;second++){
    p.advance(1000);
    if(second%8===0)await p.cached.list();
    if((second+1)%30===0)await p.cached.list();
  }
  assert.equal(p.reads(),12,"Should query Supabase at most twelve times in an idle hour");
  assert.ok(p.reads()<570/30,"More than 95% fewer full-table reads");
  assert.equal(ORDER_LIST_CACHE_TTL_MS,5*60*1000);
});

test("Insert immediately invalidates cache and lets printer find new order on next read",async()=>{
  const p=fixture();
  await p.cached.list();
  assert.equal(p.reads(),1);
  const now=await p.cached.insert({
    id:"order-02",status:"pending",notificationStatus:"pending",
    createdAt:"2026-11-16T12:00:00Z",items:"1x Coffee",revision:0,
  });
  assert.equal(now.id,"order-02");
  assert.deepEqual((await p.cached.list()).map(x=>x.id),["order-01","order-02"]);
  assert.equal(p.reads(),2);
});

test("Paid webhook immediately invalidates pending/paid order state",async()=>{
  const p=fixture();
  await p.cached.list();
  const previous=await p.cached.get("order-01");
  const paid=await p.cached.applyWebhook(previous,{id:"evt-synthetic"},{
    status:"paid",notificationStatus:"pending",paymentState:"paid",
  });
  assert.equal(paid.notificationStatus,"pending");
  const rows=await p.cached.list();
  assert.equal(rows[0].notificationStatus,"pending");
  assert.equal(p.reads(),2);
});

test("Manager status changes immediately invalidate and do not resurrect cancelled orders",async()=>{
  const p=fixture();
  p.rows[0].revision=0;
  await p.cached.list();
  const before=await p.cached.get("order-01");
  await p.cached.cas(before,{...before,revision:1,status:"cancelled"});
  const rows=await p.cached.list();
  assert.equal(rows[0].status,"cancelled");
  assert.equal(p.reads(),2);
});

test("Failed or ambiguous write invalidates twice, forcing a fresh authoritative read",async()=>{
  let count=0;
  const store={
    async list(){count++;return [{id:"A",seq:count}]},
    async insert(){throw new Error("Ambiguous database timeout");},
  };
  const cached=createCachedOrderListStore(store);
  assert.equal((await cached.list())[0].seq,1);
  await assert.rejects(cached.insert({id:"B"}),/Ambiguous/);
  assert.equal((await cached.list())[0].seq,2);
});

test("Concurrent reads share the same in-flight Supabase request, without leaking object mutations",async()=>{
  let calls=0, release;
  const store={list(){calls++;return new Promise(resolve=>{release=resolve;});}};
  const cache=createCachedOrderListStore(store);
  const pending=Array.from({length:20},()=>cache.list());
  await Promise.resolve();await Promise.resolve();
  assert.equal(calls,1);
  release([{id:"secret-data",status:"pending",details:{customerName:"X"}}]);
  const results=await Promise.all(pending);
  assert.equal(results.length,20);
  results[0][0].details.customerName="MUTATED";
  results[0].push({id:"new"});
  assert.equal((await cache.list()).length,1);
  assert.equal((await cache.list())[0].details.customerName,"X");
  assert.equal(calls,1);
});

test("Write during an in-flight list cannot refill cache with stale data",async()=>{
  let resolveFirst,reads=0;
  const rows=[{id:"old",status:"pending"}];
  const store={
    list(){
      reads++;
      if(reads===1)return new Promise(resolve=>{resolveFirst=resolve});
      return Promise.resolve(structuredClone(rows));
    },
    async insert(row){rows.push(row);return row;},
  };
  const cached=createCachedOrderListStore(store);
  const inFlight=cached.list();
  await Promise.resolve();await Promise.resolve();
  assert.equal(reads,1);
  await cached.insert({id:"new",status:"pending"});
  const latest=await cached.list();
  assert.deepEqual(latest.map(x=>x.id),["old","new"]);
  resolveFirst([{id:"old",status:"pending"}]);
  assert.deepEqual((await inFlight).map(x=>x.id),["old","new"]);
  assert.equal(reads,2);
  assert.deepEqual((await cached.list()).map(x=>x.id),["old","new"]);
});

test("TTL expiry and clock rollback refresh, while an idle cache never grows unbounded",async()=>{
  const p=fixture();
  await p.cached.list();
  p.advance(5*60*1000-1);
  await p.cached.list();
  assert.equal(p.reads(),1);
  p.advance(1);
  await p.cached.list();
  assert.equal(p.reads(),2);
});

test("Rejecting Supabase reads are not served from a stale cache",async()=>{
  let t=0,reads=0;
  const store={async list(){reads++;if(reads>=2)throw new Error("DB not available");return [{id:"ok"}]}};
  const c=createCachedOrderListStore(store,{now:()=>t,ttlMs:1000});
  assert.equal((await c.list())[0].id,"ok");
  t=1200;
  await assert.rejects(c.list(),/DB not available/);
  await assert.rejects(c.list(),/DB not available/);
  assert.equal(reads,3);
});

test("Cache validates storage contract and TTL bounds",()=>{
  assert.throws(()=>createCachedOrderListStore(null),/provide list/);
  assert.throws(()=>createCachedOrderListStore({}),/provide list/);
  assert.throws(()=>createCachedOrderListStore({list:()=>[]},{ttlMs:999}),/TTL/);
  assert.throws(()=>createCachedOrderListStore({list:()=>[]},{ttlMs:300001}),/TTL/);
});

test("Notification recovery remains idempotent and sees outstanding pending orders",async()=>{
  const p=fixture();
  p.rows[0]={
    id:"order-01",revision:0,status:"pending",paymentState:"pay_on_collection",
    payment:"Pay on collection",amount:"1.99 GBP",createdAt:"2026-11-16T11:00:00Z",
    customerName:"Test",phone:"07000000000",email:"",collectionTime:"11:15",
    items:"1x Coffee - 1.99 GBP",notes:"",notificationStatus:"pending",
  };
  const sent=[];
  const service=createOrderService({
    store:p.cached,notificationsDisabled:false,
    origin:"https://example.test",now:()=>new Date("2026-11-16T11:00:00Z"),
    loadSettings:async()=>({}),buildMenuData:async()=>[],
    createStripeSession:async()=>{throw Error("Not used");},
    notify:async mail=>{sent.push(mail.subject);},
  });
  // Printer reads may have cached the list before notification retry.
  await p.cached.list();
  await service.drainNotifications();
  assert.equal(sent.length,1);
  assert.equal((await p.cached.get("order-01")).notificationStatus,"sent");
  await service.drainNotifications();
  assert.equal(sent.length,1,"Recovery must not generate a duplicate email");
});

test("Production server caches list reads, but staging/preview code paths are uncached",async()=>{
  const server=await readFile(new URL("../server.mjs",import.meta.url),"utf8");
  assert.match(server,/import \{ createCachedOrderListStore \} from "\.\/order-list-cache\.mjs"/);
  assert.match(server,/const rawOrderStore = hasSupabase\(\) \? createSupabaseOrderStore\(supabaseRequest\)/);
  assert.match(server,/const orderStore = hasSupabase\(\) && !safety\.staging\s*\? createCachedOrderListStore\(rawOrderStore\)/);
  assert.match(server,/async function loadOrders\(\) \{ return orderStore\.list\(\); \}/);
  assert.match(server,/orderService\.drainNotifications\(\)/);
  assert.match(server,/30_000/);
  const bridge=await readFile(new URL("../printer-bridge.mjs",import.meta.url),"utf8");
  assert.match(bridge,/PRINTER_POLL_SECONDS \|\| 8/);
  assert.match(bridge,/\/api\/admin\/orders/);
  assert.doesNotMatch(server,/publicFiles = new Set\(\[[^\]]*order-list-cache\.mjs/);
});

test("No payment, email, order-creation or receipt code was modified to achieve the reduction",async()=>{
  const server=await readFile(new URL("../server.mjs",import.meta.url),"utf8");
  assert.match(server,/createOrderService\(\{ store: orderStore/);
  assert.match(server,/if \(request\.method === "GET" && request\.url === "\/api\/admin\/orders"\)/);
  assert.match(server,/if \(request\.method === "POST" && request\.url === "\/api\/admin\/order-status"\)/);
  assert.match(server,/Stripe/);
});
