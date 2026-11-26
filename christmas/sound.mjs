// Default-on Christmas audio; a browser may require a trusted user gesture.
export function wireSound(button,feedback,config,state){
 const key="cafeEliteWinterMusic";
 let enabled=true,media,ctx,gain,playing=false,token=0,timer;
 try{enabled=localStorage.getItem(key)!=="off";}catch{}
 function reflect(message=""){
   state(button,enabled);
   button.querySelector("span").textContent=enabled?(playing?"On":"Ready"):"Off";
   button.title=enabled?(playing?"Turn Christmas music off":"Music enabled; waiting for browser playback permission. Click to turn off."):"Turn Christmas music on";
   feedback.textContent=message;
 }
 function remember(){try{localStorage.setItem(key,enabled?"on":"off");}catch{}}
 function ramp(to,duration){
   if(!gain)return;
   const t=ctx.currentTime,p=gain.gain;p.cancelScheduledValues(t);p.setValueAtTime(p.value,t);p.linearRampToValueAtTime(to,t+duration);
 }
 function init(){
   if(media)return;
   media=new Audio();media.preload="none";media.loop=true;
   try{media.volume=config.volume;}catch{}
   const Context=window.AudioContext||window.webkitAudioContext;
   if(Context){try{
     ctx=new Context();gain=ctx.createGain();gain.gain.value=0;
     const input=ctx.createMediaElementSource(media);
     input.connect(gain);gain.connect(ctx.destination);
     try{media.volume=1;}catch{}
   }catch{gain=null;}}
   // A platform that cannot apply quiet playback must not surprise users at full volume.
   if(!gain&&Math.abs(media.volume-config.volume)>.01)throw Error("Quiet playback unavailable");
   media.src=config.soundtrack;
 }
 async function play(){
   if(!enabled||document.hidden||playing)return;
   const id=++token;clearTimeout(timer);
   reflect("Music enabled. Tap to start if your browser blocks autoplay.");
   try{
     init();
     // Both calls must occur within the same trusted gesture when one is required.
     const resume=ctx?.resume();const start=media.play();
     await Promise.all([start,resume]);
     if(id!==token||!enabled||document.hidden)return;
     if(ctx&&gain&&ctx.state!=="running")throw Error("Audio not running");
     ramp(config.volume,.38);playing=true;reflect();
   }catch(error){
     if(id!==token)return;
     playing=false;media?.pause();
     if(error?.name==="NotAllowedError"||ctx?.state==="suspended"||ctx?.state==="interrupted"){
       reflect("Music enabled. Tap the page to start, or switch music off.");
     }else{
       reflect("Music could not play. Switch off or tap to retry.");
     }
   }
 }
 function pause(immediate){
   ++token;clearTimeout(timer);
   const wasPlaying=playing;playing=false;
   if(gain)ramp(0,immediate?0:.19);
   if(immediate||!gain||!wasPlaying)media?.pause();
   else timer=setTimeout(()=>media?.pause(),210);
   reflect();
 }
 button.addEventListener("click",()=>{
   enabled=!enabled;remember();
   if(enabled)void play();else pause(false);
 });
 // No synthetic clicks, muted-autoplay workaround, or blocked user action.
 function activate(event){
   if(!event.isTrusted||!enabled||playing||document.hidden||button.contains(event.target))return;
   if(event.type==="keydown"&&event.repeat)return;
   void play();
 }
 document.addEventListener("click",activate,true);
 document.addEventListener("touchend",activate,{capture:true,passive:true});
 document.addEventListener("keydown",activate,true);
 document.addEventListener("visibilitychange",()=>{if(document.hidden)pause(true);else if(enabled)void play();});
 window.addEventListener("pagehide",()=>pause(true));
 window.addEventListener("pageshow",e=>{if(e.persisted&&enabled)void play();});
 reflect();
 if(enabled)void play();
}
