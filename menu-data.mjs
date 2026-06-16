export const menuData = [
  {
    category: "Pasta Menu",
    items: [
      { name: "Tomato Pasta", price: "£6.99" },
      { name: "Garlic Yogurt Pasta", price: "£6.99" },
      { name: "Any Two Bowls (Most Popular)", price: "£11.99" },
      { name: "Family Feast (Best Value)", price: "£21.99" },
    ],
  },
  {
    category: "Sandwich Menu",
    items: [
      { name: "Vegetarian Egg", price: "£2.99" },
      { name: "Tuna & Gherkin", price: "£2.99" },
      { name: "Classic Ham & Cheese", price: "£2.99" },
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
      { name: "Carrot Cake", price: "£2.99" },
      { name: "Orange Cake", price: "£2.99" },
      { name: "Victoria Sponge Cake", price: "£2.99" },
      { name: "Fudge Cake", price: "£2.99" },
      { name: "Lemon Cake", price: "£2.99" },
      { name: "Apple Pie", price: "£2.99" },
      { name: "Tiramisu", price: "£2.99" },
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
      { name: "Cupcakes", price: "£1.99" },
      { name: "Mini Cheddars", price: "£1.99" },
      { name: "Ready Salted Chips", price: "£1.99" },
    ],
  },
  {
    category: "Meal Deal",
    items: [{ name: "Coffee + Sandwich + Snack", price: "£6.99" }],
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
