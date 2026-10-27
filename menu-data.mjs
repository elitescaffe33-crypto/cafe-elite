const gbp = (amount) => `\u00a3${amount}`;

export const MENU_PRICES = Object.freeze({
  sandwichDeal: gbp("6.99"),
  baguetteDeal: gbp("7.50"),
  freshBaguette: gbp("4.50"),
  bologneseBowl: gbp("8.99"),
  bologneseTwo: gbp("16.99"),
  bologneseThree: gbp("24.99"),
  bologneseFamily: gbp("32.99"),
  tomatoPasta: gbp("6.99"),
  chickenTomatoPasta: gbp("8.99"),
  garlicYogurtPasta: gbp("6.99"),
  twoBowls: gbp("11.99"),
  threeBowls: gbp("18.99"),
  familyBowls: gbp("21.99"),
  sandwich: gbp("2.99"),
  autumnDrink: gbp("4.40"),
  latte: gbp("3.60"),
  americano: gbp("3.30"),
  cappuccino: gbp("3.60"),
  flatWhite: gbp("3.60"),
  espresso: gbp("2.40"),
  doubleEspresso: gbp("2.65"),
  mocha: gbp("3.90"),
  hotChocolate: gbp("3.95"),
  iceLatte: gbp("4.20"),
  tea: gbp("2.40"),
  syrup: gbp("0.50"),
  softDrink: gbp("1.50"),
  juice: gbp("1.75"),
  cake: gbp("2.99"),
  muffin: gbp("1.99"),
  snack: gbp("1.99"),
  yogurt: gbp("0.59"),
});

export const SYRUP_PRICE = MENU_PRICES.syrup;

// Retired IDs remain reserved so old admin overrides cannot revive them.
export const RETIRED_PRODUCT_IDS = Object.freeze([
  "snack-carrot-loaf-slice", "snack-lemon-loaf-slice", "snack-chocolate-loaf-slice",
  "snack-cornetto-hazelnut-chocolate", "snack-solero-exotic",
  "extra-add-syrup", "extra-homemade-yogurt-pot",
]);
export function isRetiredProduct(item) {
  return [item?.id, item?.sourceId, item?.priceKey].some(id => RETIRED_PRODUCT_IDS.includes(id));
}

// Archived IDs remain available to historical records, not new online orders.
export function onlineMenuGroups(groups) {
  return groups.map(group => ({ ...group, items: group.items.filter(item => !isRetiredProduct(item)) }))
    .filter(group => group.items.length);
}

export const CUPCAKE_VARIANTS = Object.freeze([
  { id: "snack-chocolate-cupcake", name: "Chocolate Cupcake" },
  { id: "snack-vanilla-cupcake", name: "Vanilla Cupcake" },
  { id: "snack-lemon-cupcake", name: "Lemon Cupcake" },
  { id: "snack-pink-cupcake", name: "Strawberry Cupcake" },
]);

// Exact legacy settings signatures verified by the owner; never fuzzy-match products.
const redundantLegacyCustomProducts = [
  { id: "tea-pomegranate", name: "Pomegranate", category: "Teas", legacyId: null, price: gbp("2.40") },
  { id: "tea-blueberry", name: "Blueberry", category: "Teas", legacyId: null, price: gbp("2.40") },
  { id: "tea-fresh-orange", name: "Fresh Orange", category: "Teas", legacyId: null, price: gbp("2.40") },
  { id: "tea-italian-lemon", name: "Italian Lemon", category: "Teas", legacyId: null, price: gbp("2.40") },
  { id: "cake-vanilla-cheesecake", name: "Cheesecake", category: "Cakes", legacyId: "custom-cakes-cheesecake", price: gbp("2.99") },
];

export function isRedundantLegacyCustomItem(item) {
  if (!item || (item.description != null && item.description !== "")) return false;
  const legacy = redundantLegacyCustomProducts.find(entry =>
    item.name === entry.name && item.category === entry.category && item.price === entry.price
    && (entry.legacyId === null ? item.id == null : item.id === entry.legacyId)
    && (item.priceKey == null || item.priceKey === entry.legacyId));
  // Only suppress an override while its canonical product exists in the base catalogue.
  return Boolean(legacy && menuData.some(group => group.category === legacy.category
    && group.items.some(product => product.id === legacy.id && product.name === legacy.name)));
}

