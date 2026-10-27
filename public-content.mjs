import { getGroupId, getItemKey, getItemDisplayName, priceToPence, onlineMenuGroups } from "./menu-data.mjs";
import { availablePastaOffers, visibleMenuItems } from "./smart-pasta-deals.mjs";
import { partialAllergenHints } from "./partial-allergen-hints.mjs";
import { recordedProductIngredients, selectedSupplierPanels } from "./public-allergen-sources.mjs";

export const business = Object.freeze({
  name: "CAFE ELITE",
  url: "https://www.cafeelite.co.uk",
  address: "33 High Street, Leominster HR6 8LZ",
  legalName: "CAFFE ELITE LTD",
  companyNumber: "16996277",
  registeredOffice: "33 High Street, Leominster, United Kingdom, HR6 8LZ",
  companyRegistrationCountry: "England and Wales",
  telephone: "+447423772364",
  email: "elitescaffe33@gmail.com",
});

export function escapeMarkup(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

// This model cannot substantiate an allergen-free claim from an empty list.
export function getAllergenInfo(item) {
  const allergens = item?.allergens;
  const unknown = /^(unknown|unverified|not known|not verified|n\/a|none|no allergens|allergen[- ]free)(?:\b|$)/i;
  const verified = item?.allergenVerified === true && Array.isArray(allergens) && allergens.length > 0
    && allergens.every(value => typeof value === "string" && value.trim() && !unknown.test(value.trim()));
  return { verified, allergens: verified ? allergens.map(value => value.trim()) : [] };
}

// Owner-confirmed supplier packaging claim, not a cafe cross-contact guarantee.
export function supplierGlutenFreeBadge(item) {
  if (!["cake-carrot-cake", "cake-vanilla-cheesecake"].includes(item?.sourceId || item?.id)) return "";
  return '<div class="supplier-dietary-note"><span class="supplier-gf-badge">GLUTEN FREE</span><small>Supplier-labelled product. Shared equipment is used in our cafe; please ask about cross-contact before ordering.</small></div>';
}

// Carefully limited source-component observations: NOT verified finished-dish declarations.
// Every item below remains subject to missing ingredients, variant checks and kitchen review.
// Owner-transcribed/photographed supplier evidence: docs/owner-review/supplier-evidence.json
// and ALLERGEN_COMPONENT_REVIEW_V2_2026-10-21.json (neither is publicly served).
export const documentedIngredientWarnings = Object.freeze({
  "cake-lemon-cake": { contains: ["Wheat (gluten)", "Egg"], mayContain: ["Milk", "Nuts"] },
  "cake-orange-cake": { contains: ["Wheat (gluten)", "Egg", "Milk", "Soya"], mayContain: ["Nuts"] },
  "cake-victoria-sponge": { contains: ["Wheat (gluten)", "Egg", "Milk"], mayContain: ["Nuts"] },
  "cake-vanilla-cheesecake": { contains: ["Milk", "Egg"], mayContain: ["Nuts"] },
  "cake-fudge-cake": { contains: ["Wheat (gluten)", "Milk", "Soya"], mayContain: ["Nuts"] },
  "cake-carrot-cake": { contains: ["Egg", "Milk", "Walnuts (tree nuts)"], mayContain: ["Other tree nuts"] },
  "snack-vanilla-cupcake": { contains: ["Wheat (gluten)", "Egg", "Milk", "Soya"], mayContain: ["Nuts"] },
  "snack-lemon-cupcake": { contains: ["Wheat (gluten)", "Egg", "Milk"], mayContain: ["Nuts"] },
  "snack-chocolate-cupcake": { contains: ["Wheat (gluten)", "Egg", "Milk", "Soya"], mayContain: ["Nuts"] },
  "snack-pink-cupcake": { contains: ["Wheat (gluten)", "Egg", "Milk"], mayContain: ["Nuts"] },
  "snack-mini-cheddars": { contains: ["Wheat and Barley (gluten)", "Milk"], mayContain: null },
  "snack-cookies": { contains: ["Wheat and Oats (gluten cereals)", "Milk"], mayContain: ["Other gluten cereals", "Egg", "Soya", "Nuts"] },
  "snack-muffins": { contains: ["Wheat (gluten)", "Egg", "Milk"], mayContain: null,
    note: "Chocolate Chip and Double Chocolate also list Soya. Each muffin flavour requires its own supplier and precautionary allergen check." },
  "pasta-bolognese-bowl": { contains: ["Wheat (gluten)"], mayContain: null, note: "This identifies the spaghetti ingredient only; sauce declarations remain incomplete." },
  "pasta-chicken-tomato": { contains: ["Wheat (gluten)"], mayContain: null, note: "This identifies the penne ingredient only; sauce and chicken declarations remain incomplete." },
  "pasta-tomato-pasta": { contains: ["Wheat (gluten)"], mayContain: null, note: "This identifies the spaghetti ingredient only; sauce declarations remain incomplete." },
  "pasta-garlic-yogurt-pasta": { contains: ["Wheat (gluten)", "Milk"], mayContain: null, note: "This identifies the pasta and homemade dairy-yogurt ingredients only; other supplier information remains incomplete." },
});

export function selectedAllergenSummary(item, selectedOptions = {}) {
  // This is only a partial supplier-component observation, NEVER a safe-to-eat claim.
  // In particular, unselected deal/bread/muffin options must not be silently assumed.
  if (!selectedOptions || typeof selectedOptions !== "object" || Array.isArray(selectedOptions)) return "";
  const known = new Set(), precaution = new Set(), incomplete = [], recordedPanels = [];
  const choices = partialAllergenHints.choices;
  const names = {
    bread: "Bread", milk: "Milk", syrup: "Syrup", muffinFlavour: "Muffin flavour",
  };
  let anyChoice = false;
  for (const type of Object.keys(names)) {
    const value = selectedOptions[type];
    if (typeof value !== "string" || !value || value === "No syrup" || value === "No milk") continue;
    anyChoice = true;
    const info = Object.hasOwn(choices[type], value) ? choices[type][value] : null;
    if (!info || info.incomplete) incomplete.push(names[type] + " (" + value + ")");
    if (info) {
      for (const allergen of info.contains) known.add(allergen);
      for (const allergen of info.supplierMayContain) precaution.add(allergen);
    }
    const recordedPanel = selectedSupplierPanels[type]?.[value];
    if (recordedPanel) recordedPanels.push(recordedPanel);
  }
  const itemHasVariableComponents = Boolean(item?.deal);
  if (!anyChoice && !itemHasVariableComponents) return "";
  const parts = [
    "Selected options — supplier-component information only (PARTIAL, NOT a complete dish allergen declaration).",
  ];
  if (known.size) parts.push("Known allergen ingredients in selected options: " + [...known].sort().join(", ") + ".");
  if (precaution.size) parts.push("Selected option supplier MAY CONTAIN notices: " + [...precaution].sort().join(", ") + ".");
  if (incomplete.length) parts.push("Full supplier declarations remain unverified for: " + incomplete.join("; ") + ".");
  if (recordedPanels.length) parts.push(...recordedPanels);
  if (itemHasVariableComponents) parts.push("The chosen deal components and their kitchen cross-contact risks are not fully verified.");
  parts.push("Contact the cafe before paying about allergies and confirm at collection; selecting an option does not establish that it is allergy-safe.");
  return " " + parts.join(" ");
}

export function allergenDisclosure(item) {
  const info = getAllergenInfo(item);
  const productId = item?.sourceId || item?.id;
  const mapped = Object.hasOwn(partialAllergenHints.products, productId || "") ? partialAllergenHints.products[productId] : null;
  const documented = documentedIngredientWarnings[productId] || null;
  const evidence = documented || (mapped?.hasSupplierComponents
    && (mapped.contains.length || mapped.supplierMayContain.length)
      ? { contains: mapped.contains, mayContain: mapped.supplierMayContain,
          note: "These known declarations cover documented ingredients only, not the complete dish." }
      : null);
  const sourcedMayContain = [...new Set([
    ...(documented?.mayContain || []),
    ...(mapped?.hasSupplierComponents ? mapped.supplierMayContain : []),
  ])];
  let text;
  if (info.verified) {
    text = "Contains: " + info.allergens.join(", ") + ". Please speak to our team about cross-contact.";
  } else if (evidence) {
    text = "Known ingredient allergens from available supplier information (PARTIAL, not a complete finished-food declaration): "
      + (evidence.contains?.length ? evidence.contains.join(", ") : "not established from these source records") + "."
      + (sourcedMayContain.length ? " Supplier labels also say MAY CONTAIN: " + sourcedMayContain.join(", ") + "." : "")
      + (evidence.note ? " " + evidence.note : "")
      + " Other ingredients and kitchen cross-contact are not fully verified. Please speak to our team before paying and confirm the information at collection.";
  } else {
    text = "Verified allergen information is not available online for this item or its selected options. Please speak to our team before ordering and confirm information at collection.";
  }
  const recorded = recordedProductIngredients(item);
  const ingredientLines = recorded.ingredients.length
    ? `<p class="recorded-recipe-ingredients"><strong>${escapeMarkup(recorded.label)}:</strong> ${escapeMarkup(recorded.ingredients.join(", "))}.</p>`
    : `<p class="recorded-recipe-ingredients">Full ingredients are not transcribed in this online record; ask our team to check the actual product pack or recipe before ordering.</p>`;
  const recordedComponents = recorded.componentNotes.map(note =>
    `<p class="recorded-supplier-ingredients">${escapeMarkup(note)}</p>`).join("");
  return `<details class="menu-product-ingredients allergen-info"><summary>Ingredients &amp; allergen info<span class="sr-only"> for ${escapeMarkup(getItemDisplayName(item))}</span></summary>${ingredientLines}${recordedComponents}<p data-allergen-review-text>${escapeMarkup(text)}</p></details>`;
}

export function cafeSchema(settings) {
  const weekdays = { monday: "Monday", tuesday: "Tuesday", wednesday: "Wednesday", thursday: "Thursday", friday: "Friday", saturday: "Saturday", sunday: "Sunday" };
  return {
    "@context": "https://schema.org", "@type": "CafeOrCoffeeShop",
    name: business.name, legalName: business.legalName, telephone: business.telephone, email: business.email,
    identifier: { "@type": "PropertyValue", propertyID: "Companies House company number", value: business.companyNumber },
    url: business.url + "/", hasMenu: business.url + "/#menu",
    image: business.url + "/assets/cafe-front.jpg",
    address: { "@type": "PostalAddress", streetAddress: "33 High Street", addressLocality: "Leominster", postalCode: "HR6 8LZ", addressCountry: "GB" },
    openingHoursSpecification: Object.entries(settings.ordering.days).filter(([key, day]) => weekdays[key] && day.open && day.close && day.enabled !== false).map(([key, day]) => ({ "@type": "OpeningHoursSpecification", dayOfWeek: "https://schema.org/" + weekdays[key], opens: day.open, closes: day.close })),
  };
}

export function renderPastaPromotions(groups, settings) {
  const products = new Map(groups.flatMap(group => group.items).map(item => [item.id, item]));
  const promos = availablePastaOffers(groups, settings).map(group => {
    const cheapest = Math.min(...group.products.map(id => {
      const item = products.get(id);
      return priceToPence(settings.menuPrices?.[getItemKey(item)] || settings.menuPrices?.[item.name] || item.price);
    }));
    const offer = group.offers.find(offer => offer.quantity === 2 && offer.price < cheapest * 2);
    if (!offer) return "";
    const names = group.products.map(id => getItemDisplayName(products.get(id)));
    return `<section class="pasta-promotion" aria-label="${escapeMarkup(group.name)}"><h4>${escapeMarkup(group.name)}</h4><strong>Any 2 for &pound;${(offer.price / 100).toFixed(2)}</strong><p>${names.length > 1 ? "Mix &amp; match " : "Choose "}${escapeMarkup(names.join(" and "))}.</p><small>Add any two to your basket. Your discount applies automatically.</small></section>`;
  }).join("");
  return promos ? `<div class="pasta-promotions">${promos}</div>` : "";
}

export function renderPublicPage(html, groups, settings) {
  const description = "Fresh food and proper coffee from an independent High Street cafe in Leominster. Browse the menu and order for collection from 33 High Street.";
  const metadata = `<link rel="canonical" href="${business.url}/" />
    <meta property="og:type" content="website" /><meta property="og:url" content="${business.url}/" />
    <meta property="og:title" content="CAFE ELITE Leominster | Fresh Food, Coffee &amp; Collection" />
    <meta property="og:description" content="${description}" /><meta property="og:site_name" content="CAFE ELITE" />
    <meta property="og:image" content="${business.url}/assets/cafe-front.jpg" /><meta property="og:image:alt" content="CAFE ELITE on High Street, Leominster" />
    <meta name="twitter:card" content="summary_large_image" /><meta name="twitter:title" content="CAFE ELITE Leominster" /><meta name="twitter:description" content="${description}" /><meta name="twitter:image" content="${business.url}/assets/cafe-front.jpg" />
    <script type="application/ld+json">${JSON.stringify(cafeSchema(settings)).replace(/</g, "\\u003c")}</script>`;
  // Semantic HTML is replaced by the existing single-category browser after JS loads.
  const directory = onlineMenuGroups(groups).filter(group => getGroupId(group) !== "signature-picks").map(group => `<details class="menu-directory" id="menu-${escapeMarkup(getGroupId(group))}"><summary>${escapeMarkup(group.category)}</summary>${getGroupId(group) === "pasta" ? renderPastaPromotions(groups, settings) : ""}<ul>${visibleMenuItems(group).map(({ item }) => {
    const price = settings.menuPrices?.[getItemKey(item)] || settings.menuPrices?.[item.name] || item.price;
    return `<li><h3>${escapeMarkup(getItemDisplayName(item))}</h3>${item.description ? `<p>${escapeMarkup(item.description)}</p>` : ""}<p>${escapeMarkup(price)}</p>${allergenDisclosure(item)}${supplierGlutenFreeBadge(item)}</li>`;
  }).join("")}</ul></details>`).join("");
  return html.replace("<!-- PUBLIC_METADATA -->", metadata).replace("<!-- SERVER_MENU -->", directory);
}

export function robotsText() {
  return `User-agent: *\nAllow: /\nDisallow: /admin.html\nDisallow: /api/\nDisallow: /success.html\nSitemap: ${business.url}/sitemap.xml\n`;
}
export function sitemapXml() {
  return '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + ["/", "/privacy.html", "/terms.html", "/allergens.html"].map(path => `<url><loc>${business.url}${path}</loc></url>`).join("") + "</urlset>";
}
