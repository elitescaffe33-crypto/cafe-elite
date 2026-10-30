import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {runInNewContext} from "node:vm";
import {timingSafeEqual} from "node:crypto";

const server=await readFile(new URL("../server.mjs",import.meta.url),"utf8");
const secret="a".repeat(64);
const route="/api/_internal/one-shot-mail-test";
const start=server.indexOf("  // Temporary owner-approved one-shot email delivery check.");
const end=server.indexOf('  if (request.method === "POST" && ["/api/collection-order", "/api/create-checkout-session"].includes(request.url))',start);
assert.ok(start>0&&end>start);
const fragment=server.slice(start,end);
const TestDate=class extends Date { static now(){return Date.parse("2026-10-30T20:29:00Z");} };

function createHandler({
  secretFromEnv=secret,preview=false,staging=false,
  sender="CAFE ELITE <orders@cafeelite.co.uk>",recipient="elitesorders@gmail.com",
  now=TestDate,willFail=false,
}={}) {
  const responses=[];
  const emails=[];
  const context={
    previewMode:preview,safety:{staging},Date:now,Buffer,timingSafeEqual,
    oneShotMailTestSecret:secretFromEnv,oneShotMailTestAttempted:false,
    resendFromEmail:sender,orderNotificationEmail:recipient,
    jsonReply:(response,status,payload)=>responses.push({status,payload}),
    sendResendMail:async options=>{
      emails.push(options);
      if(willFail)throw Error("Synthetic provider error");
      return "test-email-id-123";
    },
  };
  const run=runInNewContext("(async(request,response)=>{"+fragment+"})",context);
  const request=token=>({method:"POST",url:route,headers:{"x-cafe-elite-test-token":token,"content-length":"0"}});
  return {run,request,responses,emails};
}

test("invalid/absent secret cannot send",async()=>{
  const x=createHandler();
  await x.run(x.request("b".repeat(64)),{});
  await x.run(x.request(""),{});
  assert.deepEqual(x.responses.map(z=>z.status),[404,404]);
  assert.equal(x.emails.length,0);
});
test("single valid request sends one innocuous message and returns provider ID",async()=>{
  const x=createHandler();
  await x.run(x.request(secret),{});
  assert.equal(x.responses[0].status,200);
  assert.deepEqual(Object.fromEntries(Object.entries(x.responses[0].payload)),{ok:true,provider:"Resend",emailId:"test-email-id-123"});
  assert.equal(x.emails.length,1);
  assert.equal(x.emails[0].idempotencyKey,"cafe-elite-mail-delivery-check-20261030-v1");
  assert.match(x.emails[0].subject,/not a customer order/i);
  assert.match(x.emails[0].text,/No payment was charged/);
  assert.doesNotMatch(x.emails[0].text,/customer phone|customer email|stripe session/);
  await x.run(x.request(secret),{});
  assert.equal(x.responses[1].status,409);
  assert.equal(x.emails.length,1);
});
test("Preview, staging and missing production secret cannot send",async()=>{
  for(const options of [{preview:true},{staging:true},{secretFromEnv:""}]){
    const x=createHandler(options);
    await x.run(x.request(secret),{});
    assert.equal(x.responses[0].status,404);
    assert.equal(x.emails.length,0);
  }
});
test("mismatched environment destination or sender blocks send",async()=>{
  for(const options of [{sender:"CAFE ELITE Orders <onboarding@resend.dev>"},{recipient:"another@example.com"}]){
    const x=createHandler(options);
    await x.run(x.request(secret),{});
    assert.equal(x.responses[0].status,503);
    assert.equal(x.emails.length,0);
  }
});
test("nonempty body rejected, no email sent",async()=>{
  const x=createHandler();
  const req=x.request(secret);
  req.headers["content-length"]="123";
  await x.run(req,{});
  assert.equal(x.responses[0].status,400);
  assert.equal(x.emails.length,0);
});
test("expired one-shot route rejected before sending",async()=>{
  const expired=class extends Date {static now(){return Date.parse("2026-11-02T00:00:00Z");}};
  const x=createHandler({now:expired});
  await x.run(x.request(secret),{});
  assert.equal(x.responses[0].status,404);
  assert.equal(x.emails.length,0);
});
test("provider failure surfaces a controlled error and disables retries",async()=>{
  const x=createHandler({willFail:true});
  await x.run(x.request(secret),{});
  await x.run(x.request(secret),{});
  assert.deepEqual(x.responses.map(z=>z.status),[502,409]);
  assert.equal(x.emails.length,1);
});
test("no test path accessible by public GET or static file allowlist",()=>{
  assert.match(server,/request\.method === "POST" && request\.url === "\/api\/_internal\/one-shot-mail-test"/);
  assert.doesNotMatch(server,/publicFiles = new Set\(\[[^\]]*one-shot-mail-test/);
  assert.match(server,/timingSafeEqual\(Buffer\.from\(supplied, "hex"\), Buffer\.from\(oneShotMailTestSecret, "hex"\)\)/);
});