const coffeeChoices = [
  "Latte",
  "Americano",
  "Cappuccino",
  "Flat White",
  "Espresso",
  "2X Espresso",
  "Mocha",
  "Hot Chocolate",
  "Ice Latte",
];

const sandwichChoices = [
  "Vegetarian Egg",
  "Tuna & Gherkin",
  "Classic Ham & Cheese",
];

const baguetteChoices = [
  "Beef Pastrami & Cheese",
  "Classic Ham & Cheese",
  "Tuna Mayo",
  "Vegetarian Egg",
];

const snackChoices = [
  "Muffins",
  "Cookies",
  "Chocolate Cupcake",
  "Vanilla Cupcake",
  "Pink Cupcake",
  "Mini Cheddars",
  "Ready Salted Chips",
];

const bowlChoices = [
  "Tomato Pasta",
  "Garlic Yogurt Pasta",
];

const syrupChoices = [
  "Caramel",
  "Toffee Nut",
  "Hazelnut",
  "Vanilla",
  "French Vanilla Sugar Free",
  "Cinnamon",
  "Gingerbread",
  "Pumpkin Spice",
  "Mint",
  "Cherry",
  "Tiramisu",
  "Salted Caramel Sugar Free",
];

// Drink customisation is a priced choice on the drink, not a client-trusted line item.
// Preserve approved catalogue prices and the legacy standalone syrup reference.
export const MUFFIN_FLAVOURS = Object.freeze(["Blueberry", "Cherry", "Chocolate Chip", "Double Chocolate"]);
export const SANDWICH_BREAD_CHOICES = Object.freeze(["White", "Brown"]);
export function requiresSandwichBreadChoice(item) {
  // Only sliced-bread sandwiches and deals containing a sandwich.
  // Fresh baguettes have a distinct bread product and must not offer this choice.
  return Boolean(item && (item.categoryId === "sandwiches" || Array.isArray(item.deal?.sandwich)));
}
export const MILK_CHOICES = Object.freeze(["No milk", "Whole milk", "Semi-skimmed milk", "Oat milk"]);
export const SYRUP_MODIFIER_CHOICES = Object.freeze(["No syrup", ...syrupChoices]);
const noMilkByDefault = new Set(["Americano", "Espresso", "2X Espresso"]);

export function isDrinkCustomisable(item) {
  return Boolean(item && (["coffee", "autumn-drinks"].includes(item.categoryId) || Array.isArray(item.deal?.coffee)));
}
export function defaultDrinkMilk(item, selectedOptions = {}) {
  const drink = item.deal?.coffee ? (selectedOptions.coffee || item.deal.coffee[0]) : item.name;
  return noMilkByDefault.has(drink) ? "No milk" : "Whole milk";
}
export function drinkSyrupSurchargePence(selectedOptions = {}) {
  return selectedOptions.syrup && selectedOptions.syrup !== "No syrup" ? priceToPence(SYRUP_PRICE) : 0;
}

function withCategory(id, category, items, meta = {}) {
  return {
    id,
    category,
    ...meta,
    items: items.map((item) => ({
      category,
      categoryId: id,
      ...item,
    })),
  };
}

