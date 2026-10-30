import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {runInNewContext} from "node:vm";
import {renderReceiptMarkup} from "../receipt-layout.mjs";

const files=await Promise.all([
 "admin.html","admin.js","admin-refinements.css","index.html",
 "script.js","ux-refinements.css","manager.webmanifest","server.mjs",
].map(f=>readFile(new URL("../"+f,import.meta.url),"utf8")));
const [manager,admin,managerCSS,publicHTML,publicJS,publicCSS,manifest,server]=files;
const mockOrder={
 id:"00000000-0000-4000-8000-000000000000",orderNumber:10046,
 createdAt:"2026-10-30T21:58:00Z",collectionTime:"21:59",
 customerName:"Example Customer",phone:"07000000000",
 type:"pay-on-collection",paymentState:"pay_on_collection",status:"new",
 items:"1x Bolognese Pasta - 8.99 GBP",amount:"8.99 GBP",notes:"",
};
function between(src,start,end){
 const s=src.indexOf(start),e=src.indexOf(end,s+start.length);
 assert.ok(s>=0&&e>s,"function markers missing");
 return src.slice(s,e).trim();
}
test("PWA uses standalone scope so it needs explicit in-app navigation",()=>{
 const conf=JSON.parse(manifest);
 assert.equal(conf.display,"standalone");
 assert.equal(conf.start_url,"/admin.html");
 assert.equal(conf.scope,"/");
 assert.match(manager,/id="managerBack" type="button" aria-label="Back to previous Manager section"/);
 assert.match(manager,/data-icon="chevron-left"/);
 assert.match(managerCSS,/\.manager-topbar #managerBack:not\(\[hidden\]\)/);
 assert.match(managerCSS,/min-height:44px/);
});
test("Website link is returnable from app, not a one-way in-scope navigation",()=>{
 assert.match(manager,/<a href="index\.html\?from=manager">/);
 assert.match(publicHTML,/id="returnToManager" class="manager-return-link" href="admin\.html#overview" hidden/);
 assert.match(publicCSS,/\.manager-return-link\[hidden\] \{ display:none!important;/);
 assert.match(publicCSS,/\.manager-return-link \{/);
 assert.match(publicJS,/new URLSearchParams\(window\.location\.search\)\.get\("from"\) === "manager"/);
 assert.match(publicJS,/returnToManager\.href = "admin\.html" \+ section/);
});
function simulatePublicReturn(search,saved){
 const link={hidden:true,href:"admin.html#overview"};
 const ctx={window:{location:{search}},
   URLSearchParams,
   sessionStorage:{getItem(){return saved}},
   document:{querySelector(sel){assert.equal(sel,"#returnToManager");return link;}}
 };
 const source=between(publicJS,
   'const returnToManager = document.querySelector("#returnToManager");',
   "setupBackgroundMusic();");
 runInNewContext(source,ctx);
 return link;
}
test("Only website visits from Manager show return link",()=>{
 const normal=simulatePublicReturn("","");
 assert.equal(normal.hidden,true);
 assert.equal(normal.href,"admin.html#overview");
 const via=simulatePublicReturn("?from=manager","#settings");
 assert.equal(via.hidden,false);
 assert.equal(via.href,"admin.html#settings");
});
test("Owner return link accepts only known internal destinations",()=>{
 for(const route of ["#orders","#prices","#customers","#settings","#overview"]){
  const r=simulatePublicReturn("?from=manager",route);
  assert.equal(r.href,"admin.html"+route);
 }
 for(const evil of ["javascript:alert(1)","#../../private","https://evil.example","#menu/bad%2Ffoo"]){
  assert.equal(simulatePublicReturn("?from=manager",evil).href,"admin.html#overview");
 }
 assert.equal(simulatePublicReturn("?from=manager",null).href,"admin.html#overview");
});
function simulateAdminRoute(initial="#overview"){
 const panels=["overview","settings","prices","orders","customers"].map(id=>({id,hidden:true}));
 const links=["#overview","#settings","#prices","#orders","#customers"].map(hash=>({
  hash,attr:null,setAttribute(k,v){this.attr=v;},removeAttribute(k){this.attr=null;},
 }));
 const fields={};
 for(const sel of ["#pageTitle","#managerSubtitle","#managerBreadcrumb","#mobileCategoryTitle","#headingCategoryCount","#productSearch","#menuDisclosure","#ownerAccount"]){
  fields[sel]={textContent:"",hidden:true,disabled:true,open:false,classList:{toggle(){}},};
 }
 const pushed=[];const trail=[];
 let canLeave=true,closeCalled=0;
 const ctx={
  currentSectionHash:initial,
  managerSectionHistory:trail,adminPassword:"synthetic",
  narrow:{matches:true},productManager:{render(){},selectCategory(){}},
  getEffectiveMenuData(){return [];},
  canLeaveSection(){return canLeave;},
  history:{pushState(a,b,c){pushed.push(c);ctx.window.location.hash=c;},replaceState(){}},
  closeSidebar(){closeCalled++;},loadContacts(){return Promise.resolve()},
  showMessage(){},window:{location:{hash:initial},scrollTo(){}},
  document:{
   body:{classList:{toggle(){}}},
   querySelectorAll(sel){
    if(sel===".admin-grid > section")return panels;
    if(sel==='.is-admin-nav > a[href^="#"]')return links;
    throw Error("unrecognised selector: "+sel);
   },
   querySelector(sel){return fields[sel]||{classList:{toggle(){}}};},
  },
  syncManagerBackButton(){},
 };
 const fn=runInNewContext("("+between(admin,"function openAdminSection(",'window.addEventListener("hashchange"')+")",ctx);
 return {fn,ctx,trail,pushed,panels,allow(value){canLeave=value},closed:()=>closeCalled};
}
test("Back navigation uses Manager's internal section trail instead of browser back",()=>{
 const s=simulateAdminRoute();
 assert.equal(s.fn("#settings"),true);
 assert.equal(s.fn("#orders"),true);
 assert.deepEqual(s.trail,["#overview","#settings"]);
 assert.equal(s.ctx.currentSectionHash,"#orders");
 assert.equal(s.fn("#settings",{fromBack:true}),true);
 assert.equal(s.ctx.currentSectionHash,"#settings");
 assert.deepEqual(s.trail,["#overview","#settings"]);
 s.trail.pop();
 assert.deepEqual(s.trail,["#overview"]);
 assert.equal(s.ctx.window.location.hash,"#settings");
 assert.equal(s.ctx.document.querySelector("#pageTitle").textContent,"Settings");
});
test("unsaved settings prevent navigation and preserve history stack",()=>{
 const s=simulateAdminRoute("#settings");
 s.allow(false);
 assert.equal(s.fn("#orders"),false);
 assert.equal(s.ctx.currentSectionHash,"#settings");
 assert.deepEqual(s.trail,[]);
});
test("Printed receipt opens IN APP on iPhone without popup",()=>{
 const start=admin.indexOf("function printOrder(order) {");
 const end=admin.indexOf("\nfunction renderStatusButton",start);
 let modalCalls=0,popupCalls=0;
 const fn=runInNewContext("("+admin.slice(start,end)+")",{
  narrow:{matches:true},
  navigator:{standalone:true},
  window:{matchMedia:()=>({matches:true}),open(){popupCalls++;}},
  openReceiptPreview(order){modalCalls++;assert.equal(order.orderNumber,10046);},
  receiptDocument(){throw Error("Must not render desktop popup");},
  showMessage(){throw Error("No error expected");},
 });
 fn(mockOrder);
 assert.equal(modalCalls,1);
 assert.equal(popupCalls,0);
});
test("In-app receipt uses the identical premium escaped markup and has a visible Back control",()=>{
 const block=between(admin,"function openReceiptPreview(order) {","for (const id of [");
 const content={innerHTML:""};
 let shown=0,focused=0,closed=0;
 const preview={open:false,showModal(){shown++;this.open=true;},close(){closed++;this.open=false;}};
 const functions=runInNewContext(block+"\n({openReceiptPreview,closeReceiptPreview})",{
   managerReceiptContent:content,managerReceiptPreview:preview,
   renderReceiptMarkup,
   document:{querySelector(sel){assert.equal(sel,"#managerReceiptBackTop");return {focus(){focused++;}};}}
 });
 functions.openReceiptPreview(mockOrder);
 assert.equal(shown,1);
 assert.equal(focused,1);
 assert.ok(content.innerHTML.includes("#10046"));
 assert.ok(content.innerHTML.includes("£8.99"));
 functions.closeReceiptPreview();
 assert.equal(closed,1);
 assert.equal(preview.open,false);
 assert.match(manager,/id="managerReceiptBackTop" class="manager-receipt-back">← Back to Orders/);
 assert.match(manager,/id="managerReceiptBackBottom" class="manager-receipt-back">Back to Orders/);
 assert.match(manager,/id="managerReceiptPrint" class="manager-receipt-action-primary"/);
});
test("Preview printing hides the rest of Manager rather than opening unreturnable page",()=>{
 assert.match(managerCSS,/@media print \{/);
 assert.match(managerCSS,/body\.manager-shell > :not\(#managerReceiptPreview\) \{ display:none!important; \}/);
 assert.match(managerCSS,/#managerReceiptPreview \.manager-receipt-toolbar,/);
 assert.match(managerCSS,/#managerReceiptPreview \.receipt \{ width:72mm!important;/);
 assert.match(admin,/document\.querySelector\("#managerReceiptPrint"\)\.addEventListener\("click", \(\) => \{\s*if \(managerReceiptPreview\.open\) window\.print\(\);/);
});
test("Receipt closes and clears customer details at session expiry",()=>{
 assert.match(admin,/managerReceiptContent\.replaceChildren\(\)/);
 assert.match(admin,/if \(receiptDialog\.open\) receiptDialog\.close\(\)/);
 assert.match(admin,/managerReceiptPreview\.addEventListener\("close", \(\) => \{\s*managerReceiptContent\.replaceChildren\(\);/);
});
test("Changes are navigation and presentation only, existing payment endpoints stay intact",()=>{
 assert.match(server,/\/api\/create-checkout-session/);
 assert.match(server,/\/api\/collection-order/);
 assert.doesNotMatch(server,/managerReceiptPreview|returnToManager|managerBack/);
});

test("Website navigation remembers only safe section key and respects unsaved changes",()=>{
 const handler=between(admin,
  'document.querySelectorAll(\'a[href="index.html?from=manager"]\')',
  'managerBackButton.addEventListener("click"');
 let callback;
 const link={addEventListener(name,fn){assert.equal(name,"click");callback=fn;}};
 const values=[];let canLeave=true;
 const ctx={
   document:{querySelectorAll(){return [link]}},
   currentSectionHash:"#settings",
   sessionStorage:{setItem(name,value){values.push([name,value])}},
   canLeaveSection(){return canLeave;},
 };
 runInNewContext(handler,ctx);
 const prevent={called:false,preventDefault(){this.called=true;}};
 callback(prevent);
 assert.equal(prevent.called,false);
 assert.deepEqual(values,[["cafeEliteManagerReturnSection","#settings"]]);
 ctx.currentSectionHash="#menu/pasta";
 callback({preventDefault(){throw Error("Should navigate")}});
 assert.deepEqual(values.at(-1),["cafeEliteManagerReturnSection","#prices"]);
 canLeave=false;
 const event={called:false,preventDefault(){this.called=true;}};
 callback(event);
 assert.equal(event.called,true);
 assert.equal(values.length,2);
 assert.equal(handler.includes("adminPassword"),false);
});
