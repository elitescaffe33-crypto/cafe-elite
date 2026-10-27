// Source-limited, owner-provided café recipe and photographed supplier information.
// No `May Contain` claim is inferred when a supplier statement is absent.
const tomatoSauce = [
  "Chopped tomato", "Dried tomato", "Onion", "Tomato paste",
  "Sunflower oil", "Salt", "Pepper", "Garlic powder",
];
const tomatoSauceText = "Homemade CAFE ELITE tomato sauce (" + tomatoSauce.join(", ") + ")";

// The owner explicitly confirmed these recipes in the archived evidence.
// Compound-food suppliers' untranscribed sub-ingredients are not invented.
const ownerRecipeIngredients = Object.freeze({
  "pasta-tomato-pasta": ["De Cecco Spaghetti", tomatoSauceText],
  "pasta-chicken-tomato": ["De Cecco Penne", tomatoSauceText, "Cooked chicken breast strips"],
});

const sourceComponentIngredients = Object.freeze({
  "pasta-bolognese-bowl": [
    "Photographed Knorr beef-stock ingredient panel: Salt, flavour enhancers (MSG, disodium inosinate, disodium guanylate), palm fat, flavourings, starch, yeast extract, fully hydrogenated palm fat, extra virgin olive oil, sugar, colour (ammonia caramel), beef powder (beef, rosemary extract).",
  ],
  "baguette-tuna-mayo": ["Photographed Nixe tuna ingredient panel: Tuna (Fish), Water, Salt."],
  "sandwich-tuna-gherkin": ["Photographed Nixe tuna ingredient panel: Tuna (Fish), Water, Salt."],
  "baguette-beef-pastrami-cheese": [
    "Owner-matched Hall's Select pastrami ingredient panel: Beef brisket, Salt, Potato starch, Stabilisers (diphosphates, triphosphates), Antioxidant (sodium ascorbate), Preservative (sodium nitrite), Cracked black pepper.",
  ],
  "sandwich-beef-pastrami-cheese": [
    "Owner-matched Hall's Select pastrami ingredient panel: Beef brisket, Salt, Potato starch, Stabilisers (diphosphates, triphosphates), Antioxidant (sodium ascorbate), Preservative (sodium nitrite), Cracked black pepper.",
  ],
});

const oatIngredientPanel = [
  "Water", "Wholegrain oat flakes (10%)", "Rapeseed oil", "Potassium phosphates",
  "Calcium carbonate", "Sea salt", "Gellan gum", "Vitamin B12", "Riboflavin", "Vitamin D",
];

export const selectedSupplierPanels = Object.freeze({
  milk: Object.freeze({
    "Oat milk": "Photographed current Aldi 10% oat drink ingredients: " + oatIngredientPanel.join(", ") + ".",
  }),
  syrup: Object.freeze({
    "Salted Caramel Sugar Free": "The photographed syrup ingredient list includes sodium metabisulphite (E223), and its supplier states MAY CONTAIN Wheat and Soya. This is a partial ingredient record; finished-drink sulphite quantity is not established.",
    "Tiramisu": "The photographed Tiramisu syrup asks the customer to peel back a label; the complete ingredient declaration is not available in the café's recorded evidence.",
  }),
  muffinFlavour: Object.freeze({
    "Cherry": "Important source discrepancy: the manufacturer's public Cherry muffin information lists sulphur dioxide, but the café's exact photographed pack/version has not been reconciled. Do not assume this muffin is suitable for someone with sulphite sensitivity.",
  }),
  bread: Object.freeze({
    "Brown": "Photographed Warburtons wholemeal bread pack says it is produced in a bakery which uses Milk and Sesame; this is a facility statement, not a new ingredient or an invented 'May Contain' warning.",
  }),
});

export function recordedProductIngredients(item) {
  const productId = item?.sourceId || item?.id;
  const ownerRecipe = ownerRecipeIngredients[productId];
  const list = ownerRecipe || (Array.isArray(item?.ingredients) ? item.ingredients : []);
  const ingredients = list.filter(value => typeof value === "string" && value.trim()).map(value => value.trim());
  const componentNotes = sourceComponentIngredients[productId] || [];
  return {
    ingredients,
    // Sandwich/baguette source lists name fillings; bread/condiments are not always expanded.
    label: ["sandwiches", "fresh-baguettes"].includes(item?.categoryId)
      ? "Recorded fillings (bread and supplier sub-ingredients are separate)"
      : "Recorded café recipe ingredients",
    componentNotes,
    isPartial: Boolean(componentNotes.length || ingredients.length),
  };
}
