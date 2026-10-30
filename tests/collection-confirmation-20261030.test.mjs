import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";
import {runInNewContext} from "node:vm";

const root=new URL("../",import.meta.url);
const [source,html,css]=await Promise.all(
  ["script.js","index.html","ux-refinements.css"].map(name=>readFile(new URL(name,root),"utf8"))
);
const begin=source.indexOf("function showOrderSentMessage(result, collectionTime) {");
const end=source.indexOf("\nmenuGrid.addEventListener(",begin);
assert.ok(begin>=0&&end>begin,"Receipt function must exist");
const code=source.slice(begin,end).trim();
const id="eac56068-0caf-447f-95e7-5633b7840535";
const saved={ok:true,orderId:id,orderReference:"10042",total:199,currency:"gbp",collectionTime:"16:20"};

function simulate({response=saved,cartOpen=true,late=false,renderFails=false}={}){
  const elements=Object.fromEntries(
    ["#confirmationReference","#confirmationTime","#confirmationAmount","#confirmationLateNotice","#confirmation-title"]
      .map(name=>[name,{textContent:"",hidden:true,focusCalls:0,focus(){this.focusCalls++;}}])
  );
  let shown=0,closed=0,rendered=0,historyCalls=0;
  const stepResets=[];
  const basket=[{id:"synthetic-item"}];
  const confirmationDialog={open:false,showModal(){this.open=true;shown++;}};
  const cartDrawer={open:cartOpen};
  const context={
    activeSettings:{},
    cartDrawer,confirmationDialog,basket,
    getCafeHours:()=>({today:{close:late?"16:00":"17:00"}}),
    closeCart:()=>{closed++;cartDrawer.open=false;},
    setCartStep:(step,focus)=>stepResets.push([step,focus]),
    document:{querySelector(name){assert.ok(elements[name],"Unexpected document selector: "+name);return elements[name];}},
    renderBasket:()=>{rendered++;if(renderFails)throw Error("Synthetic reset error");},
    history:{replaceState(){historyCalls++;}},
    window:{location:{pathname:"/",search:"?source=test"}},
    console:{error(){}},
  };
  const fn=runInNewContext("("+code+")",context);
  fn(response,response?.collectionTime??"");
  return {elements,basket,shown,closed,rendered,historyCalls,confirmationDialog,fn,stepResets};
}

test("Saved collection order opens centered modal showing exact 5-digit reference",()=>{
  const s=simulate();
  assert.equal(s.shown,1);
  assert.equal(s.confirmationDialog.open,true);
  assert.equal(s.elements["#confirmationReference"].textContent,"10042");
  assert.equal(s.elements["#confirmationTime"].textContent,"Today at 16:20 (London time)");
  assert.equal(s.elements["#confirmationAmount"].textContent,"£1.99");
  assert.equal(s.elements["#confirmation-title"].focusCalls,1);
});
test("Success closes basket and empties it only after receiving server acknowledgement",()=>{
  const s=simulate();
  assert.equal(s.closed,1);
  assert.equal(s.basket.length,0);
  assert.equal(s.rendered,1);
  assert.equal(s.historyCalls,1);
  assert.deepEqual(s.stepResets,[["basket",false]]);
  assert.ok(source.indexOf("if (cartDrawer.open) closeCart();",begin)>begin);
});
test("Success modal still opens when the customer already closed the basket",()=>{
  const s=simulate({cartOpen:false});
  assert.equal(s.shown,1);
  assert.equal(s.closed,0);
  assert.equal(s.basket.length,0);
});
test("No receipt is shown for missing, failed or malformed server responses",()=>{
  for(const bad of [null,{}, {ok:false,orderId:id},{ok:true},{ok:true,orderId:""}]){
    const s=simulate({response:bad});
    assert.equal(s.shown,0);
    assert.equal(s.closed,0);
    assert.equal(s.basket.length,1);
    assert.equal(s.historyCalls,0);
  }
});
test("Late collection note is shown only when past the cafe closing hour",()=>{
  const s=simulate({late:true});
  assert.equal(s.elements["#confirmationLateNotice"].hidden,false);
  assert.match(s.elements["#confirmationLateNotice"].textContent,/contact you/);
  const regular=simulate({late:false});
  assert.equal(regular.elements["#confirmationLateNotice"].hidden,true);
  assert.equal(regular.elements["#confirmationLateNotice"].textContent,"");
});
test("Bad amount data is never printed as an invented payment sum",()=>{
  const s=simulate({response:{...saved,total:"not-a-number"}});
  assert.equal(s.elements["#confirmationAmount"].textContent,"Pay at collection");
});
test("A non-critical basket render failure does not remove a saved receipt",()=>{
  const s=simulate({renderFails:true});
  assert.equal(s.shown,1);
  assert.equal(s.basket.length,0);
});
test("Receipt is a distinct accessible modal with dismiss action",()=>{
  assert.match(html,/<dialog id="orderConfirmation" class="order-confirmation-dialog" aria-labelledby="confirmation-title" aria-describedby="confirmation-intro">/);
  assert.match(html,/<h2 id="confirmation-title" tabindex="-1">Order received!<\/h2>/);
  assert.match(html,/id="confirmationReference"/);
  assert.match(html,/id="confirmationTime"/);
  assert.match(html,/id="confirmationAmount"/);
  assert.match(html,/id="closeOrderConfirmation"/);
  assert.match(source,/confirmationDialog\.addEventListener\("close"/);
  assert.match(source,/confirmationDialog\.close\(\)/);
  assert.doesNotMatch(source,/confirmation\.scrollIntoView/);
  assert.equal((html.match(/id="orderConfirmation"/g)||[]).length,1);
});
test("No false payment claim; confirmation only after a successful saved order",()=>{
  assert.match(html,/No online payment has been taken/);
  assert.match(html,/Please pay when you collect/);
  assert.match(source,/result\?\.ok !== true \|\| !result\.orderId/);
  assert.match(source,/\.then\(\(data\) => \{\s*showOrderSentMessage\(data, data\.collectionTime/);
  assert.match(source,/if \(!activeSettings\.payments\.payOnCollection\)/);
  assert.match(source,/checkoutButton\.hidden = !activeSettings\.payments\.payOnCollection/);
});
test("Confirmation uses textContent for references, never injecting HTML",()=>{
  assert.match(code,/querySelector\("#confirmationReference"\)\.textContent = result\.orderReference \|\| result\.orderId/);
  assert.doesNotMatch(code,/innerHTML|insertAdjacentHTML/);
});
test("Mobile modal contrast, sizing, scroll and native backdrop are provided",()=>{
  assert.match(css,/\.order-confirmation-dialog \{/);
  assert.match(css,/max-height: calc\(100dvh - 24px - env\(safe-area-inset-bottom\)\)/);
  assert.match(css,/\.order-confirmation-dialog::backdrop/);
  assert.match(css,/\.order-confirmation-dialog:not\(\[open\]\) \{ display: none; \}/);
  assert.match(css,/\.order-confirmation-dialog \.order-confirmation-close/);
  assert.match(css,/overflow-y: auto/);
});
test("Cart close must not steal focus back while the modal is visible",()=>{
  assert.match(source,/if \(!confirmationDialog\.open\) \{\s*const target = returnFocus\?\.isConnected/);
  assert.match(source,/confirmationDialog\.showModal\(\)/);
  assert.match(source,/querySelector\("#confirmation-title"\)\.focus/);
});
