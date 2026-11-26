const icon = d => `<svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const note = icon('<path d="M9 17V5l11-2v12M9 8l11-2"/><ellipse cx="6" cy="18" rx="3" ry="2.5"/><ellipse cx="17" cy="16" rx="3" ry="2.5"/>');
const snow = icon('<path d="M12 2v20M3.3 7l17.4 10M3.3 17 20.7 7M9 4l3 3 3-3M9 20l3-3 3 3M4 10l3-1-1-3m12 12-1-3 3-1M4 14l3 1-1 3m12-12-1 3 3 1"/>');
const opener = `<button type="button" class="yule-switch" id="yule-season" aria-label="Winter settings" title="Winter settings" aria-expanded="false" aria-controls="yule-tools">${snow}<span>Winter settings</span></button>`;
export const firstSnowCredit = `<span class="winter-creditline"><a href="https://www.scottbuckley.com.au/library/first-snow/" target="_blank" rel="noopener noreferrer">First Snow by Scott Buckley</a> · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">CC BY 4.0</a></span>`;
const tools = `<div class="yule-controls" id="yule-tools" role="group" aria-label="Winter settings" hidden><button type="button" id="yule-music" aria-pressed="false">${note} Christmas music <span>Off</span></button><button type="button" id="yule-effects" aria-pressed="false" title="Turn snowfall and seasonal motion on or off">${snow} Snowfall <span>Off</span></button>${firstSnowCredit}<span role="status" id="yule-feedback"></span></div>`;
const landscape = route => `<div class="yule-landscape yule-${route}" data-route="${route}" aria-hidden="true"><div class="yule-ridge"></div><div class="yule-drift"></div><div class="yule-track"><i></i><i></i><i></i></div></div>`;
const valance = '<div class="yule-valance" aria-hidden="true"><div class="yule-drift"></div></div>';
function before(html, find, prefix) {
  if(!html.includes(find)) throw new Error("Christmas theme needs updated template anchor: "+find);
  return html.replace(find,prefix+find);
}
export function dress(html,config) {
  const storefront="/christmas/cafe-elite-winter-front.jpg";
  html=html.replace(/<img src="assets\/cafe-front\.jpg"[^>]*>/g,tag=>tag
    .replace("assets/cafe-front.jpg",storefront)
    .replace('height="960"','height="973"')
    .replace('alt="CAFE ELITE on High Street, Leominster"','alt="Snow-covered Café Elite storefront on High Street, Leominster"'));
  html=before(html,"</head>",'<link rel="stylesheet" href="/christmas/winter.css"><script type="module" src="/christmas/winter.mjs"></script>');
  html=html.replace('<body>',`<body class="yule winter-magic" style="--foliage-scale:${config.foliageScale};--accumulation:${config.accumulation}">`).replace(/<div class="gold-spark-field"[^>]*><\/div>/g,"");
  html=before(html,'<div class="hero-content">','<div class="yule-crown" aria-hidden="true"><i class="yule-lamplight"></i></div><div class="yule-flurry" aria-hidden="true"></div>');
  html=html.replace('Fresh food. Proper coffee. Made with care.</h1>','Fresh food. <br>Proper coffee. <br>Made with <em>care.</em></h1>');
  html=before(html,'<button class="cart-toggle"',opener);
  html=before(html,"</header>",tools);
  html=before(html,'<div class="status-strip"',landscape("path"));
  html=before(html,'<section class="section signature-section"',landscape("orchard"));
  for(const anchor of ['<div class="section-heading section-heading--center new-at-heading">','<div class="new-product-body winter-poster-body">']){
    html=html.replace(anchor,anchor+valance);
  }
  for(const id of ["signature"]){
    const pattern=new RegExp('(<section [^>]*id="'+id+'"[^>]*>\\s*<div class="section-heading[^"]*">)');
    html=html.replace(pattern,"$1"+valance);
  }
  html=before(html,'<footer class="site-footer">',landscape("woods"));
  return html.replace("</body>",'<svg aria-hidden="true" focusable="false" width="0" height="0" class="winter-defs"><defs><clipPath id="yule-air" clipPathUnits="userSpaceOnUse"><path/></clipPath></defs></svg><div class="yule-weather" aria-hidden="true"></div></body>');
}
