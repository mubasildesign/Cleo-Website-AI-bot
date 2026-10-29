import { cp, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "public", "widget");
const assets = ["loader.js", "widget.css", "widget.js"];

await mkdir(output, { recursive: true });
await Promise.all(
  assets.map((asset) => cp(path.join(root, "src", asset), path.join(output, asset)))
);

console.log(`Prepared ${assets.length} Cleo assets in public/widget`);
