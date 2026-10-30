import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  receiptData, receiptDate, receiptMoney, receiptItems,
  receiptPaymentLabel, receiptPlainText, renderReceiptMarkup,
  receiptDocument, RECEIPT_CSS,
} from "../receipt-layout.mjs";

const order={
  id:"00000000-0000-4000-8000-000000000000",
  orderNumber:10040,
  createdAt:"2026-10-30T09:52:00.000Z",
  collectionTime:"10:20",
  type:"paid-online",
  paymentState:"paid",
  status:"paid",
  customerName:"Example Customer",
  phone:"07000000000",
  amount:"22.46 GBP",
  items:[
    "1x Chicken Tomato Pasta - 8.99 GBP",
    "1x Tuna Mayo Baguette - 4.50 GBP",
    "1x Carrot Cake - 2.99 GBP",
    "1x Orange Cake - 2.99 GBP",
    "1x Fudge Cake - 2.99 GBP",
  ].join("\n"),
  notes:"",
};
const exampleRows=[
  ["Chicken Tomato Pasta","£8.99"],
  ["Tuna Mayo Baguette","£4.50"],
  ["Carrot Cake","£2.99"],
  ["Orange Cake","£2.99"],
  ["Fudge Cake","£2.99"],
];

test("exact owner-approved 10040 example has a prominent reference, collection time and five line items",()=>{
  const r=receiptData(order);
  assert.equal(r.number,"10040");
  assert.equal(r.collect,"10:20");
  assert.equal(r.ordered,"30 Oct 2026 · 09:52");
  assert.equal(r.payment,"PAID ONLINE");
  assert.equal(r.total,"£22.46");
  assert.equal(r.notes,"None");
  assert.equal(r.status,"");
  assert.equal(r.items.length,5);
  assert.deepEqual(r.items.map(item=>[item.name,item.price]),exampleRows);
});

