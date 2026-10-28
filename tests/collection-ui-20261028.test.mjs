import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {pathToFileURL,fileURLToPath} from "node:url";
import test from "node:test";
import {runInNewContext} from "node:vm";

const base=fileURLToPath(new URL("../",import.meta.url));
const {defaultSiteSettings}=await import(pathToFileURL(base+"site-settings.mjs").href);
const {getCollectionWindow,validateCollectionTime}=await import(pathToFileURL(base+"collection-time.mjs").href);
const source=await readFile(base+"script.js","utf8");
const ux=await readFile(base+"ux-refinements.css","utf8");
const manager=await readFile(base+"admin-refinements.css","utf8");
const html=await readFile(base+"index.html","utf8");
const date=str=>new Date(str);
const at1000=date("2026-10-28T10:00:00Z");
const at100005=date("2026-10-28T10:00:05Z");
test("default is 15 minutes",()=>assert.equal(defaultSiteSettings.ordering.preparationMinutes,15));
test("minimum collection time exactly 15 mins at whole minute",()=>{
 const window=getCollectionWindow(at1000,defaultSiteSettings);
 assert.equal(window.min,"10:15");assert.equal(window.available,true);
 assert.match(window.message,/may take longer during busy periods/i);
 assert.match(window.message,/choose a later time/i);
});
test("partial minute rounds up to maintain 15 full minutes",()=>assert.equal(getCollectionWindow(at100005,defaultSiteSettings).min,"10:16"));
test("server rejects under-minimum time",()=>assert.match(validateCollectionTime("10:14",at1000,defaultSiteSettings),/between 10:15/));
test("server accepts 15-minute minimum and manually chosen later time",()=>{
 assert.equal(validateCollectionTime("10:15",at1000,defaultSiteSettings),"");
 assert.equal(validateCollectionTime("10:45",at1000,defaultSiteSettings),"");
});
test("closed hours remain closed",()=>assert.equal(getCollectionWindow(date("2026-10-28T08:00:00Z"),defaultSiteSettings).available,false));
test("configured longer preparation remains respected",()=>{
 const override=structuredClone(defaultSiteSettings);
 override.ordering.preparationMinutes=30;
 assert.equal(getCollectionWindow(at1000,override).min,"10:30");
});
function simulate(clock,fieldValue,manual,step) {
 const input={value:fieldValue,setCustomValidity(x){this.error=x;},disabled:false};
 const hint={textContent:""};
 const FixedDate=class extends Date { constructor(...args){super(...(args.length?args:[clock.getTime()]));}};
 const start=source.indexOf("function syncCollectionTime() {");
 const end=source.indexOf("\nfunction validateCollectionForm()",start);
 assert.ok(start>0&&end>start);
 const ctx={Date:FixedDate,activeSettings:defaultSiteSettings,
  collectionTimeInput:input,collectionTimeManuallyChosen:manual,cartStep:step,
  getCollectionWindow,validateCollectionTime,
  document:{querySelector(selector){assert.equal(selector,"#collectionTimeHint");return hint}}};
 const fn=runInNewContext("("+source.slice(start,end).trim()+")",ctx);
 const win=fn();
 return {input,hint,win};
}
test("client preselects first available collection time",()=>assert.equal(simulate(at1000,"",false,"details").input.value,"10:15"));
test("auto-selected time advances when clock moves",()=>assert.equal(simulate(at100005,"10:15",false,"details").input.value,"10:16"));
test("customer later time never overwritten",()=>assert.equal(simulate(at1000,"10:45",true,"details").input.value,"10:45"));
test("customer invalid earlier time not silently replaced",()=>{
 const x=simulate(at1000,"10:10",true,"details");
 assert.equal(x.input.value,"10:10");assert.match(x.input.error,/between 10:15/);
});
test("payment review time not silently changed",()=>{
 const x=simulate(at100005,"10:15",false,"payment");
 assert.equal(x.input.value,"10:15");assert.match(x.input.error,/between 10:16/);
});
test("user time selection tracked on both input and change",()=>{
 assert.match(source,/if \(field === collectionTimeInput\) collectionTimeManuallyChosen = true/);
 assert.match(source,/event\.target === collectionTimeInput\) collectionTimeManuallyChosen = true/);
});
test("only final payment step shows gold enabled Stripe button",()=>{
 assert.match(html,/id="paymentStep"/);
 assert.match(html,/id="stripeCheckoutButton"/);
 assert.match(ux,/#paymentStep \.button\.stripe:not\(:disabled\)/);
 assert.match(ux,/background:linear-gradient\(120deg,#f6d17a 0%,#e3ad39 100%\)/);
});
test("order tools and status buttons are visible high-contrast on mobile",()=>{
 assert.match(manager,/\.order-history-card \.status-button \{ color:#142b3c; -webkit-text-fill-color:#142b3c/);
 assert.match(manager,/\.order-history-card \.status-button\.is-active/);
 assert.match(manager,/\.order-history-card pre:not\(\[hidden\]\) \{ white-space:pre-wrap; overflow-wrap:anywhere/);
});
