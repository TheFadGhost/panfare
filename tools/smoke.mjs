// smoke.mjs â€” drives the real app in headless Chrome: loads, seeds,
// walks every route, exercises scaling + list + planner + cook mode.
// Captures screenshots for the README. Exit 1 on any failure.

import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, stat, mkdir } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const port = 0;
const types = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json",
};

const server = createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (path.endsWith("/")) path += "index.html";
    const full = normalize(join(root, path));
    if (!full.startsWith(root)) { res.writeHead(403).end(); return; }
    const body = await readFile(full).catch(() => readFile(join(root, "index.html")));
    res.writeHead(200, { "content-type": types[extname(full)] || "text/plain" });
    res.end(body);
  } catch (e) { res.writeHead(500).end(String(e)); }
});
await new Promise((r) => server.listen(port, r));
const realPort = server.address().port;

const shots = join(root, "docs", "shots");
await mkdir(shots, { recursive: true });

const failures = [];
function check(name, cond) {
  if (!cond) failures.push("FAILED: " + name);
  console.log((cond ? "ok   " : "FAIL ") + name);
}

const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
});

const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on("pageerror", (err) => failures.push("PAGE ERROR: " + err.message));
page.on("console", (msg) => {
  if (msg.type() === "error") console.log("console.error:", msg.text());
});

await page.goto(`http://localhost:${realPort}/#/library`, { waitUntil: "networkidle" });
await page.waitForTimeout(400);

// first-run empty state with seed button
const hasSeed = await page.locator("text=Load 10 sample recipes").count();
check("empty state shows sample seeding", hasSeed > 0);
if (hasSeed) {
  await page.click("text=Load 10 sample recipes");
  await page.waitForTimeout(300);
}
const cardCount = await page.locator(".recipe-card, li a[href^='#/recipe/']").count();
check("library lists recipes after seeding (" + cardCount + ")", cardCount >= 10);

// search
await page.fill("[data-shortcut-search]", "curry");
await page.waitForTimeout(350);
check("search filters library", await page.locator("text=Coconut Chickpea Curry").first().isVisible());

await page.fill("[data-shortcut-search]", "");
await page.waitForTimeout(350);

// open a recipe and scale it
await page.click("text=Weeknight Coconut Chickpea Curry");
await page.waitForTimeout(300);
check("recipe view renders title", await page.locator("h1").first().textContent().then((t) => /Curry/i.test(t || "")));
check("ingredient rows render", (await page.locator(".ingredient-row").count()) > 4);

// scale x2 via segmented control
await page.click(".segmented button:text-is('2')");
await page.waitForTimeout(250);
const yieldOut = await page.locator("output").first().textContent().catch(() => "");
console.log("resolved yield after x2:", (yieldOut || "").trim());
check("yield updates to serves 8 at x2", /serves 8/.test(yieldOut || ""));
check("warn panel appears for salt/chili at x2", (await page.locator(".warn-panel").count()) > 0);
await page.screenshot({ path: join(shots, "recipe-scaled.png"), fullPage: false });

// cook mode
await page.click("a[href*='#/cook/'], button:has-text('Cook')");
await page.waitForTimeout(400);
check("cook mode shows step counter", await page.locator(".cook-progress").textContent().then((t) => /Step 1 of/.test(t || "")));
await page.screenshot({ path: join(shots, "cook-mode.png") });
const bodyClass = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
check("cook mode forces contrast theme", bodyClass === "contrast");
await page.keyboard.press("ArrowRight");
await page.waitForTimeout(200);
check("arrow key advances step", await page.locator(".cook-progress").textContent().then((t) => /Step 2 of/.test(t || "")));
await page.keyboard.press("Escape");
await page.waitForTimeout(300);

// planner: add one slot
await page.goto(`http://localhost:${realPort}/#/planner`);
await page.waitForTimeout(300);
await page.locator("button:text-is('+ Add meal')").first().click();
await page.waitForTimeout(150);
await page.locator(".slot.draft select").selectOption({ label: "Charred Carrot and Puy Lentil Salad" });
await page.locator(".slot.draft button:text-is('Add')").click();
await page.waitForTimeout(250);
check("planner slot assigned", await page.locator(".slot-title").first().textContent().then((t) => /Carrot/.test(t || "")));

// shopping list from plan
await page.goto(`http://localhost:${realPort}/#/list?src=plan`);
await page.waitForTimeout(500);
const sections = await page.locator(".section-heading").count();
check("list builds sections from plan (" + sections + ")", sections > 0);
const tickTarget = page.locator(".list-item input[type=checkbox]").first();
if ((await tickTarget.count()) > 0) {
  await tickTarget.check();
  await page.waitForTimeout(150);
  check("check-off updates summary", await page.locator("[aria-live=polite]").last().textContent().then((t) => /1 of /.test(t || "")));
}
await page.screenshot({ path: join(shots, "shopping-list.png"), fullPage: true });

// settings themes
await page.goto(`http://localhost:${realPort}/#/settings`);
await page.waitForTimeout(300);
await page.check("input[name=pf-theme][value=dark]");
await page.waitForTimeout(200);
check("dark theme applies", (await page.evaluate(() => document.documentElement.getAttribute("data-theme"))) === "dark");
await page.screenshot({ path: join(shots, "settings-dark.png") });
await page.check("input[name=pf-theme][value=light]");

await browser.close();
server.close();

if (failures.length) {
  console.error("\nSMOKE FAILURES:");
  for (const f of failures) console.error(" - " + f);
  process.exit(1);
}
console.log("\nSmoke pass complete.");

