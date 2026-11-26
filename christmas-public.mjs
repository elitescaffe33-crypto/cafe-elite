// Exact seasonal allowlist. Never expose the preview runner, review evidence or private server module.
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { dress } from "./christmas-layout.mjs";
import { winter } from "./christmas/config.mjs";

export const CHRISTMAS_PUBLIC_FILES = Object.freeze(["christmas/winter.css","christmas/winter.mjs","christmas/config.mjs","christmas/snowfall.mjs","christmas/protection.mjs","christmas/director.mjs","christmas/sound.mjs","christmas/woodland.webp","christmas/woodland-small.webp","christmas/reindeer-stride.webp","christmas/counter-crown.webp","christmas/west-bough.webp","christmas/east-bells.webp","christmas/festoon.webp","christmas/botanical-fan.webp","christmas/hearth-light.webp","christmas/drift-ledger.webp","christmas/guild-seal.webp","christmas/orchard-path.webp","christmas/blue-hour-yard.webp","christmas/powder-sill.webp","christmas/winter-swag.webp","christmas/snow-shelf.webp","christmas/cafe-elite-winter-front.jpg","christmas/first-snow-scott-buckley.mp3"]);
const approved=new Set(CHRISTMAS_PUBLIC_FILES);
export const isChristmasPublicFile=path=>approved.has(path);
export const renderChristmasPage=html=>dress(html,winter);

// Single byte ranges support mobile Safari audio probes and seeking. No entire MP3 buffering.
export function audioRange(header,size){
 if(header===undefined)return {start:0,end:size-1,partial:false};
 const m=/^bytes=(\d*)-(\d*)$/.exec(header);
 if(!m||(!m[1]&&!m[2]))return null;
 let start,end;
 if(!m[1]){
   const suffix=Number(m[2]);if(!Number.isSafeInteger(suffix)||suffix<=0)return null;
   start=Math.max(0,size-suffix);end=size-1;
 }else{
   start=Number(m[1]);end=m[2]?Number(m[2]):size-1;
   if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>=size||start>end)return null;
   end=Math.min(size-1,end);
 }
 return {start,end,partial:true};
}
export async function serveChristmasAudio(request,response,file){
 const {size}=await stat(file);
 const range=audioRange(request.headers.range,size);
 response.setHeader("Accept-Ranges","bytes");
 if(!range){
   response.writeHead(416,{"Content-Range":"bytes */"+size,"Content-Length":"0","Content-Type":"audio/mpeg"});response.end();return;
 }
 const {start,end,partial}=range;
 const headers={"Content-Type":"audio/mpeg","Content-Length":end-start+1,"Cache-Control":"public, max-age=3600"};
 if(partial)headers["Content-Range"]="bytes "+start+"-"+end+"/"+size;
 response.writeHead(partial?206:200,headers);
 if(request.method==="HEAD"){response.end();return;}
 try{await pipeline(createReadStream(file,{start,end}),response);}
 catch(error){if(!response.destroyed)throw error;}
}
