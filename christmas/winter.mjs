import {winter} from "./config.mjs";
import {createPageSnow} from "./snowfall.mjs";
import {createDirector} from "./director.mjs";
import {wireSound} from "./sound.mjs";
const music=document.querySelector("#yule-music"),effects=document.querySelector("#yule-effects");
const weather=createPageSnow(document.querySelector(".yule-weather"),winter);
const director=createDirector(document.querySelectorAll("[data-route]"),winter);
const lantern=document.querySelector(".winter-poster-body .yule-valance");
const wick=new IntersectionObserver(([entry])=>lantern.toggleAttribute("data-lit",entry.isIntersecting));
wick.observe(lantern);
const reduced=matchMedia("(prefers-reduced-motion: reduce)");
let wantsMotion=true;
const shopping=()=>Boolean(document.querySelector("dialog[open]"));
function state(button,on){button.setAttribute("aria-pressed",String(on));button.querySelector("span").textContent=on?"On":"Off";}
function trackMotion(){
  const on=wantsMotion&&!document.hidden&&!reduced.matches&&!shopping();
  document.body.toggleAttribute("data-winter-active",on);director.enable(on);
  if(on)weather.start();else weather.stop();
}
function controls(){
  effects.disabled=reduced.matches;
  effects.title=reduced.matches?"Motion is off in your device settings":"Turn seasonal motion on or off";
  state(effects,wantsMotion&&!reduced.matches);trackMotion();
}
effects.addEventListener("click",()=>{wantsMotion=!wantsMotion;controls();});
reduced.addEventListener("change",controls);
const opener=document.querySelector("#yule-season"),panel=document.querySelector("#yule-tools"),header=opener.closest("header");
const navButton=header.querySelector(".nav-toggle");
function showTools(open,restoreFocus=false){
  if(open===panel.hidden)weather.layoutChanged(true);
  panel.hidden=!open;opener.setAttribute("aria-expanded",String(open));header.toggleAttribute("data-winter-open",open);
  if(open)music.focus({preventScroll:true});else if(restoreFocus)opener.focus({preventScroll:true});
}
opener.addEventListener("click",()=>{
  if(navButton.getAttribute("aria-expanded")==="true")navButton.click();
  showTools(panel.hidden);
});
document.addEventListener("pointerdown",e=>{if(!panel.hidden&&!opener.contains(e.target)&&!panel.contains(e.target))showTools(false);});
document.addEventListener("focusin",e=>{if(!panel.hidden&&!panel.contains(e.target)&&e.target!==opener)showTools(false);});
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!panel.hidden){e.preventDefault();showTools(false,true);}});
const modalObserver=new MutationObserver(()=>{if(shopping())showTools(false);trackMotion();});
for(const modal of document.querySelectorAll("dialog"))modalObserver.observe(modal,{attributes:true,attributeFilter:["open"]});
wireSound(music,document.querySelector("#yule-feedback"),winter,state);
document.addEventListener("visibilitychange",trackMotion);
window.addEventListener("pagehide",()=>{director.enable(false);weather.stop();});
window.addEventListener("pageshow",e=>{if(e.persisted)controls();});
if(["localhost","127.0.0.1"].includes(location.hostname))window.cafeWinterDeer=director.preview;
controls();
if(location.hash==="#winter-settings")showTools(true);
