import {collectMasks,paintAir} from "./protection.mjs";
const mod=(n,m)=>(n%m+m)%m;
const between=([a,b])=>a+Math.random()*(b-a);
function crystal(depth,variant){
  const tile=document.createElement("canvas");tile.width=tile.height=32;
  const c=tile.getContext("2d");
  c.translate(16,16);c.rotate(variant*.91+depth*.27);
  c.scale([1,.85,1.12][variant],[.76,1,.86][variant]);
  c.fillStyle=["#e8f0f5","#fafbfa","#f3f6f7"][depth];
  c.shadowColor="rgba(223,233,243,.64)";c.shadowBlur=[2,2,4][depth];
  c.filter=depth===2?"blur(1.7px)":"blur(.6px)";
  c.beginPath();
  for(let i=0;i<9;i++){
    const a=i*Math.PI*2/9,r=8.9+1.9*Math.cos(i*2.3+variant)+1.7*Math.sin(i+depth);
    if(!i)c.moveTo(r*Math.cos(a),r*Math.sin(a));else c.lineTo(r*Math.cos(a),r*Math.sin(a));
  }
  c.closePath();c.fill();
  if(depth===1&&variant===2){
    c.strokeStyle="#edf5ffb8";c.lineWidth=1.25;
    for(let i=0;i<6;i++){c.rotate(Math.PI/3);c.beginPath();c.moveTo(0,0);c.lineTo(0,-14);c.moveTo(0,-9);c.lineTo(3,-12);c.stroke();}
  }
  return tile;
}


export function createPageSnow(host,config){
 const canvas=document.createElement("canvas"),ctx=canvas.getContext("2d");
 if(!ctx)return {start(){},stop(){},layoutChanged(){}};
 const path=document.querySelector("#yule-air path"),sprites=[0,1,2].map(d=>[0,1,2].map(v=>crystal(d,v)));
 const floaters=[...document.querySelectorAll(".site-header,.menu-category-browser,.mobile-basket")];
 const qa=location.hostname==="127.0.0.1"&&new URLSearchParams(location.search).has("motion-review");
 let running=false,dirty=true,id,geometry,particles=[],rows=[],fixed=[],lastScroll=NaN,lastPaint=0,lastTick=0;
 let activeTime=0,epoch,clock=0,lag=16,span,width,height,ro,mo;
 function layoutChanged(beforeReflow=false){dirty=true;if(beforeReflow===true)canvas.hidden=true;}
 function prepare(){
   const w=host.clientWidth,h=canvas.clientHeight;
   if(!w||!h)return;
   if(w!==width||h!==height){
     const oldSpan=span;
     span=Math.max(oldSpan||0,h+32);width=w;height=h;canvas.width=w;canvas.height=h;
     if(oldSpan)for(const p of particles){const prev=mod(p.y+clock*p.speed,oldSpan);p.y=mod(prev,span)-clock*p.speed;}
   }
   const count=w<=740?config.mobileFlakes:config.desktopFlakes;
   if(particles.length>count)particles.length=count;
   for(let i=particles.length;i<count;i++){
     const k=(i*61%100)/100,d=k<.27?0:k<.89?1:2;
     particles.push({depth:d,variant:i%3,phase:Math.random()*6.28,x:Math.random(),y:Math.random()*span,
       speed:between(config.speeds[d])*config.snowSpeed,size:between([[3.2,5.8],[6,11.3],[12,18]][d]),
       alpha:between([[.48,.71],[.78,.98],[.64,.86]][d]),edge:i%5===0?(i%2?1:2):0});
   }
   canvas.dataset.particles=count;canvas.dataset.depths=[0,1,2].map(d=>particles.filter(p=>p.depth===d).length).join(",");
   geometry=collectMasks(host);paintAir(path,geometry,host.offsetHeight);
   dirty=false;lastScroll=NaN;
 }
 function tick(now){
   if(!running)return;id=requestAnimationFrame(tick);
   if(lastTick)lag=.94*lag+.06*(now-lastTick);lastTick=now;
   if(epoch===undefined)epoch=now;
   clock=activeTime+(now-epoch)/1000;
   const fps=lag>24?config.fallbackFps:config.snowFps;
   if(!dirty&&now-lastPaint<1000/fps-1)return;
   lastPaint=now;if(dirty){canvas.hidden=false;prepare();}if(!geometry||dirty)return;
   // Camera position is used ONLY to look up content occlusion. The canvas
   // is pinned by the compositor and particle trajectories have no scroll input.
   const camera=scrollY-geometry.top;
   if(camera!==lastScroll){
     const unique=new Set();
     for(let i=Math.floor(camera/96);i<=Math.ceil((camera+height)/96);i++)
       for(const box of geometry.rows.get(i)||[])unique.add(box);
     rows=[...unique];fixed=floaters.map(el=>el.getBoundingClientRect());lastScroll=camera;
   }
   ctx.clearRect(0,0,width,height);
   const breeze=config.wind*Math.sin(clock*.14);
   let probe;
   for(const [i,p] of particles.entries()){
     const sway=Math.sin(clock*(.47+p.depth*.14)+p.phase),drift=breeze+sway*(5+2*p.depth);
     const inset=2+p.x*(width<=740?16:Math.min(70,width*.055))+.25*drift;
     const x=p.edge?(p.edge===1?inset:width-inset):mod(p.x*width+drift,width+16)-8;
     const y=mod(p.y+clock*p.speed,span)-16;
     ctx.globalAlpha=p.alpha;ctx.drawImage(sprites[p.depth][p.variant],x,y,p.size,p.size*(.94+.11*Math.sin(p.phase)));
     if(qa&&i===15)probe={x,y,velocity:p.speed,span};
   }
   ctx.globalAlpha=1;
   for(const [l,t,r,b] of rows)ctx.clearRect(l,Math.floor(t-camera),r-l,Math.ceil(b-t)+1);
   for(const r of fixed)if(r.width&&r.height)ctx.clearRect(Math.floor(r.left)-2,Math.floor(r.top)-2,Math.ceil(r.width)+4,Math.ceil(r.height)+4);
   canvas.hidden=false;if(qa)canvas.winterFrame={...probe,time:now,clock,fps};
 }
 function start(){
   if(running)return;running=true;dirty=true;lastTick=0;lastPaint=0;epoch=undefined;host.append(canvas);
   ro=new ResizeObserver(layoutChanged);for(const e of [document.body,host,...floaters])ro.observe(e);
   mo=new MutationObserver(records=>{if(records.some(r=>!r.target.closest?.(".yule-landscape")))layoutChanged();});
   for(const e of document.querySelectorAll("main,.site-footer"))mo.observe(e,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:["hidden","open","src"]});
   window.addEventListener("resize",layoutChanged);document.addEventListener("load",layoutChanged,true);
   document.addEventListener("toggle",layoutChanged,true);document.fonts?.addEventListener("loadingdone",layoutChanged);id=requestAnimationFrame(tick);
 }
 function stop(){
   if(!running)return;running=false;activeTime=clock;cancelAnimationFrame(id);ro?.disconnect();mo?.disconnect();
   window.removeEventListener("resize",layoutChanged);document.removeEventListener("load",layoutChanged,true);
   document.removeEventListener("toggle",layoutChanged,true);document.fonts?.removeEventListener("loadingdone",layoutChanged);canvas.remove();
 }
 return {start,stop,layoutChanged};
}
