import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {menuData, getItemKey} from "../menu-data.mjs";
import {defaultSiteSettings} from "../site-settings.mjs";
import {recordedProductIngredients,ownerCurrentRecipeDeclarations} from "../public-allergen-sources.mjs";
import {allergenDisclosure,documentedIngredientWarnings,renderPublicPage} from "../public-content.mjs";
import {partialAllergenHints} from "../partial-allergen-hints.mjs";

const pasta=menuData.find(group=>group.id==="pasta");
const canonical=pasta.items.find(item=>item.id==="pasta-chicken-tomato");
const plain=pasta.items.find(item=>item.id==="pasta-tomato-pasta");
const signature=menuData.find(group=>group.id==="signature-picks").items
  .find(item=>item.id==="signature-chicken-tomato-pasta");
const latest=ownerCurrentRecipeDeclarations["pasta-chicken-tomato"];

const exactIngredients=[
  "Penne pasta (WHEAT)",
  "cooked chicken breast (chicken, salt)",
  "chopped tomatoes",
  "tomato purée",
  "butter (MILK)",
  "sunflower oil",
  "garlic",
  "oregano",
  "black pepper",
  "salt",
];
const exactIngredientText=exactIngredients.join(", ")+".";

test("Recipe is exactly owner-provided, with no previous sauce components silently added",()=>{
  assert.ok(canonical);
  assert.deepEqual(latest.ingredients,exactIngredients);
  assert.deepEqual(canonical.ingredients,exactIngredients);
  assert.deepEqual(recordedProductIngredients(canonical).ingredients,exactIngredients);
  assert.ok(!latest.ingredients.includes("Dried tomato"));
  assert.ok(!latest.ingredients.includes("Onion"));
  assert.ok(!latest.ingredients.includes("De Cecco Penne"));
  assert.ok(!latest.ingredients.includes("Garlic powder"));
  assert.equal(canonical.name,"Chicken Tomato Pasta");
  assert.equal(getItemKey(canonical),"pasta-chicken-tomato");
});
test("Signature Chicken Tomato Pasta links to the same updated canonical recipe",()=>{
  assert.ok(signature);
  assert.equal(signature.sourceId,"pasta-chicken-tomato");
  assert.deepEqual(recordedProductIngredients(signature).ingredients,exactIngredients);
  const disclosed=allergenDisclosure(signature);
  assert.ok(disclosed.includes(exactIngredientText));
  assert.match(disclosed,/for Chicken Tomato Pasta/);
});
test("Allergen labels preserve owner wording and distinguish actual ingredients vs pasta may contain",()=>{
  assert.deepEqual(latest.allergens,["WHEAT (GLUTEN)","MILK"]);
  assert.deepEqual(latest.mayContain,["SOYA","MUSTARD"]);
  assert.equal(latest.mayContainSource,"pasta");
  const disclosed=allergenDisclosure(canonical);
  assert.ok(disclosed.includes("<strong>Ingredients:</strong> "+exactIngredientText));
  assert.ok(disclosed.includes("<strong>Allergens:</strong> WHEAT (GLUTEN), MILK."));
  assert.ok(disclosed.includes("<strong>May contain:</strong> SOYA, MUSTARD (pasta)."));
  assert.ok(disclosed.includes("kitchen cross-contact"));
  assert.ok(!disclosed.includes("PARTIAL, not a complete finished-food declaration"));
  assert.ok(!disclosed.includes("sauce and chicken declarations remain incomplete"));
  assert.equal((disclosed.match(/<strong>Ingredients:<\/strong>/g)||[]).length,1);
  assert.equal((disclosed.match(/<strong>Allergens:<\/strong>/g)||[]).length,1);
  assert.equal((disclosed.match(/<strong>May contain:<\/strong>/g)||[]).length,1);
});
test("Source-component allergen hints also include newly disclosed milk, without losing pasta precautions",()=>{
  const hints=partialAllergenHints.products["pasta-chicken-tomato"];
  assert.ok(hints.contains.includes("Cereals containing gluten"));
  assert.ok(hints.contains.includes("Milk"));
  assert.ok(hints.supplierMayContain.includes("Soya"));
  assert.ok(hints.supplierMayContain.includes("Mustard"));
  const supporting=documentedIngredientWarnings["pasta-chicken-tomato"];
  assert.ok(supporting.contains.includes("Milk"));
  assert.ok(supporting.mayContain.includes("Soya"));
  assert.ok(supporting.mayContain.includes("Mustard"));
});
test("Regular Tomato Pasta remains on its previously recorded distinct spaghetti recipe",()=>{
  assert.ok(plain);
  assert.equal(plain.name,"Tomato Pasta");
  assert.deepEqual(plain.ingredients,["De Cecco Spaghetti","Homemade CAFE ELITE tomato sauce"]);
  const previous=recordedProductIngredients(plain).ingredients;
  assert.equal(previous[0],"De Cecco Spaghetti");
  assert.ok(previous[1].includes("Dried tomato"));
  assert.ok(!previous.some(ingredient=>ingredient.includes("chicken")));
  assert.ok(!Object.hasOwn(ownerCurrentRecipeDeclarations,"pasta-tomato-pasta"));
  assert.ok(allergenDisclosure(plain).includes("PARTIAL"));
});
test("All menu prices, names, codes and essential order labels stay unchanged",()=>{
  assert.equal(canonical.price,"£8.99");
  assert.equal(plain.price,"£6.99");
  assert.equal(signature.price,"£8.99");
  assert.ok(!Object.hasOwn(ownerCurrentRecipeDeclarations,"pasta-bolognese-bowl"));
  assert.equal(Object.keys(ownerCurrentRecipeDeclarations).length,1);
});
test("Server-rendered public menu displays the same current ingredients and exact allergen text",()=>{
  const generated=renderPublicPage(
    "<!doctype html><head><!-- PUBLIC_METADATA --></head><body><!-- SERVER_MENU --></body>",
    menuData,defaultSiteSettings
  );
  assert.ok(generated.includes("Chicken Tomato Pasta"));
  assert.ok(generated.includes("Penne pasta (WHEAT)"));
  assert.ok(generated.includes(exactIngredientText));
  assert.ok(generated.includes("<strong>Allergens:</strong> WHEAT (GLUTEN), MILK."));
  assert.ok(generated.includes("<strong>May contain:</strong> SOYA, MUSTARD (pasta)."));
  assert.ok(generated.includes("De Cecco Spaghetti"));
});
test("Live browser uses same allergenDisclosure function as server, not a second stale list",async()=>{
  const script=await readFile(new URL("../script.js",import.meta.url),"utf8");
  const server=await readFile(new URL("../server.mjs",import.meta.url),"utf8");
  assert.match(script,/allergenDisclosure\(item\)/);
  assert.match(server,/renderPublicPage\(body\.toString\(\), buildMenuData\(settings\), settings\)/);
});
test("Changed text remains inert HTML, avoiding dish content injection vulnerabilities",()=>{
  const malicious={...canonical,name:'Chicken <img src=x onerror="alert(1)"> Tomato'};
  const result=allergenDisclosure(malicious);
  assert.ok(!result.includes('<img src=x onerror="alert(1)">'));
  assert.ok(result.includes("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"));
});
