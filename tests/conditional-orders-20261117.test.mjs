import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { orderListRepresentation, orderListNotModified } from "../order-response-etag.mjs";

const example = Object.freeze({
  id:"00000000-0000-4000-8000-000000000123",
  createdAt:"2026-11-17T12:00:00Z",
  status:"pending",
  paymentState:"pay_on_collection",
  items:"1x Tomato Pasta - 6.99 GBP",
  customerName:"Synthetic Test",
  notificationStatus:"sent",
});

test("all 54 unchanged historic orders receive exactly the same stable validator", () => {
  const orders = Array.from({ length:54 }, (_,i) => ({ ...example, id:"id-"+i }));
  const a=orderListRepresentation(orders);
  const b=orderListRepresentation(structuredClone(orders));
  assert.equal(a.etag,b.etag);
  assert.match(a.etag,/^W\/"orderlist-[0-9a-f]{64}"$/);
  assert.equal(a.body,JSON.stringify(orders));
  assert.deepEqual(JSON.parse(a.body),orders);
  assert.ok(a.body.length>1000,"sufficient repeated fixture data for hashing");
});

test("any new order, paid webhook, cancellation, email state or content change invalidates ETag",()=>{
  const before=orderListRepresentation([example]).etag;
  const modifications=[
    { ...example,status:"cancelled" },
    { ...example,paymentState:"paid" },
    { ...example,notificationStatus:"pending" },
    { ...example,items:"2x Tomato Pasta - 13.98 GBP" },
    { ...example,customerName:"Changed" },
  ];
  for(const variant of modifications)assert.notEqual(orderListRepresentation([variant]).etag,before);
  assert.notEqual(orderListRepresentation([example,{...example,id:"new"}]).etag,before);
});
test("validator matching is opt-in and uses safe weak comparison",()=>{
  const e=orderListRepresentation([example]).etag;
  assert.equal(orderListNotModified(e,e),true);
  assert.equal(orderListNotModified(e.slice(2),e),true);
  assert.equal(orderListNotModified('"nonmatch", '+e,e),true);
  assert.equal(orderListNotModified('"wrong"',e),false);
  for(const token of [undefined,null,42,"", "*",e+"X","W/"+e,"x".repeat(4097)]) {
    assert.equal(orderListNotModified(token,e),false);
  }
  assert.throws(()=>orderListRepresentation(null),/array/);
});
test("server protects both 200 and 304 behind identical existing admin authentication",async()=>{
  const source=await readFile(new URL("../server.mjs",import.meta.url),"utf8");
  const start=source.indexOf('if (request.method === "GET" && request.url === "/api/admin/orders")');
  const end=source.indexOf('\n  if (request.method === "GET" && request.url === "/api/admin/contacts")',start);
  assert.ok(start>0&&end>start);
  const block=source.slice(start,end);
  assert.match(block,/if \(!requireAdmin\(request, response\)\) return/);
  assert.match(block,/orderListRepresentation\(await loadOrders\(\)\)/);
  assert.match(block,/orderListNotModified\(request.headers\["if-none-match"\], etag\)/);
  assert.match(block,/response.writeHead\(304\)/);
  assert.match(block,/response.writeHead\(200, \{ "content-type": "application\/json" \}\)/);
  assert.doesNotMatch(block,/console\.log\(.*(body|password|orders)/);
});
test("printer only enables conditional requests after the print ledger has been saved",async()=>{
  const source=await readFile(new URL("../printer-bridge.mjs",import.meta.url),"utf8");
  const start=source.indexOf("async function pollOrders() {");
  const end=source.indexOf("\nfunction formatReceipt(order) {",start);
  assert.ok(start>0&&end>start);
  const block=source.slice(start,end);
  assert.match(block,/lastCompletedOrderEtag = response.etag/);
  assert.ok(block.indexOf("await savePrintedIds(printedIds)")<block.indexOf("lastCompletedOrderEtag = response.etag"));
  assert.match(block,/if \(response.notModified\) return/);
  assert.match(block,/response.status === 304/);
  assert.match(block,/"If-None-Match": lastCompletedOrderEtag/);
  assert.match(block,/if \(!Array\.isArray\(data\)\) throw/);
});

function makeMockPrinter({responses,failPrint=false}={}){
  let env;
  const requests=[], printed=[], saved=[], failures=[];
  const etag=orderListRepresentation([example]).etag;
  let state={queue:[...(responses||[
    {status:200,orders:[example],etag},
    {status:304},
  ])],failPrint};
  const fetchStub=async(url,options)=>{
    requests.push({url,headers:{...options.headers}});
    const part=state.queue.shift();
    if(!part)throw Error("No more mocked HTTP responses");
    return {
      status:part.status,
      ok:part.status===200,
      headers:{get(name){return name==="etag"?(part.etag||""):null;}},
      async json(){ if(part.malformed)throw Error("Malformed response");
        return part.orders??{error:"Storage not available"}; },
    };
  };
  const context={
    siteUrl:"https://example.test",
    adminPassword:"synthetic-password",
    lastCompletedOrderEtag:"",
    isPolling:false,
    printedIds:new Set(),
    savePrintedIds:async(ids)=>saved.push([...ids]),
    printOrder:async(order)=>{
      if(state.failPrint)throw Error("Printer offline");
      printed.push(order.id);
    },
    console:{log(){},error(...parts){failures.push(parts.join(" "));}},
    Date,fetch:fetchStub,
  };
  const body=sourcePrinterSlice;
  runInNewContext(body,context);
  return{
    async poll(){return context.pollOrders();},
    context, requests, printed, saved, failures,state,etag,
  };
}
const sourcePrinterSlice=await (async()=>{
  const source=await readFile(new URL("../printer-bridge.mjs",import.meta.url),"utf8");
  const start=source.indexOf("async function pollOrders() {");
  const end=source.indexOf("\nfunction formatReceipt(order) {",start);
  return source.slice(start,end);
})();

test("realistic 200 -> print -> save -> 304 no-data sequence",async()=>{
  const p=makeMockPrinter();
  await p.poll();
  assert.equal(p.printed.length,1);
  assert.deepEqual(p.saved,[[example.id]]);
  assert.equal(p.context.lastCompletedOrderEtag,p.etag);
  assert.equal(p.requests[0].headers["If-None-Match"],undefined);
  await p.poll();
  assert.equal(p.printed.length,1);
  assert.equal(p.requests[1].headers["If-None-Match"],p.etag);
  assert.equal(p.failures.length,0);
});
test("if physical printer fails before ledger save, next request is never conditional",async()=>{
  const p=makeMockPrinter({responses:[
    {status:200,orders:[example],etag:orderListRepresentation([example]).etag},
    {status:200,orders:[example],etag:orderListRepresentation([example]).etag},
  ],failPrint:true});
  await p.poll();
  assert.equal(p.context.lastCompletedOrderEtag,"");
  assert.equal(p.printed.length,0);
  assert.equal(p.saved.length,0);
  assert.ok(p.failures.some(t=>t.includes("Printer offline")));
  p.state.failPrint=false;
  await p.poll();
  assert.equal(p.printed.length,1);
  assert.equal(p.requests[1].headers["If-None-Match"],undefined);
  assert.equal(p.context.lastCompletedOrderEtag,p.etag);
});
test("a changed collection order is printed once while previously printed IDs are skipped",async()=>{
  const next={...example,id:"new-id",status:"pending"};
  const p=makeMockPrinter({responses:[
    {status:200,orders:[example],etag:orderListRepresentation([example]).etag},
    {status:200,orders:[example,next],etag:orderListRepresentation([example,next]).etag},
    {status:304},
  ]});
  await p.poll();
  await p.poll();
  await p.poll();
  assert.deepEqual(p.printed,[example.id,next.id]);
  assert.equal(p.requests[1].headers["If-None-Match"],orderListRepresentation([example]).etag);
  assert.equal(p.requests[2].headers["If-None-Match"],orderListRepresentation([example,next]).etag);
});
test("legacy server without ETag still works and always returns the full list",async()=>{
  const p=makeMockPrinter({responses:[
    {status:200,orders:[example],etag:""},
    {status:200,orders:[example],etag:""},
  ]});
  await p.poll();
  await p.poll();
  assert.deepEqual(p.printed,[example.id]);
  assert.equal(p.context.lastCompletedOrderEtag,"");
  assert.equal(p.requests[1].headers["If-None-Match"],undefined);
});
test("malformed response never advances the validator and doesn't mark an order printed",async()=>{
  const p=makeMockPrinter({responses:[{status:200,malformed:true,etag:orderListRepresentation([example]).etag}]});
  await p.poll();
  assert.equal(p.context.lastCompletedOrderEtag,"");
  assert.equal(p.printed.length,0);
  assert.equal(p.saved.length,0);
});
test("unexpected 304 without a completed full response is not treated as a healthy print check",async()=>{
  const p=makeMockPrinter({responses:[{status:304}]});
  await p.poll();
  assert.equal(p.context.lastCompletedOrderEtag,"");
  assert.ok(p.failures.some(t=>t.includes("Unexpected unchanged")));
});

test("end-to-end real HTTP response: 401, 200 unchanged, 304, changed status -> 200, legacy clients -> 200",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"cafe-elite-print-etag-"));
  const root=fileURLToPath(new URL("../",import.meta.url));
  const records=join(dir,"order-records");
  let child=null;
  try{
    await mkdir(records);
    const file=join(records,example.id+".json");
    await writeFile(file,JSON.stringify({...example,revision:0,orderNumber:10000}),"utf8");
    const env={
      ...process.env,
      CAFE_PREVIEW_MODE:"1",
      CAFE_PREVIEW_DATA_DIR:dir,
      CAFE_ISOLATED_TEST:"0",
      ADMIN_PASSWORD:"synthetic-local-unit-test-only",
      CAFE_ELITE_ADMIN_PASSWORD:"",
      SUPABASE_URL:"",SUPABASE_SECRET_KEY:"",SUPABASE_SERVICE_ROLE_KEY:"",
      STRIPE_SECRET_KEY:"",STRIPE_WEBHOOK_SECRET:"",RESEND_API_KEY:"",
      PORT:"0",
    };
    child=spawn(process.execPath,["server.mjs"],{cwd:root,env,windowsHide:true,stdio:["ignore","pipe","pipe"]});
    const port=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error("Local server did not become ready")),12000);
      let stdout="",stderr="";
      child.stdout.on("data",bytes=>{
        stdout+=bytes.toString();
        const found=stdout.match(/CAFE ELITE server ready on port (\d+)/);
        if(found){clearTimeout(timer);resolve(Number(found[1]));}
      });
      child.stderr.on("data",bytes=>{stderr+=bytes.toString().slice(0,150);});
      child.once("exit",code=>{clearTimeout(timer);reject(new Error("Preview server exited "+code+" "+stderr.slice(0,160)));});
    });
    const endpoint="http://127.0.0.1:"+port+"/api/admin/orders";
    const unauth=await fetch(endpoint,{headers:{"If-None-Match":orderListRepresentation([example]).etag}});
    assert.equal(unauth.status,401);
    assert.equal(unauth.headers.get("etag"),null);
    const auth={"X-Admin-Password":"synthetic-local-unit-test-only"};
    const first=await fetch(endpoint,{headers:auth});
    assert.equal(first.status,200);
    assert.equal(first.headers.get("cache-control"),"no-store");
    assert.equal(first.headers.get("content-type"),"application/json");
    const tag=first.headers.get("etag");
    assert.match(tag,/^W\/"orderlist-[a-f0-9]{64}"$/);
    const orders=await first.json();
    assert.deepEqual(orders.map(x=>x.id),[example.id]);
    const same=await fetch(endpoint,{headers:{...auth,"If-None-Match":tag}});
    assert.equal(same.status,304);
    assert.equal(same.headers.get("etag"),tag);
    assert.equal((await same.text()).length,0);
    // Server-side admin status or webhook modifies the full list; the
    // next in-memory validator must not hide it.
    await writeFile(file,JSON.stringify({...example,revision:1,status:"cancelled"}),"utf8");
    const changed=await fetch(endpoint,{headers:{...auth,"If-None-Match":tag}});
    assert.equal(changed.status,200);
    assert.notEqual(changed.headers.get("etag"),tag);
    assert.equal((await changed.json())[0].status,"cancelled");
    const legacy=await fetch(endpoint,{headers:auth});
    assert.equal(legacy.status,200);
    assert.equal((await legacy.json())[0].status,"cancelled");
    const bad=await fetch(endpoint,{headers:{...auth,"If-None-Match":"W/\"garbage\""}});
    assert.equal(bad.status,200);
  }finally{
    if(child){child.kill();}
    await rm(dir,{recursive:true,force:true,maxRetries:4,retryDelay:100});
  }
});
