import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {pathToFileURL,fileURLToPath} from "node:url";
import {runInNewContext} from "node:vm";

const base=fileURLToPath(new URL("../",import.meta.url));
const {defaultSiteSettings}=await import(pathToFileURL(base+"site-settings.mjs").href);
const {getCollectionWindow,validateCollectionTime}=await import(pathToFileURL(base+"collection-time.mjs").href);
const source=await readFile(base+"script.js","utf8");
const ux=await readFile(base+"ux-refinements.css","utf8");
const manager=await readFile(base+"admin-refinements.css","utf8");
const html=await readFile(base+"index.html","utf8");
const terms=await readFile(base+"terms.html","utf8");
const date=s=>new Date(s);
const now=date("2026-10-28T10:00:20Z");
const expectedNotice="Please note: collection orders usually take around 15 minutes or longer to prepare, especially during busy periods.";

test("preparation estimate remains 15 minutes, not a hard minimum",()=>{
  assert.equal(defaultSiteSettings.ordering.preparationMinutes,15);
  const w=getCollectionWindow(now,defaultSiteSettings);
  assert.equal(w.available,true);
  assert.equal(w.min,"10:00");
  assert.equal(w.message,expectedNotice);
});
test("a customer may request the next minute, or one of many later times",()=>{
  for(const time of ["10:00","10:01","10:03","10:15","10:45","16:50"]){
    assert.equal(validateCollectionTime(time,now,defaultSiteSettings),"",time);
  }
});
test("a past time and a time after today's collection window are still rejected",()=>{
  assert.match(validateCollectionTime("09:59",now,defaultSiteSettings),/between 10:00/);
  assert.match(validateCollectionTime("17:01",now,defaultSiteSettings),/between 10:00/);
});
test("collection time is mandatory, including for the server",()=>{
  for(const value of ["","bad","24:01",null]) assert.match(validateCollectionTime(value,now,defaultSiteSettings),/Choose your preferred collection time/);
  assert.match(html,/<input name="time" type="time" required autocomplete="off"/);
  assert.match(source,/name === "time"\) message = validateCollectionTime\(field\.value/);
});
test("existing hours and last-order restrictions are preserved",()=>{
  assert.equal(getCollectionWindow(date("2026-10-28T08:00:00Z")).available,false);
  assert.equal(getCollectionWindow(date("2026-10-28T16:46:00Z")).available,false);
  const nearClose=getCollectionWindow(date("2026-10-28T16:45:00Z"));
  assert.equal(nearClose.available,true);
  assert.equal(nearClose.min,"16:45");
  assert.equal(nearClose.max,"17:00");
});
test("customised preparation estimate does not reimpose a minimum",()=>{
  const settings=structuredClone(defaultSiteSettings);
  settings.ordering.preparationMinutes=30;
  assert.equal(getCollectionWindow(now,settings).min,"10:00");
  assert.equal(validateCollectionTime("10:01",now,settings),"");
});
function simulate(clock,fieldValue){
  const input={value:fieldValue,required:true,disabled:false,min:"",max:"",error:"before",setCustomValidity(x){this.error=x;}};
  const classes={};
  const hint={textContent:"",classList:{toggle(k,val){classes[k]=val;}}};
  const FixedDate=class extends Date {constructor(...args){super(...(args.length?args:[clock.getTime()]));}};
  const start=source.indexOf("function syncCollectionTime() {");
  const end=source.indexOf("\nfunction validateCollectionForm()",start);
  assert.ok(start>=0&&end>start);
  const ctx={Date:FixedDate,activeSettings:defaultSiteSettings,collectionTimeInput:input,
    getCollectionWindow,validateCollectionTime,document:{querySelector(selector){assert.equal(selector,"#collectionTimeHint");return hint;}}};
  const sync=runInNewContext("("+source.slice(start,end)+")",ctx);
  const window=sync();
  return {input,hint,classes,window};
}
test("client leaves time blank until customer chooses it",()=>{
  const result=simulate(now,"");
  assert.equal(result.input.value,"");
  assert.equal(result.input.min,"10:00");
  assert.equal(result.input.error,"");
  assert.equal(result.input.disabled,false);
  assert.equal(result.hint.textContent,expectedNotice);
  assert.equal(result.classes["is-preparation-notice"],true);
});
test("client never overwrites manually chosen time",()=>{
  const result=simulate(date("2026-10-28T10:02:30Z"),"10:45");
  assert.equal(result.input.value,"10:45");
  assert.equal(result.input.error,"");
});
test("client does not auto-correct an already past choice",()=>{
  const result=simulate(now,"09:59");
  assert.equal(result.input.value,"09:59");
  assert.equal(result.input.error,"");
  assert.match(validateCollectionTime(result.input.value,now),/between/);
});
test("an unavailable window disables the time input",()=>{
  const result=simulate(date("2026-10-28T08:00:00Z"),"");
  assert.equal(result.input.disabled,true);
  assert.equal(result.classes["is-preparation-notice"],false);
});
test("time is reset for a fresh order, not inferred or automatically chosen",()=>{
  assert.match(source,/collectionTimeInput\.value = ""; \/\/ Each order requires an explicit collection-time choice/);
  assert.match(source,/function clearCheckoutAttempt\(\) \{[\s\S]*?collectionTimeInput\.value = "";/);
  assert.doesNotMatch(source,/collectionTimeManuallyChosen/);
  assert.doesNotMatch(source,/collectionTimeInput\.value = availability\.min/);
});
test("one warning sits immediately below the time selector, before order notes",()=>{
  const selector=html.indexOf('id="field-time"');
  const warning=html.indexOf('id="collectionTimeHint"');
  const notes=html.indexOf('id="field-notes"');
  assert.ok(selector>=0&&warning>selector&&notes>warning);
  assert.equal((html.match(/id="collectionTimeHint"/g)||[]).length,1);
  assert.match(html,/<small class="field-hint" id="collectionTimeHint"><\/small>/);
});
test("only the short requested notice is shown, in readable red",()=>{
  assert.equal(getCollectionWindow(now).message,expectedNotice);
  assert.match(ux,/#collectionTimeHint\.is-preparation-notice\s*\{\s*color:#ff9d92;/);
  assert.doesNotMatch(getCollectionWindow(now).message,/Today,|time between/);
  assert.match(terms,/Choose a preferred collection time when ordering/);
});
test("actual final enabled payment button still has gold styling",()=>{
  assert.match(html,/id="stripeCheckoutButton"/);
  assert.match(ux,/#paymentStep \.button\.stripe:not\(:disabled\)/);
  assert.match(ux,/background:linear-gradient\(120deg,#f6d17a 0%,#e3ad39 100%\)/);
});
test("manager order action contrast remains corrected",()=>{
  assert.match(manager,/\.order-history-card \.status-button \{ color:#142b3c/);
  assert.match(manager,/\.order-history-card \.status-button\.is-active/);
});