export const menuData = [
  withCategory(
    "signature-picks",
    "Signature Picks",
    [
      {
        id: "signature-bolognese-bowl",
        sourceId: "pasta-bolognese-bowl",
        priceKey: "pasta-bolognese-bowl",
        displayName: "Bolognese Pasta",
        name: "Bolognese Bowl",
        price: MENU_PRICES.bologneseBowl,
        description: "Rich, hearty & full of flavour.",
        image: "assets/menu-bolognese-bowl.jpg",
        badge: "Pasta Favourite",
      },
      {
        id: "signature-chicken-tomato-pasta",
        sourceId: "pasta-chicken-tomato",
        priceKey: "pasta-chicken-tomato",
        name: "Chicken Tomato Pasta",
        price: MENU_PRICES.chickenTomatoPasta,
        description: "Tender chicken and penne in homemade tomato sauce.",
        image: "assets/cafe-elite-chicken-tomato-pasta.webp",
        badge: "Pasta Favourite",
      },
      {
        id: "signature-beef-pastrami-baguette",
        sourceId: "baguette-beef-pastrami-cheese",
        priceKey: "baguette-beef-pastrami-cheese",
        name: "Beef Pastrami & Cheese",
        basketName: "Beef Pastrami & Cheese Baguette",
        price: MENU_PRICES.freshBaguette,
      description: "Beef pastrami, mozzarella, lettuce and tomato in a fresh baguette.",
        image: "assets/baguettes/beef-pastrami-cheese.jpg",
        badge: "Fresh Baguette",
      },
      {
        id: "signature-orange-cake",
        sourceId: "cake-orange-cake",
        priceKey: "cake-orange-cake",
        name: "Orange Cake",
        price: MENU_PRICES.cake,
        description: "One of our customers' favourites.",
        image: "assets/cakes/orange-cake.jpg",
        badge: "Customer Favourite",
      },
    ],
    { featured: true },
  ),
  withCategory("pasta", "Pasta", [
    {
      id: "pasta-bolognese-bowl",
      displayName: "Bolognese Pasta",
      name: "Bolognese Bowl",
      price: MENU_PRICES.bologneseBowl,
      description: "Rich, hearty & full of flavour.",
      secondaryDescription: "Freshly made comfort food for lunch or collection.",
      image: "assets/menu-bolognese-bowl.jpg",
      badge: "NEW",
      ingredients: ["De Cecco Spaghetti", "Minced beef", "Onion", "Carrot", "Garlic", "Olive oil", "Tomato puree", "Chopped tomatoes", "Passata", "Beef stock", "Oregano", "Salt", "Black pepper"],
    },
    {
      id: "deal-bolognese-any-two",
      name: "Any Two Bolognese Bowls",
      price: MENU_PRICES.bologneseTwo,
      description: "Two Bolognese bowls.",
      badge: "DEAL",
      fixedDetails: "2 Bolognese Bowls",
      deal: {},
    },
    {
      id: "deal-bolognese-any-three",
      name: "Any Three Bolognese Bowls",
      price: MENU_PRICES.bologneseThree,
      description: "Three Bolognese bowls.",
      badge: "DEAL",
      fixedDetails: "3 Bolognese Bowls",
      deal: {},
    },
    {
      id: "deal-bolognese-family-feast",
      name: "Bolognese Family Feast",
      price: MENU_PRICES.bologneseFamily,
      description: "Four Bolognese bowls for sharing.",
      badge: "BEST VALUE",
      fixedDetails: "4 Bolognese Bowls",
      deal: {},
    },
    {
      id: "pasta-tomato-pasta",
      name: "Tomato Pasta",
      price: MENU_PRICES.tomatoPasta,
      image: "assets/tomato-pasta.jpg",
      ingredients: ["De Cecco Spaghetti", "Homemade CAFE ELITE tomato sauce"],
    },
    {
      id: "pasta-garlic-yogurt-pasta",
      name: "Garlic Yogurt Pasta",
      price: MENU_PRICES.garlicYogurtPasta,
      image: "assets/garlic-yogurt-pasta.jpg",
      ingredients: ["De Cecco Penne", "Homemade yogurt", "Garlic", "Salt"],
    },
    {
      id: "pasta-chicken-tomato",
      name: "Chicken Tomato Pasta",
      price: MENU_PRICES.chickenTomatoPasta,
      image: "assets/cafe-elite-chicken-tomato-pasta.webp",
      description: "Tender chicken pieces and penne pasta tossed in our homemade tomato sauce.",
      ingredients: ["De Cecco Penne", "Homemade CAFE ELITE tomato sauce", "Cooked chicken breast strips"],
    },
    {
      id: "deal-any-two-bowls",
      name: "Any Two Bowls",
      price: MENU_PRICES.twoBowls,
      description: "Choose your 2 bowls.",
      badge: "Most Popular",
      deal: {
        bowl1: bowlChoices,
        bowl2: bowlChoices,
      },
    },
    {
      id: "deal-any-three-bowls",
      name: "Any 3 Bowls",
      price: MENU_PRICES.threeBowls,
      description: "Choose your 3 bowls.",
      deal: {
        bowl1: bowlChoices,
        bowl2: bowlChoices,
        bowl3: bowlChoices,
      },
    },
    {
      id: "deal-family-feast-four-bowls",
      name: "Family Feast - Any 4 Bowls",
      price: MENU_PRICES.familyBowls,
      description: "Choose your 4 bowls.",
      badge: "Best Value",
      deal: {
        bowl1: bowlChoices,
        bowl2: bowlChoices,
        bowl3: bowlChoices,
        bowl4: bowlChoices,
      },
    },
  ]),
  withCategory(
    "fresh-baguettes",
    "Fresh Baguettes",
    [
      {
        id: "baguette-beef-pastrami-cheese",
        name: "Beef Pastrami & Cheese",
        basketName: "Beef Pastrami & Cheese Baguette",
        image: "assets/baguettes/beef-pastrami-cheese.jpg",
        price: MENU_PRICES.freshBaguette,
      description: "Generous beef pastrami with mozzarella, lettuce and tomato in a freshly prepared baguette.",
      ingredients: ["Butter", "Pastrami", "Mozzarella", "Tomato", "Lettuce"],
        badge: "NEW",
      },
      {
        id: "baguette-classic-ham-cheese",
        name: "Classic Ham & Cheese",
        basketName: "Classic Ham & Cheese Baguette",
        image: "assets/baguettes/classic-ham-cheese.jpg",
        price: MENU_PRICES.freshBaguette,
        description: "Made with sliced chicken breast instead of traditional pork ham, cheddar cheese, lettuce, tomato and mayonnaise.",
        ingredients: ["Mayonnaise", "Lettuce", "Sliced Chicken Breast", "Cheddar Cheese", "Tomato"],
        badge: "NEW",
      },
      {
        id: "baguette-tuna-mayo",
        name: "Tuna Mayo",
        basketName: "Tuna Mayo Baguette",
        image: "assets/baguettes/tuna-mayo.jpg",
        price: MENU_PRICES.freshBaguette,
        description: "Creamy tuna mayo with crisp lettuce and gherkin.",
        ingredients: ["Lettuce", "Tuna Mayo", "Gherkin"],
        badge: "NEW",
      },
      {
        id: "baguette-vegetarian-egg",
        displayName: "Egg Mayo & Cucumber",
        displayBasketName: "Egg Mayo & Cucumber Baguette",
        name: "Vegetarian Egg",
        basketName: "Vegetarian Egg Baguette",
        image: "assets/baguettes/egg-mayo-cucumber.jpg",
        price: MENU_PRICES.freshBaguette,
        description: "Boiled egg, cucumber and lettuce with mayonnaise.",
        ingredients: ["Mayo", "Lettuce", "Boiled Egg", "Cucumber"],
        badge: "NEW",
      },
    ],
    { description: "Made fresh to order." },
  ),
  withCategory("meal-deals", "Meal Deals", [
    {
      id: "deal-baguette-any-coffee",
      name: "Baguette + Any Coffee",
      price: MENU_PRICES.baguetteDeal,
      description: "Choose one freshly prepared baguette and any coffee.",
      image: "assets/menu-baguette-deal.jpg",
      badge: "NEW",
      deal: {
        baguette: baguetteChoices,
        coffee: coffeeChoices,
      },
    },
    {
      id: "deal-coffee-sandwich-snack",
      name: "Coffee + Sandwich + Snack",
      price: MENU_PRICES.sandwichDeal,
      description: "Choose one coffee, one sandwich and one snack.",
      image: "assets/menu-sandwich-deal.jpg",
      badge: "Customer Favourite",
      deal: {
        coffee: coffeeChoices,
        sandwich: sandwichChoices,
        snack: snackChoices,
      },
    },
  ]),
  withCategory("sandwiches", "Sandwiches", [
    {
      id: "sandwich-tuna-gherkin",
      name: "Tuna & Gherkin",
      basketName: "Tuna & Gherkin Sandwich",
      image: "assets/sandwiches/tuna-gherkin.jpg",
      price: MENU_PRICES.sandwich,
      description: "Lettuce, tuna mayo and gherkin.",
      ingredients: ["Lettuce", "Tuna Mayo", "Gherkin"],
    },
    {
      id: "sandwich-vegetarian-egg",
      displayName: "Egg Mayo & Cucumber",
      displayBasketName: "Egg Mayo & Cucumber Sandwich",
      name: "Vegetarian Egg",
      basketName: "Vegetarian Egg Sandwich",
      price: MENU_PRICES.sandwich,
      description: "Mayo, lettuce, boiled egg and cucumber.",
      ingredients: ["Mayo", "Lettuce", "Boiled Egg", "Cucumber"],
      image: "assets/sandwiches/egg-mayo-cucumber.jpg",
    },
    {
      id: "sandwich-classic-ham-cheese",
      name: "Classic Ham & Cheese",
      basketName: "Classic Ham & Cheese Sandwich",
      price: MENU_PRICES.sandwich,
      description: "Made with sliced chicken breast instead of traditional pork ham, cheddar cheese, lettuce, tomato and mayonnaise.",
      ingredients: ["Mayonnaise", "Lettuce", "Sliced Chicken Breast", "Cheddar Cheese", "Tomato"],
      image: "assets/sandwiches/classic-ham-cheese.jpg",
    },
    {
      id: "sandwich-beef-pastrami-cheese",
      name: "Beef Pastrami & Cheese",
      basketName: "Beef Pastrami & Cheese Sandwich",
      price: MENU_PRICES.sandwich,
      description: "Mayo, lettuce, beef pastrami, cheddar cheese and tomato.",
      ingredients: ["Mayo", "Lettuce", "Beef Pastrami", "Cheddar Cheese", "Tomato"],
      image: "assets/sandwiches/beef-pastrami-cheese.jpg",
    },
  ]),
  withCategory("coffee", "Coffee", [
    { id: "coffee-latte", name: "Latte", price: MENU_PRICES.latte },
    { id: "coffee-americano", name: "Americano", price: MENU_PRICES.americano },
    { id: "coffee-cappuccino", name: "Cappuccino", price: MENU_PRICES.cappuccino },
    { id: "coffee-flat-white", name: "Flat White", price: MENU_PRICES.flatWhite },
    { id: "coffee-espresso", name: "Espresso", price: MENU_PRICES.espresso },
    { id: "coffee-double-espresso", name: "2X Espresso", price: MENU_PRICES.doubleEspresso },
    { id: "coffee-mocha", name: "Mocha", price: MENU_PRICES.mocha },
    { id: "coffee-hot-chocolate", name: "Hot Chocolate", price: MENU_PRICES.hotChocolate },
    { id: "coffee-ice-latte", name: "Ice Latte", price: MENU_PRICES.iceLatte },
  ]),
  withCategory(
    "autumn-drinks",
    "Autumn Drinks",
    [
      {
        id: "autumn-pumpkin-spice-latte",
        name: "Pumpkin Spice Latte",
        price: MENU_PRICES.autumnDrink,
        badge: "SEASONAL",
        description: "Warm, gently spiced and made for cosy days.",
      },
      {
        id: "autumn-salted-caramel-latte",
        name: "Salted Caramel Latte",
        price: MENU_PRICES.autumnDrink,
        badge: "SEASONAL",
        description: "Smooth latte with a salted caramel finish.",
      },
      {
        id: "autumn-toffee-nut-latte",
        name: "Toffee Nut Latte",
        price: MENU_PRICES.autumnDrink,
        badge: "SEASONAL",
        description: "A rich seasonal latte with soft toffee-nut flavour.",
      },
      {
        id: "autumn-hazelnut-cinnamon-latte",
        name: "Hazelnut Cinnamon Latte",
        price: MENU_PRICES.autumnDrink,
        badge: "SEASONAL",
        description: "Hazelnut warmth with a cinnamon finish.",
      },
    ],
    { description: "Warm flavours for cosy days." },
  ),
  withCategory("teas", "Teas", [
    { id: "tea-earl-grey", name: "Earl Grey", price: MENU_PRICES.tea },
    { id: "tea-breakfast-tea", name: "Breakfast Tea", price: MENU_PRICES.tea },
    { id: "tea-super-fruit", name: "Super Fruit", price: MENU_PRICES.tea },
    { id: "tea-passion-fruit", name: "Passion Fruit", price: MENU_PRICES.tea },
    { id: "tea-spanish-orange", name: "Spanish Orange", price: MENU_PRICES.tea },
    { id: "tea-pomegranate", name: "Pomegranate", price: MENU_PRICES.tea },
    { id: "tea-blueberry", name: "Blueberry", price: MENU_PRICES.tea },
    { id: "tea-fresh-orange", name: "Fresh Orange", price: MENU_PRICES.tea },
    { id: "tea-italian-lemon", name: "Italian Lemon", price: MENU_PRICES.tea },
  ]),
  withCategory("soft-drinks", "Soft Drinks", [
    { id: "soft-coca-cola", name: "Coca Cola", price: MENU_PRICES.softDrink },
    { id: "soft-rio", name: "Rio", price: MENU_PRICES.softDrink },
    { id: "soft-pepsi-max", name: "Pepsi Max", price: MENU_PRICES.softDrink },
    { id: "soft-orange-juice", name: "Orange Juice", price: MENU_PRICES.juice },
    { id: "soft-apple-juice", name: "Apple Juice", price: MENU_PRICES.juice },
    { id: "soft-mango-juice", name: "Mango Juice", price: MENU_PRICES.juice },
    { id: "soft-water", name: "Water", price: MENU_PRICES.softDrink },
  ]),
  withCategory("cakes", "Cakes", [
    { id: "cake-carrot-cake", name: "Carrot Cake", price: MENU_PRICES.cake, image: "assets/cakes/carrot-cake.jpg" },
    { id: "cake-orange-cake", name: "Orange Cake", price: MENU_PRICES.cake, image: "assets/cakes/orange-cake.jpg" },
    { id: "cake-victoria-sponge", name: "Victoria Sponge Cake", price: MENU_PRICES.cake, image: "assets/cakes/victoria-sponge-cake.jpg" },
    { id: "cake-fudge-cake", name: "Fudge Cake", price: MENU_PRICES.cake, image: "assets/cakes/fudge-cake.jpg" },
    { id: "cake-lemon-cake", name: "Lemon Meringue Pie", price: MENU_PRICES.cake, image: "assets/cakes/lemon-cake.jpg" },
    { id: "cake-vanilla-cheesecake", name: "Cheesecake", price: MENU_PRICES.cake, image: "assets/cakes/cafe-elite-cheesecake.webp", description: "Baked vanilla flavoured cheesecake with a biscuit base." },
  ]),
  withCategory("snacks", "Snacks", [
    { id: "snack-muffins", name: "Muffins", price: MENU_PRICES.muffin },
    { id: "snack-cookies", name: "Cookies", price: MENU_PRICES.snack },
    { id: "snack-chocolate-cupcake", name: "Chocolate Cupcake", price: MENU_PRICES.snack, image: "assets/chocolate-cupcake.jpg" },
    { id: "snack-vanilla-cupcake", name: "Vanilla Cupcake", price: MENU_PRICES.snack, image: "assets/vanilla-cupcake.jpg" },
    { id: "snack-lemon-cupcake", name: "Lemon Cupcake", price: MENU_PRICES.snack },
    { id: "snack-pink-cupcake", name: "Pink Cupcake", displayName: "Strawberry Cupcake", price: MENU_PRICES.snack, image: "assets/pink-cupcake.jpg" },
    { id: "snack-mini-cheddars", name: "Mini Cheddars", price: MENU_PRICES.snack, image: "assets/mini-cheddars.jpg" },
    { id: "snack-ready-salted-chips", name: "Ready Salted Chips", price: MENU_PRICES.snack, image: "assets/ready-salted-chips.jpg" },
  ]),
  withCategory("extras", "Extras", [
    {
      id: "extra-add-syrup",
      name: "Any Syrup",
      price: SYRUP_PRICE,
      description: "Choose your favourite flavour for coffee or hot chocolate.",
      deal: {
        flavour: syrupChoices,
      },
    },
    { id: "extra-homemade-yogurt-pot", name: "Homemade Yogurt Pot", price: MENU_PRICES.yogurt },
  ]),
];

export function slugify(value) {
  return String(value || "menu")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function getGroupId(group) {
  return group?.id || slugify(group?.category);
}

export function getItemKey(item) {
  return item?.priceKey || item?.id || item?.name || "";
}

export function getItemOrderName(item) {
  return item?.displayBasketName || item?.basketName || getItemDisplayName(item);
}

export function priceToPence(price) {
  return Math.round(Number(String(price || "").replace(/[\u00a3\u00c2,\s]/g, "")) * 100);
}
export function getItemDisplayName(item) {
  return item?.displayName || item?.name || "";
}

export function getChoiceDisplayName(value) {
  return value === "Vegetarian Egg" ? "Egg Mayo & Cucumber" : value === "Pink Cupcake" ? "Strawberry Cupcake" : value;
}

export function getDisplayDetails(details = "") {
  return String(details).split(" + ").map(getChoiceDisplayName).join(" + ");
}