test("premium markup visually separates header, order, metadata, items, notes and bottom-right TOTAL",()=>{
  const receipt=renderReceiptMarkup(order);
  assert.match(receipt,/CAFE ELITE/);
  assert.match(receipt,/33 High Street, Leominster/);
  assert.match(receipt,/#10040/);
  assert.match(receipt,/COLLECT 10:20/);
  assert.match(receipt,/Example Customer/);
  assert.match(receipt,/PAID ONLINE/);
  assert.match(receipt,/ORDER ITEMS/);
  assert.match(receipt,/ORDER NOTES/);
  assert.match(receipt,/class="receipt-item-price">£8\.99/);
  assert.ok(receipt.indexOf('class="receipt-hero"') < receipt.indexOf('class="receipt-meta"'));
  assert.ok(receipt.indexOf('class="receipt-meta"') < receipt.indexOf('class="receipt-items"'));
  assert.ok(receipt.indexOf('class="receipt-items"') < receipt.indexOf('class="receipt-notes"'));
  assert.ok(receipt.indexOf('class="receipt-notes"') < receipt.indexOf('class="receipt-total"'));
  assert.match(receipt,/<footer class="receipt-total"><span>TOTAL<\/span><strong>£22\.46<\/strong><\/footer>/);
  assert.doesNotMatch(receipt,/Status:\s*paid|<span>Status<\/span>/);
});

test("80mm thermal paper-safe: 72mm receipt column and flexible item wrapping without clipping",()=>{
  assert.match(RECEIPT_CSS,/\.receipt \{ width:72mm; max-width:100%/);
  assert.match(RECEIPT_CSS,/\.receipt-item \{ display:grid; grid-template-columns:auto minmax\(0,1fr\) auto/);
  assert.match(RECEIPT_CSS,/\.receipt-item-name \{ font-weight:700; min-width:0/);
  assert.match(RECEIPT_CSS,/\.receipt-item-price \{ font-weight:800; white-space:nowrap; text-align:right/);
  assert.match(RECEIPT_CSS,/\.receipt-total \{ display:flex; justify-content:flex-end/);
  assert.match(RECEIPT_CSS,/break-inside:avoid/);
  assert.match(RECEIPT_CSS,/@page \{ margin: 0; \}/);
  assert.doesNotMatch(RECEIPT_CSS,/height:\s*\d+mm/);
});

test("copy order retains clear total bottom-right and all real sale-time prices",()=>{
  const plain=receiptPlainText(order);
  const lines=plain.split("\n");
  assert.match(plain,/COLLECTION ORDER/);
  assert.match(plain,/#10040/);
  assert.match(plain,/COLLECT 10:20/);
  assert.match(plain,/30 Oct 2026/);
  assert.match(plain,/ORDER ITEMS/);
  assert.match(plain,/ORDER NOTES/);
  assert.ok(lines.findIndex(s=>s.includes("ORDER ITEMS")) < lines.findIndex(s=>s.includes("ORDER NOTES")));
  assert.ok(lines.findIndex(s=>s.includes("ORDER NOTES")) < lines.findIndex(s=>s.includes("TOTAL")));
  for(const [name,price] of exampleRows){
    assert.ok(lines.some(s=>s.includes(name)&&s.endsWith(price)),name);
  }
  assert.ok(lines.some(s=>s.includes("TOTAL") && s.trimEnd().endsWith("£22.46")));
  assert.doesNotMatch(plain,/Status:\s*paid/);
});

test("very long item name wraps in copy without dropping price or altering product identity",()=>{
  const long={...order,items:"2x Homemade Chicken Tomato Pasta with Garlic Yogurt and Special Side Additions - 17.98 GBP"};
  const plain=receiptPlainText(long,32);
  assert.match(plain,/2× Homemade Chicken/);
  assert.ok(plain.includes("£17.98"));
  for(const line of plain.split("\n")) assert.ok(line.length<=32,"Copied line too wide: "+line);
  const markup=renderReceiptMarkup(long);
  assert.ok(markup.includes("Homemade Chicken Tomato Pasta with Garlic Yogurt and Special Side Additions"));
});

test("literal product and note data are escaped, no HTML or scripts can execute in print window",()=>{
  const adversarial={...order,customerName:'<img src=x onerror="alert(1)">',
    notes:'Please leave out <milk> & "extras"\n<sCrIpT>alert(1)</sCrIpT>',
    items:"1x Very <long> & Dangerous <img onerror=alert(1)> - 1.99 GBP",
  };
  const doc=receiptDocument(adversarial);
  assert.ok(doc.includes("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"));
  assert.ok(doc.includes("&lt;milk&gt; &amp; &quot;extras&quot;"));
  assert.ok(doc.includes("&lt;sCrIpT&gt;alert(1)&lt;/sCrIpT&gt;"));
  assert.ok(!doc.includes("<sCrIpT>"));
  assert.ok(!doc.includes("<img onerror="));
  assert.ok(!doc.includes("<script>"));
  assert.ok(doc.includes("&lt;long&gt; &amp; Dangerous"));
});

test("if original item text format changes, unknown line is preserved instead of inventing a price",()=>{
  const r=receiptItems("1x Sandwich Deal: Choice of bread unknown");
  assert.deepEqual(r,[{quantity:"",name:"1x Sandwich Deal: Choice of bread unknown",price:""}]);
  assert.deepEqual(receiptItems(""),[]);
  assert.equal(receiptMoney("Pay at collection"),"Pay at collection");
  assert.equal(receiptMoney("£8.99"),"£8.99");
  assert.equal(receiptMoney("4 GBP"),"£4.00");
  assert.equal(receiptMoney("4.5 GBP"),"£4.50");
});

test("payment labels distinguish paid, awaiting payment and collection without creating duplicate paid status",()=>{
  assert.equal(receiptPaymentLabel(order),"PAID ONLINE");
  assert.equal(receiptPaymentLabel({...order,type:"online",paymentState:"pending_online"}),"PAYMENT PENDING");
  assert.equal(receiptPaymentLabel({...order,type:"pay-on-collection",paymentState:"pay_on_collection"}),"PAY ON COLLECTION");
  assert.equal(receiptData({...order,status:"cancelled"}).status,"CANCELLED");
  assert.match(renderReceiptMarkup({...order,status:"cancelled"}),/CANCELLED/);
  assert.doesNotMatch(renderReceiptMarkup(order),/class="receipt-status"/);
});

test("new formatting module is served by exact public allowlist, but private data modules remain private",async()=>{
  const server=await readFile(new URL("../server.mjs",import.meta.url),"utf8");
  assert.match(server,/"receipt-layout\.mjs"/);
  assert.doesNotMatch(server,/publicFiles = new Set\(\[[^\]]*order-store\.mjs/);
  assert.doesNotMatch(server,/publicFiles = new Set\(\[[^\]]*order-service\.mjs/);
});
test("Manager Print uses the actual order object and browser HTML, Copy uses the new text receipt",async()=>{
  const source=await readFile(new URL("../admin.js",import.meta.url),"utf8");
  assert.match(source,/import \{ receiptDocument, receiptPlainText, renderReceiptMarkup \} from "\.\/receipt-layout\.mjs"/);
  assert.match(source,/currentOrders\.find\(item => item\.id === orderCard\?\.dataset\.orderId\)/);
  assert.match(source,/navigator\.clipboard\.writeText\(receiptPlainText\(order\)\)/);
  assert.match(source,/printOrder\(order\)/);
  assert.match(source,/printWindow\.document\.write\(receiptDocument\(order\)\)/);
  assert.match(source,/data-order-id="\$\{escapeHtml\(order\.id\)\}"/);
  assert.doesNotMatch(source,/<body><pre>\$\{escapeHtml\(orderText\)\}/);
});
test("print document HTML includes complete markup and standard paper-size-safe CSS",()=>{
  const doc=receiptDocument(order);
  assert.ok(doc.startsWith("<!doctype html>"));
  assert.ok(doc.includes('<meta charset="UTF-8">'));
  assert.ok(doc.includes('<main class="receipt"'));
  assert.ok(doc.includes('<footer class="receipt-total"'));
  assert.ok(doc.includes("@page { margin: 0; }"));
  assert.ok(!doc.includes("<script"));
  assert.ok(!doc.includes("customer@example.com"));
});

test("Manager print dialog receives only escaped receipt HTML and invokes browser print exactly once",async()=>{
  const source=await readFile(new URL("../admin.js",import.meta.url),"utf8");
  const {runInNewContext}=await import("node:vm");
  const begin=source.indexOf("function printOrder(order) {");
  const end=source.indexOf("\nfunction renderStatusButton",begin);
  assert.ok(begin>0&&end>begin);
  let printed=0,opened=0,closed=0,focused=0;
  let documentHTML="";
  const popup={
    closed:false,
    document:{
      open(){opened++;},
      write(value){documentHTML+=value;},
      close(){closed++;},
      fonts:{ready:Promise.resolve()},
    },
    focus(){focused++;},
    print(){printed++;},
  };
  const alerts=[];
  const ctx={
    window:{open(){return popup;},matchMedia:()=>({matches:false})},
    navigator:{standalone:false},
    narrow:{matches:false},
    receiptDocument,
    Promise,
    showMessage:text=>alerts.push(text),
  };
  const fn=runInNewContext("("+source.slice(begin,end)+")",ctx);
  fn(order);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(opened,1);
  assert.equal(closed,1);
  assert.equal(printed,1);
  assert.equal(focused,1);
  assert.ok(documentHTML.includes("#10040"));
  assert.ok(documentHTML.includes("£22.46"));
  assert.equal(alerts.length,0);
});

test("Manager reports popup blockers; never sends a network request or silently loses the receipt",async()=>{
  const source=await readFile(new URL("../admin.js",import.meta.url),"utf8");
  const {runInNewContext}=await import("node:vm");
  const start=source.indexOf("function printOrder(order) {");
  const end=source.indexOf("\nfunction renderStatusButton",start);
  const messages=[];
  const fn=runInNewContext("("+source.slice(start,end)+")",{
    window:{open:()=>null,matchMedia:()=>({matches:false})},
    navigator:{standalone:false},
    narrow:{matches:false},
    receiptDocument,
    Promise,
    showMessage:text=>messages.push(text),
  });
  fn(order);
  assert.equal(messages.length,1);
  assert.match(messages[0],/Print window was blocked/);
  assert.match(messages[0],/Copy order instead/);
});
