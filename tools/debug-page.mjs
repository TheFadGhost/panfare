import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const port = 5199;
const types = { ".html": "text/html", ".css": "text/css", ".mjs": "text/javascript", ".json": "application/json" };
const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index.html";
    const full = normalize(join(root, p));
    if (!full.startsWith(root)) { res.writeHead(403).end(); return; }
    const body = await readFile(full).catch(() => readFile(join(root, "index.html")));
    res.writeHead(200, { "content-type": types[extname(full)] || "text/plain" });
    res.end(body);
  } catch (e) { res.writeHead(500).end(String(e)); }
});
await new Promise((r) => server.listen(port, r));

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage();
page.on("console", (m) => console.log("[" + m.type() + "]", m.text().slice(0, 300)));
page.on("pageerror", (e) => console.log("[pageerror]", e.message));

await page.goto(`http://localhost:${port}/#/library`, { waitUntil: "networkidle" });
await page.click("text=Load 10 sample recipes").catch(() => {});
await page.waitForTimeout(300);
await page.goto(`http://localhost:${port}/#/planner`);
await page.waitForTimeout(400);
await page.locator("button:text-is('+ Add meal')").first().click();
await page.waitForTimeout(200);
const draftExists = await page.locator(".slot.draft").count();
console.log("draft row exists:", draftExists);
const optCount = await page.locator(".slot.draft select option").count();
console.log("options:", optCount);
await page.locator(".slot.draft select").selectOption({ index: 1 }).catch((e) => console.log("selOpt fail:", e.message));
const chosen = await page.locator(".slot.draft select").inputValue().catch(() => "?");
console.log("chosen:", chosen);
await page.locator(".slot.draft button:text-is('Add')").click();
await page.waitForTimeout(500);
console.log("GRID AFTER:", await page.evaluate(() => document.querySelector(".plan-grid")?.innerHTML?.slice(0, 500)));
console.log("LS PLAN:", await page.evaluate(() => localStorage.getItem("panfare.v1")?.slice(0, 300)));
await browser.close();
server.close();
