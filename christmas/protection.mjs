const protectedBoxes = [
  "img","picture","figure","iframe","button","a","input","textarea","select",
  "summary","form","nav","[role=button]",".new-product-card:not(#winter-warmers)",
  ".menu-product-card",".signature-card",".status-strip span",".promo-price"
].join(",");
const roots = () => [...document.querySelectorAll("main,.site-footer")];
const bucketSize=96;



export function collectMasks(host){
  const bounds=host.getBoundingClientRect(),boxes=[];
  const record=r=>{
    if(r.width&&r.height)boxes.push([Math.floor(r.left-bounds.left)-3,Math.floor(r.top-bounds.top)-3,
      Math.ceil(r.right-bounds.left)+3,Math.ceil(r.bottom-bounds.top)+3]);
  };
  const range=document.createRange();
  function visit(el){
    if(el.hidden||el.matches("script,style,template,dialog,.yule-valance,.yule-landscape,.yule-crown"))return;
    // The shopfront is aria-hidden for accessibility but still a protected image.
    if(el.matches(protectedBoxes)||(el.scrollWidth>el.clientWidth+1&&["auto","scroll"].includes(getComputedStyle(el).overflowX))){record(el.getBoundingClientRect());return;}
    for(const n of el.childNodes){
      if(n.nodeType===1){if(n.matches(".hero-media")){record(n.getBoundingClientRect());}else visit(n);}
      else if(n.nodeType===3&&n.textContent.trim()){
        range.selectNodeContents(n);
        for(const rect of range.getClientRects())record(rect);
      }
    }
  }
  for(const root of roots())visit(root);
  const rows=new Map();
  for(const box of boxes){
    for(let row=Math.floor((box[1]-24)/bucketSize);row<=Math.floor((box[3]+24)/bucketSize);row++){
      if(!rows.has(row))rows.set(row,[]);rows.get(row).push(box);
    }
  }
  return {boxes,rows,top:bounds.top+scrollY,width:Math.round(bounds.width)};
}


// Clip the *scrolling parent*, not the particle clock. During an asynchronous
// scroll, the compositor moves these cut-outs together with their content.
export function paintAir(path, geometry, height){
  const {boxes,width}=geometry,events=new Map(),active=new Set();
  const edge=(y,b,add)=>{y=Math.min(height,Math.max(0,y));if(!events.has(y))events.set(y,[]);events.get(y).push([b,add]);};
  events.set(0,[]);events.set(height,[]);
  for(const b of boxes){edge(b[1],b,true);edge(b[3],b,false);}
  const ys=[...events.keys()].sort((a,b)=>a-b),d=[];
  for(let i=0;i<ys.length-1;i++){
    const y=ys[i],h=ys[i+1]-y;
    for(const [b,add] of events.get(y)){if(add)active.add(b);else active.delete(b);}
    let x=0;
    const span=r=>{if(r>x)d.push("M"+x+" "+y+"h"+(r-x)+"v"+h+"H"+x+"z");};
    for(const b of [...active].sort((a,b)=>a[0]-b[0])){
      const l=Math.max(0,Math.min(width,b[0])),r=Math.max(0,Math.min(width,b[2]));
      span(l);x=Math.max(x,r);
    }
    span(width);
  }
  path.setAttribute("d",d.join(""));
}
