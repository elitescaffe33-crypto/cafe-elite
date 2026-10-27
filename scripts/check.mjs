import { readdir, readFile, access } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import assert from "node:assert/strict";
import { menuData } from "../menu-data.mjs";
import { defaultSiteSettings } from "../site-settings.mjs";
import { renderPublicPage } from "../public-content.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
let checked = 0;
for (const directory of ["", "scripts", "tests"]) {
  // Production's exact runtime-only package deliberately excludes tests; still
  // syntax-check all tests whenever they exist in the development checkout.
  let entries;
  try { entries = await readdir(join(root, directory), { withFileTypes: true }); }
  catch (error) {
    if (directory === "tests" && error?.code === "ENOENT") continue;
    throw error;
  }
  for (const entry of entries) {
    if (entry.isFile() && /\.(mjs|js)$/.test(entry.name)) {
      execFileSync(process.execPath, ["--check", join(root, directory, entry.name)], { stdio: "pipe" });
      checked++;
    }
  }
}
console.log(`Syntax check passed: ${checked} JavaScript files. No third-party linter is configured.`);
if (process.argv.includes("--build")) {
  // This application runs directly in Node; there is no bundle or transpilation step.
  const source = await readFile(join(root, "index.html"), "utf8");
  const html = renderPublicPage(source, menuData, defaultSiteSettings);
  assert.ok(!html.includes("<!-- SERVER_MENU -->"));
  JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
  const paths = new Set([...html.matchAll(/(?:src|href)="([^"#?]+)(?:[?#][^"]*)?"/g)].map(match => match[1]).filter(path => !/^(https?:|data:|mailto:|tel:)/i.test(path)));
  menuData.flatMap(group => group.items).forEach(item => { if (item.image) paths.add(item.image); });
  for (const path of paths) await access(join(root, path));
  for (const item of menuData.flatMap(group => group.items)) assert.ok(item.id && item.price);
  console.log(`Production render validation passed: ${Buffer.byteLength(html)} bytes, ${paths.size} local resources. Runtime remains npm start.`);
}
