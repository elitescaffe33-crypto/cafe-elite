import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { Readable } from "node:stream";
import { readFile } from "node:fs/promises";
import { menuData } from "../menu-data.mjs";
import { validateMenuSettings, applyManagedMenu } from "../menu-management.mjs";
import { isUploadedProductPhoto, isApprovedPublicAsset } from "../public-asset-allowlist.mjs";
import { createProductPhotoStorage, optimiseProductPhoto, readPhotoBody, MAX_PHOTO_INPUT, MAX_PHOTO_OUTPUT, PHOTO_BUCKET } from "../product-photo-storage.mjs";

const photo = await sharp({ create: { width: 2100, height: 1500, channels: 3, background: "#c3a06d" } }).jpeg().toBuffer();
const path = "/product-photos/" + "a".repeat(64) + ".webp";
const settingsWith = image => ({ menuOverrides: { "cake-fudge-cake": { image, status: "active" } } });

test("photo URLs only admit immutable server-generated names, never static wildcards", () => {
  assert.equal(isUploadedProductPhoto(path), true);
  for (const bad of [path+"\n",path+"?v=1",path.replace("a.webp","a.svg"),"https://evil.example/photo.webp","/product-photos/../server.mjs","/product-photos/"+'A'.repeat(64)+".webp","/product-photos/%2e%2e",null])
    assert.equal(isUploadedProductPhoto(bad), false);
  assert.equal(isApprovedPublicAsset(path), false);
  assert.equal(isApprovedPublicAsset("assets/cakes/biscoff-cheesecake.webp"), true);
  assert.doesNotThrow(() => validateMenuSettings(settingsWith(path)));
  assert.throws(() => validateMenuSettings(settingsWith("https://evil.example/photo.webp")));
  assert.equal(applyManagedMenu(menuData,settingsWith(path)).flatMap(g=>g.items).find(x=>x.id==="cake-fudge-cake").image,path);
});
test("optimiser decodes real image, caps dimensions and size, strips metadata", async () => {
  const result = await optimiseProductPhoto(photo);
  const m = await sharp(result).metadata();
  assert.equal(m.format,"webp"); assert.equal(m.width,1400); assert.ok(m.height<=1400);
  assert.ok(result.length<=MAX_PHOTO_OUTPUT); assert.equal(m.exif,undefined);
  await assert.rejects(optimiseProductPhoto(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg' width='4' height='4'></svg>")),e=>e.status===422);
  await assert.rejects(optimiseProductPhoto(Buffer.from("not an image")),e=>e.status===422);
  await assert.rejects(optimiseProductPhoto(Buffer.alloc(MAX_PHOTO_INPUT+1)),e=>e.status===413);
});
test("binary upload body rejects type, oversized length and chunked oversized bodies",async()=>{
  const req=(chunks,headers)=>Object.assign(Readable.from(chunks),{headers});
  assert.deepEqual(await readPhotoBody(req([photo],{"content-type":"image/jpeg"})),photo);
  assert.throws(()=>readPhotoBody(req([photo],{"content-type":"image/svg+xml"})),e=>e.status===415);
  assert.throws(()=>readPhotoBody(req([photo],{"content-type":"image/jpeg","content-length":String(MAX_PHOTO_INPUT+1)})),e=>e.status===413);
  await assert.rejects(readPhotoBody(req([Buffer.alloc(MAX_PHOTO_INPUT),Buffer.alloc(1)],{"content-type":"image/png"})),e=>e.status===413);
});
test("real StorageClient protocol: isolated bucket, WebP upload, deduplication, new reference verification",async()=>{
  const files=new Map(),calls=[]; let bucket=null;
  const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json"}});
  const fetchImpl=async(input,init={})=>{
    const url=new URL(typeof input==="string"?input:input.url), method=init.method||"GET";
    const p=url.pathname.replace("/storage/v1","");
    const h=new Headers(init.headers); calls.push({p,method});
    assert.equal(url.origin,"https://storage.example.test"); assert.equal(h.get("apikey"),"sb_secret_test"); assert.equal(init.redirect,"error");
    if(p==="/bucket"&&method==="GET") return reply(bucket?[bucket]:[]);
    if(p==="/bucket"&&method==="POST"){
      const b=JSON.parse(init.body); assert.equal(b.id,PHOTO_BUCKET); assert.equal(b.public,true);
      assert.equal(b.file_size_limit,MAX_PHOTO_OUTPUT); assert.deepEqual(b.allowed_mime_types,["image/webp"]);
      bucket=b; return reply({name:PHOTO_BUCKET});
    }
    if(p==="/bucket/"+PHOTO_BUCKET&&method==="GET") return reply(bucket);
    if(p==="/object/list/"+PHOTO_BUCKET&&method==="POST") return reply([...files.keys()].map(name=>({name})));
    if(p.startsWith("/object/info/"+PHOTO_BUCKET+"/")&&method==="GET"){
      const name=p.split("/").pop();
      return files.has(name)?reply({name,id:name,size:files.get(name).length,mimetype:"image/webp"}):reply({statusCode:"404",error:"NoSuchKey",code:"NoSuchKey",message:"Object not found"},404);
    }
    if(p.startsWith("/object/"+PHOTO_BUCKET+"/")&&method==="POST"){
      const name=p.split("/").pop(); assert.match(name,/^[a-f0-9]{64}\.webp$/);
      assert.equal(h.get("content-type"),"image/webp"); assert.equal(h.get("x-upsert"),"false");
      const bytes=Buffer.from(init.body); assert.ok(bytes.length<=MAX_PHOTO_OUTPUT);
      assert.equal((await sharp(bytes).metadata()).format,"webp");
      files.set(name,bytes); return reply({Key:PHOTO_BUCKET+"/"+name});
    }
    throw Error("Unexpected storage request: "+method+" "+p);
  };
  const store=createProductPhotoStorage({url:"https://storage.example.test",secret:"sb_secret_test",fetchImpl});
  const result=await store.upload(photo);
  assert.equal(isUploadedProductPhoto(result),true); assert.equal(files.size,1);
  assert.equal(await store.upload(photo),result); assert.equal(files.size,1);
  assert.deepEqual(await store.list(),[result]);
  assert.equal(store.publicUrl(result),"https://storage.example.test/storage/v1/object/public/"+PHOTO_BUCKET+"/"+result.split("/").pop());
  await store.validateNewReferences(settingsWith(result),{});
  await assert.rejects(store.validateNewReferences(settingsWith(path),{}),e=>e.status===422);
  const before=calls.length; await store.validateNewReferences(settingsWith(result),settingsWith(result)); assert.equal(calls.length,before);
  assert.equal(calls.filter(x=>x.p==="/bucket"&&x.method==="POST").length,1);
});
test("bucket with unexpected access settings fails closed",async()=>{
  const store=createProductPhotoStorage({url:"https://storage.example.test",secret:"sb_secret_test",client:{from:()=>({}),listBuckets:async()=>({data:[{id:PHOTO_BUCKET,public:true,file_size_limit:null,allowed_mime_types:null}]})}});
  await assert.rejects(store.ensureBucket(),/restrictions/);
});
test("upload route uses existing admin gate, storage code stays private, save remains CAS-protected",async()=>{
  const server=await readFile(new URL("../server.mjs",import.meta.url),"utf8");
  const manager=await readFile(new URL("../manager-ui.mjs",import.meta.url),"utf8");
  const html=await readFile(new URL("../admin.html",import.meta.url),"utf8");
  assert.match(server,/if \(request\.url === "\/api\/admin\/product-photos"[\s\S]{0,160}requireAdmin\(request, response\)/);
  assert.match(server,/if \(photoStorage\) await photoStorage\.validateNewReferences/);
  assert.match(server,/photoStorage = hasSupabase\(\) && !safety\.staging && !isolatedTest/);
  assert.doesNotMatch(server.match(/const publicFiles = new Set\([^\n]+/)[0],/product-photo-storage/);
  assert.match(html,/type="file" id="productImageUpload"/);
  assert.match(manager,/await uploadPhoto\(body\)/);
  assert.match(manager,/renderPhotoOptions\(result\.path\); updatePreview\(\)/);
});
