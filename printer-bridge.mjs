import { readFile, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";

const siteUrl = (process.env.CAFE_ELITE_SITE || "https://cafe-elite.onrender.com").replace(/\/$/, "");
const adminPassword = process.env.CAFE_ELITE_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || "";
const printerHost = process.env.PRINTER_HOST || "";
const printerPort = Number(process.env.PRINTER_PORT || 9100);
const pollSeconds = Number(process.env.PRINTER_POLL_SECONDS || 8);
const printedFile = process.env.PRINTED_ORDERS_FILE || "printed-orders.json";

if (!adminPassword) {
  console.error("Missing CAFE_ELITE_ADMIN_PASSWORD. Set it before running the printer bridge.");
  process.exit(1);
}

if (!printerHost) {
  console.error("Missing PRINTER_HOST. Set it to the receipt printer IP address, for example 192.168.1.44.");
  process.exit(1);
}

console.log(`CAFE ELITE printer bridge started`);
console.log(`Site: ${siteUrl}`);
console.log(`Printer: ${printerHost}:${printerPort}`);
console.log(`Polling every ${pollSeconds} seconds`);

let printedIds = await loadPrintedIds();
let isPolling = false;

await pollOrders();
setInterval(pollOrders, pollSeconds * 1000);

async function pollOrders() {
  if (isPolling) return;
  isPolling = true;

  try {
    const orders = await fetchOrders();
    const printableOrders = orders
      .filter((order) => order?.id && !printedIds.has(order.id))
      .filter((order) => ["new", "pending", "paid"].includes(order.status || "new"))
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

    for (const order of printableOrders) {
      await printOrder(order);
      printedIds.add(order.id);
      await savePrintedIds(printedIds);
      console.log(`Printed order ${order.id}`);
    }
  } catch (error) {
    console.error(`Printer bridge error: ${error.message}`);
  } finally {
    isPolling = false;
  }
}

async function fetchOrders() {
  const response = await fetch(`${siteUrl}/api/admin/orders`, {
    headers: {
      "X-Admin-Password": adminPassword,
    },
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error || `Order fetch failed with status ${response.status}`);
  }
  return Array.isArray(data) ? data : [];
}

function formatReceipt(order) {
  const createdAt = order.createdAt
    ? new Date(order.createdAt).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })
    : "";
  const payment = order.type === "paid-online" ? "PAID ONLINE" : "PAY ON COLLECTION";
  const total = order.amount || "Pay at collection";

  return [
    center("CAFE ELITE"),
    center("33 High Street"),
    center("Leominster HR6 8LZ"),
    line(),
    `Time: ${createdAt}`,
    `Payment: ${payment}`,
    `Name: ${order.customerName || "Not provided"}`,
    `Phone: ${order.phone || "Not provided"}`,
    `Collect: ${order.collectionTime || "Not provided"}`,
    `Total: ${total}`,
    line(),
    "ITEMS",
    order.items || order.message || "No items",
    line(),
    `Notes: ${order.notes || "None"}`,
    line(),
    center("Thank you"),
    "",
    "",
    "",
  ].join("\n");
}

async function printOrder(order) {
  const receipt = sanitizeForReceipt(formatReceipt(order));
  const payload = Buffer.concat([
    Buffer.from([0x1b, 0x40]), // Initialize
    Buffer.from([0x1b, 0x61, 0x00]), // Left
    Buffer.from(receipt, "ascii"),
    Buffer.from("\n\n", "ascii"),
    Buffer.from([0x1d, 0x56, 0x41, 0x10]), // Cut
  ]);

  await writeToPrinter(payload);
}

function writeToPrinter(payload) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: printerHost, port: printerPort, timeout: 6000 }, () => {
      socket.write(payload);
      socket.end();
    });

    socket.on("close", resolve);
    socket.on("timeout", () => {
      socket.destroy();
      reject(new Error("Printer connection timed out"));
    });
    socket.on("error", reject);
  });
}

async function loadPrintedIds() {
  try {
    const data = JSON.parse(await readFile(printedFile, "utf8"));
    return new Set(Array.isArray(data) ? data : []);
  } catch {
    return new Set();
  }
}

async function savePrintedIds(ids) {
  await writeFile(printedFile, `${JSON.stringify([...ids], null, 2)}\n`, "utf8");
}

function line() {
  return "--------------------------------";
}

function center(text) {
  const width = 32;
  const value = String(text);
  const left = Math.max(0, Math.floor((width - value.length) / 2));
  return `${" ".repeat(left)}${value}`;
}

function sanitizeForReceipt(text) {
  return String(text)
    .replace(/£/g, "GBP ")
    .replace(/[^\x20-\x7E\n]/g, "");
}
