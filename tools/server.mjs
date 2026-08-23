// Tiny static file server for development. No dependencies.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const port = Number(process.env.PORT || 5173);

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
};

const server = createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (path.endsWith("/")) path += "index.html";
    const full = normalize(join(root, path));
    if (!full.startsWith(root)) {
      res.writeHead(403).end("Forbidden");
      return;
    }
    let target = full;
    try {
      await stat(target);
    } catch {
      // SPA fallback only for navigations; never serve HTML for missing JS
      if (path.endsWith(".mjs") || path.endsWith(".css") || path.endsWith(".json")) {
        res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
        return;
      }
      target = join(root, "index.html");
    }
    const body = await readFile(target);
    res.writeHead(200, {
      "content-type": types[extname(target)] || "application/octet-stream",
      "cache-control": "no-cache",
    });
    res.end(body);
  } catch (err) {
    res.writeHead(500).end(String(err));
  }
});

server.listen(port, () => {
  console.log(`Panfare dev server: http://localhost:${port}`);
});
