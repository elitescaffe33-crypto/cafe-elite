import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {visibleOrderReference} from "../order-reference.mjs";
import {fromRow,toRow} from "../order-store.mjs";
import {createOrderService,stripeCheckoutParams} from "../order-service.mjs";

const uuid="eac56068-0caf-447f-95e7-5633b7840535";
function order(){
 return {id:uuid,orderNumber:10042,createdAt:"2026-10-28T08:19:00Z",type:"paid-online",
  payment:"Stripe",paymentState:"paid",status:"paid",amount:"1.99 GBP",collectionTime:"08:19",
  customerName:"Test Customer",phone:"07000000000",email:"",items:"1x Muffin",notes:"",
  message:"Old internal message",notificationStatus:"pending",revision:0,
  pricing:{currency:"gbp",total:199,checkoutItems:[{quantity:1,unitPrice:199,displayName:"Blueberry muffin",category:"Muffin"}]},
  stripeSessionId:"cs_live_SYNTHETIC999",fingerprint:"test-only"};
}
test("every assigned five-digit reference is displayed as five digits",()=>{
 assert.equal(visibleOrderReference(order()),"10042");
 assert.equal(visibleOrderReference({...order(),orderNumber:10000}),"10000");
 assert.equal(visibleOrderReference({...order(),orderNumber:99999}),"99999");
});
test("no invented or colliding number for old rows",()=>{
 assert.equal(visibleOrderReference({...order(),orderNumber:null}),uuid);
 assert.equal(visibleOrderReference({...order(),orderNumber:9999}),uuid);
 assert.equal(visibleOrderReference({...order(),orderNumber:100000}),uuid);
 assert.equal(visibleOrderReference({}),"");
});
test("DB number is read from dedicated column; never client-written on insert/update",()=>{
 const raw={id:uuid,created_at:"2026-10-28T08:19:00Z",type:"paid-online",payment:"Stripe",status:"paid",
    stripe_session_id:"cs_live_SYNTHETIC999",amount:"1.99 GBP",customer_name:"Test Customer",
    phone:"07000000000",email:"",collection_time:"08:19",items:"1x Muffin",notes:"",message:"Old",
    revision:0,order_data:{orderNumber:55555},order_number:10042};
 const parsed=fromRow(raw);
 assert.equal(parsed.orderNumber,10042);
 assert.equal(visibleOrderReference(parsed),"10042");
 assert.equal(toRow(parsed).id,uuid);
 assert.ok(!Object.hasOwn(toRow(parsed),"order_number"));
 assert.equal(toRow(parsed).order_data.orderNumber,10042);
});
test("Stripe metadata and idempotency continue to use the original UUID",()=>{
 const params=stripeCheckoutParams(order(),"https://www.cafeelite.co.uk");
 assert.equal(params.get("client_reference_id"),uuid);
 assert.equal(params.get("metadata[order_id]"),uuid);
 assert.equal(params.get("line_items[0][price_data][unit_amount]"),"199");
});
test("paid notification uses five-digit number while preserving delivery idempotency",async()=>{
 let saved=order();const messages=[];
 const store={get:async(id)=>id===uuid?structuredClone(saved):null,
   cas:async(previous,next)=>{if(previous.revision!==saved.revision)return null;saved=structuredClone(next);return structuredClone(saved)},
   list:async()=>[structuredClone(saved)]};
 const service=createOrderService({store,loadSettings:async()=>({}),buildMenuData:()=>[],
    createStripeSession:()=>{throw Error("Not called");},
    notify:async(x)=>messages.push(x),origin:"https://www.cafeelite.co.uk",
    now:()=>new Date("2026-10-28T08:20:00Z")});
 await service.notifyOnce(uuid);
 assert.equal(messages.length,1);
 assert.match(messages[0].text,/Reference: 10042/);
 assert.doesNotMatch(messages[0].text,new RegExp(uuid));
 assert.equal(messages[0].idempotencyKey,"order-notification-"+uuid);
 assert.equal(saved.notificationStatus,"sent");
 await service.notifyOnce(uuid);
 assert.equal(messages.length,1);
});
test("paid status returns short customer code with independently verified Stripe binding",async()=>{
 const data=order();const store={get:async()=>data};
 const service=createOrderService({store,loadSettings:async()=>({}),buildMenuData:()=>[],
   createStripeSession:()=>{},notify:async()=>{},origin:"https://www.cafeelite.co.uk"});
 const session={id:data.stripeSessionId,metadata:{order_id:uuid,source:"CAFE ELITE website"},
   client_reference_id:uuid,mode:"payment",currency:"gbp",amount_total:199,payment_status:"paid"};
 assert.deepEqual(await service.paymentStatus(session),{paid:true,orderReference:"10042",collectionTime:"08:19"});
 assert.equal((await service.paymentStatus({...session,amount_total:200})).paid,false);
});
test("public order and manager surfaces use display code; internal action IDs stay UUID",async()=>{
 const root=new URL("../",import.meta.url);
 const [server,admin,client]=await Promise.all(
   ["order-service.mjs","admin.js","script.js"].map(p=>readFile(new URL(p,root),"utf8")));
 assert.match(server,/orderReference: visibleOrderReference\(order\)/);
 assert.match(server,/Reference: \$\{visibleOrderReference\(order\)\}/);
 assert.match(admin,/Order #:.*visibleOrderReference\(order\)/);
 assert.match(admin,/data-order-id="\$\{escapeHtml\(orderId\)\}"/);
 assert.match(client,/Reference: \$\{result\.orderReference \|\| result\.orderId\}/);
});
test("operator SQL is locked, transactional and refuses number reuse",async()=>{
 const sql=await readFile(new URL("../scripts/order-display-number-LOCKED-DRAFT.sql",import.meta.url),"utf8");
 assert.match(sql,/SET LOCAL cafe_elite\.target_ref = 'UNCONFIRMED';/);
 assert.match(sql,/SET LOCAL cafe_elite\.owner_approval = 'NOT_APPROVED';/);
 assert.match(sql,/__EXPECTED_ORDER_COUNT__/);
 assert.match(sql,/^BEGIN;/m);
 assert.match(sql,/^COMMIT;/m);
 assert.match(sql,/LOCK TABLE public\.cafe_elite_orders IN ACCESS EXCLUSIVE MODE/);
 assert.match(sql,/MINVALUE 10000 MAXVALUE 99999 NO CYCLE CACHE 1/);
 assert.match(sql,/order_number_unique UNIQUE \(order_number\)/);
 assert.match(sql,/GRANT USAGE ON SEQUENCE public\.cafe_elite_order_number_seq TO service_role/);
 assert.doesNotMatch(sql,/DROP TABLE public\.cafe_elite_orders|TRUNCATE public\.cafe_elite_orders/i);
});
test("client module is explicitly served but server internals stay behind allowlist",async()=>{
 const server=await readFile(new URL("../server.mjs",import.meta.url),"utf8");
 assert.match(server,/"order-reference\.mjs"/);
 assert.doesNotMatch(server,/publicFiles = new Set\(\[[^\]]*order-service\.mjs/);
});
