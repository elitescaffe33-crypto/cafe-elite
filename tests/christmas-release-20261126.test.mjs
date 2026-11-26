import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {menuData} from "../menu-data.mjs";
import {defaultSiteSettings} from "../site-settings.mjs";
import {renderPublicPage} from "../public-content.mjs";
import {renderChristmasPage,isChristmasPublicFile,audioRange,CHRISTMAS_PUBLIC_FILES} from "../christmas-public.mjs";

test("Christmas transforms only public page presentation, keeping menu and product art",async()=>{
 const original=renderPublicPage(await readFile(new URL("../index.html",import.meta.url),"utf8"),menuData,defaultSiteSettings);
 const html=renderChristmasPage(original);
 const images=s=>[...s.matchAll(/<img\b[^>]*\bsrc="([^"]+)"[^>]*>/g)].map(m=>m[1]).filter(x=>!x.includes("cafe-front.jpg")&&!x.includes("cafe-elite-winter-front.jpg"));
 assert.deepEqual(images(html),images(original));
 assert.equal((html.match(/\/christmas\/cafe-elite-winter-front\.jpg/g)||[]).length,2);
 assert.equal((html.match(/id="yule-music"/g)||[]).length,1);
 assert.equal((html.match(/data-route=/g)||[]).length,3);
 assert.match(html,/First Snow by Scott Buckley/);
 assert.match(html,/creativecommons\.org\/licenses\/by\/4\.0/);
 assert.equal(html.match(/<script type="application\/ld\+json">.*?<\/script>/s)[0],original.match(/<script type="application\/ld\+json">.*?<\/script>/s)[0]);
 for(const f of CHRISTMAS_PUBLIC_FILES)assert.ok((await readFile(new URL("../"+f,import.meta.url))).length>0);
});
test("seasonal files are explicitly allowlisted; preview and private modules stay private",()=>{
 for(const path of ["christmas/winter.css","christmas/sound.mjs","christmas/first-snow-scott-buckley.mp3","christmas/cafe-elite-winter-front.jpg"])assert.equal(isChristmasPublicFile(path),true);
 for(const path of ["christmas-layout.mjs","christmas-public.mjs","christmas/layout.mjs","christmas/../server.mjs","christmas/unknown.mp3","scripts/christmas-preview.mjs","review/","test-results/christmas/390-home.png"])assert.equal(isChristmasPublicFile(path),false);
});
test("single byte ranges support Safari and safe bounds",()=>{
 const s=1000;
 assert.deepEqual(audioRange(undefined,s),{start:0,end:999,partial:false});
 assert.deepEqual(audioRange("bytes=0-1",s),{start:0,end:1,partial:true});
 assert.deepEqual(audioRange("bytes=500-",s),{start:500,end:999,partial:true});
 assert.deepEqual(audioRange("bytes=-100",s),{start:900,end:999,partial:true});
 assert.deepEqual(audioRange("bytes=999-5000",s),{start:999,end:999,partial:true});
 for(const bad of ["bytes=1000-","bytes=9-1","bytes=-0","bytes=-","bytes=0-1,3-4","bytes=999999999999999999999-","items=0-1"])assert.equal(audioRange(bad,s),null,bad);
});
test("released recording is the credited unmodified source",async()=>{
 const b=await readFile(new URL("../christmas/first-snow-scott-buckley.mp3",import.meta.url));
 assert.equal(createHash("sha256").update(b).digest("hex"),"47650ff7ccc573df011a11d8440eb8c79e30fae31f61fc72750545efd41f6686");
});
