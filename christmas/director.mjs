// One opportunity clock, three locations. An empty viewport never spends a cue.
export function createDirector(routes,settings){
 const visible=new Map(),range=([a,b])=>a+Math.random()*(b-a);
 let active=false,pass=null,timer,due=0,remaining=range(settings.firstPass),start=0,lastRoute,observer;
 function finish(completed){
   if(!pass)return;
   pass.classList.remove("running");pass=null;
   due=performance.now()+(completed?range(settings.nextPass):350);
   schedule();
 }
 function end(e){if(e.target===pass&&e.animationName.includes("cross"))finish(true);}
 function choice(){return [...visible].filter(([,ratio])=>ratio>.28).sort(([a,x],[b,y])=>y-x+(a===lastRoute?.01:0)-(b===lastRoute?.01:0))[0]?.[0];}
 function play(){
   const route=choice();if(!active||!route||pass)return false;
   clearTimeout(timer);pass=route.querySelector(".yule-track");lastRoute=route;start=performance.now();
   pass.classList.add("running");return true;
 }
 function schedule(){
   clearTimeout(timer);if(!active||pass||!choice())return;
   timer=setTimeout(play,Math.max(0,due-performance.now()));
 }
 function enable(on){
   if(active===on)return;active=on;
   if(on){
     due=performance.now()+remaining;
     observer=new IntersectionObserver(entries=>{
       for(const e of entries)visible.set(e.target,e.intersectionRatio);
       if(pass&&!visible.get(lastRoute))finish(performance.now()-start>2000);
       schedule();
     },{threshold:[0,.29,.5,.85,1]});
     for(const r of routes){r.addEventListener("animationend",end);observer.observe(r);}
   }else{
     remaining=pass?range(settings.nextPass):Math.max(0,due-performance.now());
     clearTimeout(timer);observer?.disconnect();visible.clear();
     pass?.classList.remove("running");pass=null;
     for(const r of routes)r.removeEventListener("animationend",end);
   }
 }
 return {enable,preview:()=>active&&(Boolean(pass)||play())};
}
