import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "dist");

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(resolve(root, "index.html"), resolve(output, "index.html"));
await cp(resolve(root, "site"), resolve(output, "site"), { recursive: true });
await cp(resolve(root, "src"), resolve(output, "src"), { recursive: true });
await writeFile(resolve(output, ".nojekyll"), "", "utf8");

console.log(`Built static site in ${output}`);
