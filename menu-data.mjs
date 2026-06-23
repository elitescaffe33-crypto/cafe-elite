export const menuData = [
  {
    category: "Pasta Menu",
    items: [
      { name: "Tomato Pasta", price: "£6.99", image: "assets/tomato-pasta.jpg" },
      { name: "Garlic Yogurt Pasta", price: "£6.99", image: "assets/garlic-yogurt-pasta.jpg" },
      { name: "Any 3 Bowls", price: "£18.99", description: "Please write your 3 bowl choices in order notes." },
      { name: "Any Two Bowls (Most Popular)", price: "£11.99", description: "Please write your 2 bowl choices in order notes." },
      { name: "Family Feast - Any 4 Bowls (Best Value)", price: "£21.99", description: "Please write your 4 bowl choices in order notes." },
    ],
  },
  {
    category: "Meal Deal",
    items: [
      {
        name: "Any Pasta Bowl + Coffee + Any Snack",
        price: "£10.50",
        description: "Choose one pasta bowl, one coffee and one snack.",
        deal: {
          pasta: ["Tomato Pasta", "Garlic Yogurt Pasta"],
          coffee: ["Latte", "Americano", "Cappuccino", "Flat White", "Espresso", "2X Espresso", "Mocha", "Hot Chocolate", "Ice Latte"],
          snack: [
            "Muffins",
            "Cookies",
            "Carrot Loaf Slice",
            "Lemon Loaf Slice",
            "Chocolate Loaf Slice",
            "Chocolate Cupcake",
            "Vanilla Cupcake",
            "Pink Cupcake",
            "Mini Cheddars",
            "Ready Salted Chips",
            "Cornetto Hazelnut & Chocolate",
            "Solero Exotic",
          ],
        },
      },
    ],
  },
  {
    category: "Sandwich Menu",
    items: [
      { name: "Vegetarian Egg", price: "£2.99", image: "assets/vegetarian-egg.jpg" },
      { name: "Tuna & Gherkin", price: "£2.99" },
      { name: "Classic Ham & Cheese", price: "£2.99", image: "assets/classic-ham-cheese.jpg" },
    ],
  },
  {
    category: "Coffee Menu",
    items: [
      { name: "Latte", price: "£3.60" },
      { name: "Americano", price: "£3.30" },
      { name: "Cappuccino", price: "£3.60" },
      { name: "Flat White", price: "£3.60" },
      { name: "Espresso", price: "£2.40" },
      { name: "2X Espresso", price: "£2.65" },
      { name: "Mocha", price: "£3.90" },
      { name: "Hot Chocolate", price: "£3.95" },
      { name: "Ice Latte", price: "£4.20" },
    ],
  },
  {
    category: "Teas",
    items: [
      { name: "Earl Grey", price: "£2.40" },
      { name: "Breakfast Tea", price: "£2.40" },
      { name: "Super Fruit", price: "£2.40" },
      { name: "Passion Fruit", price: "£2.40" },
      { name: "Ginger Lemon", price: "£2.40" },
      { name: "Spanish Orange", price: "£2.40" },
      { name: "Forest Fruits", price: "£2.40" },
    ],
  },
  {
    category: "Soft Drinks",
    items: [
      { name: "Coca Cola", price: "£1.50" },
      { name: "Rio", price: "£1.50" },
      { name: "Pepsi Max", price: "£1.50" },
      { name: "Orange Juice", price: "£1.75" },
      { name: "Apple Juice", price: "£1.75" },
      { name: "Mango Juice", price: "£1.75" },
      { name: "Water", price: "£1.50" },
    ],
  },
  {
    category: "Cakes",
    items: [
      { name: "Carrot Cake", price: "£2.99", image: "assets/carrot-cake.jpg" },
      { name: "Orange Cake", price: "£2.99", image: "assets/orange-cake.jpg" },
      { name: "Victoria Sponge Cake", price: "£2.99", image: "assets/victoria-sponge-cake.jpg" },
      { name: "Fudge Cake", price: "£2.99", image: "assets/fudge-cake.jpg" },
      { name: "Lemon Cake", price: "£2.99", image: "assets/lemon-cake.jpg" },
      { name: "Apple Pie", price: "£2.99" },
      { name: "Tiramisu", price: "£2.99", image: "assets/tiramisu.jpg" },
    ],
  },
  {
    category: "Snacks",
    items: [
      { name: "Muffins", price: "£2.50" },
      { name: "Cookies", price: "£1.99" },
      { name: "Carrot Loaf Slice", price: "£1.99" },
      { name: "Lemon Loaf Slice", price: "£1.99" },
      { name: "Chocolate Loaf Slice", price: "£1.99" },
      { name: "Chocolate Cupcake", price: "£1.99", image: "assets/chocolate-cupcake.jpg" },
      { name: "Vanilla Cupcake", price: "£1.99", image: "assets/vanilla-cupcake.jpg" },
      { name: "Pink Cupcake", price: "£1.99", image: "assets/pink-cupcake.jpg" },
      { name: "Mini Cheddars", price: "£1.99" },
      { name: "Ready Salted Chips", price: "£1.99" },
      { name: "Cornetto Hazelnut & Chocolate", price: "£1.99", image: "assets/cornetto-hazelnut-chocolate.jpg" },
      { name: "Solero Exotic", price: "£1.99", image: "assets/solero-exotic.jpg" },
    ],
  },
  {
    category: "Extras",
    items: [
      { name: "Homemade Yogurt Pot", price: "£0.59" },
      { name: "Any Syrup", price: "£0.50" },
    ],
  },
];

export function priceToPence(price) {
  return Math.round(Number(price.replace(/[£,\s]/g, "")) * 100);
}
