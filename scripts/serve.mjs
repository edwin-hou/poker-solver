import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import "./build-site.mjs";

const root = resolve(import.meta.dirname, "../dist");
const port = Number(process.env.PORT ?? 8000);
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, `http://${request.headers.host}`).pathname);
    let relative = normalize(pathname).replace(/^[/\\]+/, "");
    if (!relative || pathname.endsWith("/")) relative = join(relative, "index.html");
    let file = resolve(root, relative);
    if (!file.startsWith(root)) throw new Error("Invalid path");
    const info = await stat(file);
    if (info.isDirectory()) file = join(file, "index.html");
    const content = await readFile(file);
    response.writeHead(200, { "content-type": mime[extname(file)] ?? "application/octet-stream" });
    response.end(content);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}).listen(port, () => console.log(`Hold'em solver: http://localhost:${port}`));
