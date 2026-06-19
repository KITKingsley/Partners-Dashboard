import { copyFile, mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");

const ROOT_ASSET_PATTERN = /\.(html?|css|js|json|png|jpe?g|svg|ico|webp|txt|csv)$/i;

async function collectRootAssets() {
  const entries = await readdir(root, { withFileTypes: true });
  const assets = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!ROOT_ASSET_PATTERN.test(entry.name)) continue;
    assets.push(entry.name);
  }

  assets.sort((left, right) => left.localeCompare(right));
  return assets;
}

const assets = await collectRootAssets();

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

for (const asset of assets) {
  await copyFile(path.join(root, asset), path.join(dist, asset));
}

const distStats = await Promise.all(
  assets.map(async (asset) => {
    const info = await stat(path.join(dist, asset));
    return `${asset} (${info.size} bytes)`;
  })
);

console.log(`Prepared ${assets.length} static assets in ${path.relative(root, dist)}`);
distStats.forEach((line) => console.log(`  - ${line}`));
