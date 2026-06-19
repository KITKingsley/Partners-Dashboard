import { copyFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");

const assets = [
  "index.html",
  "login.html",
  "signup.html",
  "styles.css",
  "app.js",
  "date-format.js",
  "credits-usage.js",
  "partners.js",
  "global-search.js",
  "dashboard-nav.js",
  "dashboard-data.js",
  "auth-config.js",
  "supabase-auth.js",
  "fx-rates-usd.json",
  "Gametize App Logo.png",
];

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

for (const asset of assets) {
  await copyFile(path.join(root, asset), path.join(dist, asset));
}

console.log(`Prepared ${assets.length} static assets in ${path.relative(root, dist)}`);
