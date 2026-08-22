// importer.mjs — recipe import from schema.org Recipe markup.
//
// Two extraction routes over a raw HTML string:
//   1. JSON-LD blocks (<script type="application/ld+json">) — top-level
//      objects, arrays, @graph trees and WebPage.mainEntity are all walked.
//   2. Microdata attributes (itemscope/itemtype/itemprop), scanned with a
//      quote-aware tag scanner rather than a DOM tree.
//
// The extractor is deliberately string-based so it behaves identically in
// Node (no DOMParser) and the browser. Known limitations are listed at the
// bottom of this file. It is honest about failure: garbage input reports
// {ok:false, reason:"invalid-html"}; well-formed HTML without recipe data
// reports {ok:false, reason:"no-recipe-data", details}. It never throws.

// parser.mjs is developed concurrently; resolve it at load time when it is
// present (production + integration) and degrade gracefully while it is
// absent: every line then stays a best-effort raw line instead of the module
// failing to load. Tests may also inject a deterministic fake through
// setIngredientParser() — vi.mock cannot intercept an import whose file
// does not exist on disk yet.
let parseIngredientLine = null;
try {
  ({ parseIngredientLine } = await import("./parser.mjs"));
} catch {
  parseIngredientLine = null;
}

/**
 * Test/integration hook: replace (or clear with null) the ingredient parser
 * used for imported lines. Production code never needs this.
 */
export function setIngredientParser(fn) {
  parseIngredientLine = typeof fn === "function" ? fn : null;
}

// ---------------------------------------------------------------------------
// Small text utilities
// ---------------------------------------------------------------------------

const NAMED_ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00A0",
  hellip: "\u2026",
  mdash: "\u2014",
  ndash: "\u2013",
  rsquo: "\u2019",
  lsquo: "\u2018",
  ldquo: "\u201C",
  rdquo: "\u201D",
  middot: "\u00B7",
  deg: "\u00B0",
  times: "\u00D7",
  eacute: "\u00E9",
  frac12: "\u00BD",
  frac14: "\u00BC",
  frac34: "\u00BE",
};

// Single pass, so "&amp;lt;" decodes to "&lt;" (never double-decodes).
export function decodeHtmlEntities(s) {
  if (s == null) return "";
  const str = String(s);
  if (str.indexOf("&") === -1) return str;
  return str.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body) => {
    if (body.charAt(0) === "#") {
      const hex = body.charAt(1) === "x" || body.charAt(1) === "X";
      const code = parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (!Number.isFinite(code) || code < 1 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
        return whole;
      }
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole;
      }
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named === undefined ? whole : named;
  });
}

function collapseWhitespace(s) {
  return String(s == null ? "" : s).replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// IDs
// ---------------------------------------------------------------------------

function randomSlug(length = 8) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(length);
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.getRandomValues === "function") {
    cryptoObj.getRandomValues(bytes);
  } else {
    for (let i = 0; i < length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

function makeRecipeId() {
  return "r_" + randomSlug();
}

// ---------------------------------------------------------------------------
// ISO 8601 durations -> whole minutes (or null)
// ---------------------------------------------------------------------------

const ISO_DURATION_RE =
  /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i;

export function parseIsoDuration(str) {
  if (typeof str !== "string") return null;
  const m = ISO_DURATION_RE.exec(str.trim());
  if (!m) return null;
  const [, sign, weeks, days, hours, minutes, seconds] = m;
  if (!weeks && !days && !hours && !minutes && !seconds) return null;
  const totalSeconds =
    Number(weeks || 0) * 7 * 86400 +
    Number(days || 0) * 86400 +
    Number(hours || 0) * 3600 +
    Number(minutes || 0) * 60 +
    Math.round(Number(seconds || 0));
  const totalMinutes = Math.round(totalSeconds / 60);
  if (!Number.isFinite(totalMinutes)) return null;
  return sign === "-" ? -totalMinutes : totalMinutes;
}

// ---------------------------------------------------------------------------
// Value coercion helpers shared by both extraction routes
// ---------------------------------------------------------------------------

function firstText(value) {
  if (value == null) return null;
  if (typeof value === "string") {
    const t = collapseWhitespace(decodeHtmlEntities(value));
    return t === "" ? null : t;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    for (const el of value) {
      const t = firstText(el);
      if (t) return t;
    }
    return null;
  }
  if (typeof value === "object") {
    if (typeof value["@value"] === "string") return firstText(value["@value"]);
    if (value.name != null) return firstText(value.name);
    if (typeof value["@id"] === "string") return value["@id"];
  }
  return null;
}

// "Serves 6" / "6 servings" / "makes 12 buns" -> serves 6; no number -> null.
function parseYieldText(text) {
  if (text == null) return { serves: null, text: null };
  const t = collapseWhitespace(text);
  if (t === "") return { serves: null, text: null };
  const m = /\d+(?:\.\d+)?/.exec(t);
  let serves = null;
  if (m) {
    const n = Math.round(Number(m[0]));
    if (Number.isFinite(n) && n > 0 && n <= 10000) serves = n;
  }
  return { serves, text: t };
}

function splitLines(text) {
  return String(text == null ? "" : text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

function keywordsToTags(keywords) {
  if (keywords == null) return [];
  const raw = Array.isArray(keywords) ? keywords : [keywords];
  const tags = [];
  for (const chunk of raw) {
    if (chunk == null) continue;
    for (const part of String(chunk).split(",")) {
      const tag = collapseWhitespace(part);
      if (tag !== "" && !tags.includes(tag)) tags.push(tag);
    }
  }
  return tags;
}

function authorNames(authorValue) {
  // Accepts "Jo", {name}, {@type:"Person",name}, or arrays mixing those.
  const out = [];
  const visit = (v) => {
    if (v == null || out.length > 8) return;
    if (typeof v === "string") {
      const t = collapseWhitespace(v);
      if (t) out.push(t);
      return;
    }
    if (Array.isArray(v)) {
      for (const el of v) visit(el);
      return;
    }
    if (typeof v === "object") {
      if (v.name != null) visit(v.name);
      else if (typeof v["@value"] === "string") visit(v["@value"]);
    }
  };
  visit(authorValue);
  return out.length ? out.join(", ") : null;
}

// ---------------------------------------------------------------------------
// JSON-LD extraction
// ---------------------------------------------------------------------------

function collectJsonLdBlocks(html) {
  const blocks = [];
  const re =
    /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script\s*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) blocks.push(m[1]);
  return blocks;
}

function parseJsonLdBlock(body) {
  let text = String(body).trim();
  const cdata = /^<!\[CDATA\[([\s\S]*)\]\]>$/i.exec(text);
  if (cdata) text = cdata[1].trim();
  // Tolerate /* */ and // comments some sites emit inside the block.
  text = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n\r]*/g, "$1");
  if (text === "") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function nodeIsRecipe(node) {
  if (!node || typeof node !== "object") return false;
  const type = node["@type"];
  if (typeof type === "string") return type.toLowerCase() === "recipe";
  if (Array.isArray(type)) {
    return type.some((t) => typeof t === "string" && t.toLowerCase() === "recipe");
  }
  return false;
}

function forEachSchemaNode(data, visit, depth = 0, seen = null) {
  if (depth > 12) return;
  if (data == null) return;
  if (Array.isArray(data)) {
    for (const el of data) forEachSchemaNode(el, visit, depth + 1, seen);
    return;
  }
  if (typeof data !== "object") return;
  if (seen === null) seen = new Set();
  if (seen.has(data)) return;
  seen.add(data);
  visit(data);
  if (data["@graph"] != null) forEachSchemaNode(data["@graph"], visit, depth + 1, seen);
  if (data.mainEntity != null) forEachSchemaNode(data.mainEntity, visit, depth + 1, seen);
}

function ingredientStringsFromJsonLd(value, depth = 0) {
  if (depth > 6 || value == null) return [];
  const out = [];
  if (typeof value === "string") {
    out.push(...splitLines(value));
  } else if (Array.isArray(value)) {
    for (const el of value) out.push(...ingredientStringsFromJsonLd(el, depth + 1));
  } else if (typeof value === "object" && typeof value.text === "string") {
    out.push(...splitLines(value.text));
  }
  return out;
}

// Text steps split on newlines ONLY (never on sentences). HowToStep objects
// contribute their text field; HowToSection trees are flattened plainly in
// document order (the section name is dropped).
function stepsFromJsonLdInstructions(value, steps, depth = 0) {
  if (depth > 12 || value == null) return;
  if (typeof value === "string") {
    for (const line of splitLines(value)) steps.push({ text: line });
    return;
  }
  if (Array.isArray(value)) {
    for (const el of value) stepsFromJsonLdInstructions(el, steps, depth + 1);
    return;
  }
  if (typeof value !== "object") return;

  const type = value["@type"];
  const types = Array.isArray(type)
    ? type.map((t) => String(t).toLowerCase())
    : [String(type || "").toLowerCase()];
  const isSection = types.includes("howtosection");

  if (isSection && value.itemListElement != null) {
    stepsFromJsonLdInstructions(value.itemListElement, steps, depth + 1);
    return;
  }

  let text = null;
  if (typeof value.text === "string") text = value.text;
  else if (value.text != null) text = firstText(value.text);
  if (text != null && text !== "") {
    for (const line of splitLines(text)) steps.push({ text: line });
  }
}

function recipeNodesFromJsonLd(html) {
  const recipes = [];
  for (const block of collectJsonLdBlocks(html)) {
    const parsed = parseJsonLdBlock(block);
    if (parsed === undefined) continue;
    forEachSchemaNode(parsed, (node) => {
      if (nodeIsRecipe(node)) recipes.push(node);
    });
  }
  return recipes;
}

// ---------------------------------------------------------------------------
// Microdata extraction (quote-aware tag scanner, no DOM required)
// ---------------------------------------------------------------------------

// Quote-aware tag matcher: quoted attribute values may contain ">" safely,
// and the bare-text branch excludes quote characters so backtracking stays
// linear on pathological input.
const TAG_SCAN_RE = /<([a-zA-Z][a-zA-Z0-9]*)\b((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

function getAttr(attrText, name) {
  const re = new RegExp(
    "(?:^|\\s)" + name + "\\s*=\\s*(\"([^\"]*)\"|'([^']*)'|([^\\s\"'>]+))",
    "i",
  );
  const m = re.exec(attrText || "");
  if (!m) return null;
  return decodeHtmlEntities(m[2] != null ? m[2] : m[3] != null ? m[3] : m[4]);
}

function hasBareAttr(attrText, name) {
  return new RegExp("(?:^|\\s)" + name + "(?:\\s|=|>|$)", "i").test(attrText || "");
}

function itemTypeToken(attrText) {
  const v = getAttr(attrText, "itemtype");
  if (!v) return null;
  const m = /schema\.org\/([a-zA-Z0-9]+)/i.exec(v);
  return m ? m[1].toLowerCase() : null;
}

// Index of the closing tag that balances the element opening at `openIndex`.
// Falls back to end-of-string when the HTML is unbalanced (bounded scan).
function matchingCloseIndex(html, openEnd, tagName, limit) {
  const ceiling = Math.min(html.length, limit);
  const tokenRe = new RegExp(
    "<(/?)" + tagName + "\\b(?:(\"[^\"]*\"|'[^']*'|[^>\"'])*)>",
    "gi",
  );
  tokenRe.lastIndex = openEnd;
  let depth = 1;
  let m;
  while ((m = tokenRe.exec(html)) !== null) {
    if (m.index > ceiling) break;
    const selfClosed = m[2] != null && /\/\s*$/.test(m[2]);
    if (m[1] === "/") {
      depth -= 1;
      if (depth === 0) return m.index + m[0].length;
    } else if (!selfClosed && !VOID_ELEMENTS.has(tagName.toLowerCase())) {
      depth += 1;
    }
  }
  return Math.min(ceiling, html.length);
}

function stripToText(innerHtml) {
  if (!innerHtml) return "";
  let s = String(innerHtml);
  s = s.replace(/<(script|style|template)\b[\s\S]*?<\/\1\s*>/gi, " ");
  s = s.replace(/<[^>]*>/g, " ");
  return collapseWhitespace(decodeHtmlEntities(s));
}

// Scan a region and return every itemprop-bearing element in order:
// [{ name, attrs, tag, innerStart, innerEnd }] where inner covers the
// element's content region (empty span for void/self-closed elements).
function scanItempropElements(region, regionStartOffset, html) {
  const found = [];
  TAG_SCAN_RE.lastIndex = 0;
  let m;
  while ((m = TAG_SCAN_RE.exec(region)) !== null) {
    const tag = m[1].toLowerCase();
    const attrs = m[2] || "";
    const isSelfClosed = /\/\s*$/.test(attrs);
    const itempropRaw = getAttr(attrs, "itemprop");
    if (!itempropRaw) continue;
    let innerStart = m.index + m[0].length;
    let innerEnd = innerStart;
    if (!VOID_ELEMENTS.has(tag) && !isSelfClosed) {
      innerEnd = matchingCloseIndex(region, innerStart, m[1], region.length);
      innerEnd = Math.max(innerEnd, innerStart);
    }
    for (const name of itempropRaw.split(/\s+/)) {
      if (!name) continue;
      found.push({
        name: name.toLowerCase(),
        attrs,
        tag,
        absInnerStart: regionStartOffset + innerStart,
        absInnerEnd: regionStartOffset + innerEnd,
        innerHtml: region.slice(innerStart, innerEnd),
        html,
      });
    }
  }
  return found;
}

function microdataElementValue(el) {
  const content = getAttr(el.attrs, "content");
  if (content != null && content.trim() !== "") return content.trim();
  const datetime = getAttr(el.attrs, "datetime");
  if (datetime != null && datetime.trim() !== "") return datetime.trim();
  const href = getAttr(el.attrs, "href") || getAttr(el.attrs, "src");
  if (href != null && href.trim() !== "") return href.trim();
  // Nested Person/Organization itemscopes carry the display value deeper.
  const nestedName = scanItempropElements(el.innerHtml, 0, "").find(
    (n) => n.name === "name",
  );
  const text = nestedName
    ? stripToText(nestedName.innerHtml)
    : stripToText(el.innerHtml);
  return text === "" ? null : text;
}

function microdataRegionsForType(html, typeName) {
  const regions = [];
  TAG_SCAN_RE.lastIndex = 0;
  let m;
  while ((m = TAG_SCAN_RE.exec(html)) !== null) {
    const attrs = m[2] || "";
    if (!hasBareAttr(attrs, "itemscope")) continue;
    if (itemTypeToken(attrs) !== typeName) continue;
    const tag = m[1];
    const innerStart = m.index + m[0].length;
    const end = VOID_ELEMENTS.has(tag.toLowerCase())
      ? innerStart
      : matchingCloseIndex(html, innerStart, tag, html.length);
    regions.push({ start: innerStart, end: Math.max(end, innerStart) });
  }
  return regions;
}

function recipesFromMicrodata(html) {
  const results = [];
  for (const region of microdataRegionsForType(html, "recipe")) {
    const regionHtml = html.slice(region.start, region.end);
    const props = new Map();
    for (const el of scanItempropElements(regionHtml, region.start, html)) {
      if (!props.has(el.name)) props.set(el.name, []);
      props.get(el.name).push(el);
    }
    const valueOf = (name) => {
      const list = props.get(name);
      if (!list || list.length === 0) return null;
      const v = microdataElementValue(list[0]);
      return v == null || v === "" ? null : v;
    };
    const valuesOf = (name) =>
      (props.get(name) || []).map((el) => microdataElementValue(el)).filter(
        (v) => v != null && v !== "",
      );

    const title = valueOf("name");
    if (!title) continue;

    const ingredientStrings = valuesOf("recipeingredient")
      .flatMap((v) => splitLines(v));

    // Instructions: one element (or several). Inside each, prefer explicit
    // HowToStep "text" properties; otherwise treat the element text as step
    // lines (split on newlines only). Sections flatten plainly in order.
    const stepTexts = [];
    for (const el of props.get("recipeinstructions") || []) {
      const innerSteps = scanItempropElements(el.innerHtml, 0, "")
        .filter((s) => s.name === "text")
        .map((s) => stripToText(s.innerHtml))
        .filter((t) => t !== "");
      if (innerSteps.length > 0) {
        stepTexts.push(...innerSteps);
      } else {
        let text = microdataElementValue(el);
        if (text == null || text === "") text = stripToText(el.innerHtml);
        if (text) stepTexts.push(...splitLines(text));
      }
    }

    const authorValue = (() => {
      const els = props.get("author");
      if (!els || els.length === 0) return null;
      const parts = els.map((el) => microdataElementValue(el)).filter(Boolean);
      return parts.length ? parts.join(", ") : null;
    })();

    const yieldInfo = parseYieldText(valueOf("recipeyield"));
    const prep = parseIsoDuration(valueOf("preptime"));
    const cook = parseIsoDuration(valueOf("cooktime"));
    const total = parseIsoDuration(valueOf("totaltime"));

    results.push({
      title,
      description: valueOf("description"),
      serves: yieldInfo.serves,
      yieldText: yieldInfo.text,
      prep,
      cook,
      total,
      ingredientStrings,
      stepTexts,
      tags: keywordsToTags(valuesOf("keywords")),
      author: authorValue,
    });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Site-level attribution helpers
// ---------------------------------------------------------------------------

function extractSiteName(html) {
  const ogPatterns = [
    /<meta[^>]+property=["']og:site_name["'][^>]*content=["']([^"']*)["']/i,
    /<meta[^>]+content=["']([^"']*)["'][^>]*property=["']og:site_name["']/i,
    /<meta[^>]+name=["']application-name["'][^>]*content=["']([^"']*)["']/i,
  ];
  for (const re of ogPatterns) {
    const m = re.exec(html);
    if (m && m[1].trim() !== "") return decodeHtmlEntities(m[1]).trim();
  }
  const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html);
  if (titleMatch) {
    const t = collapseWhitespace(decodeHtmlEntities(titleMatch[1]));
    if (t !== "") return t;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Mapping onto the CONTRACT partial Recipe
// ---------------------------------------------------------------------------

function safeParseIngredientLine(raw) {
  if (typeof parseIngredientLine === "function") {
    try {
      const parsed = parseIngredientLine(raw);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      // fall through to best-effort raw-only line
    }
  }
  return {
    quantity: null,
    quantityMax: null,
    unit: null,
    item: raw,
    preparation: null,
    substitute: null,
    sectionOverride: null,
    staple: false,
    uncertain: true,
    uncertaintyReason: "parser-unavailable",
  };
}

function buildIngredients(rawLines) {
  return rawLines.map((raw, index) => {
    const parsed = safeParseIngredientLine(raw);
    // Strip uncertain/uncertaintyReason into the final shape; keep raw verbatim.
    return {
      id: "i_" + String(index + 1).padStart(3, "0"),
      raw: typeof parsed.raw === "string" ? parsed.raw : raw,
      quantity: parsed.quantity == null ? null : parsed.quantity,
      quantityMax: parsed.quantityMax == null ? null : parsed.quantityMax,
      unit: parsed.unit == null ? null : parsed.unit,
      item: parsed.item == null ? raw : parsed.item,
      preparation: parsed.preparation == null ? null : parsed.preparation,
      substitute: parsed.substitute == null ? null : parsed.substitute,
      sectionOverride: parsed.sectionOverride == null ? null : parsed.sectionOverride,
      staple: parsed.staple === true,
    };
  });
}

function buildPartialRecipe(draft) {
  const nowIso = new Date().toISOString();
  const extra = [];
  if (draft.total != null && draft.total !== draft.prep + draft.cook) {
    extra.push({ label: "total", minutes: draft.total });
  }
  return {
    id: makeRecipeId(),
    title: draft.title,
    yield: {
      serves: draft.serves == null ? null : draft.serves,
      text: draft.yieldText == null ? null : draft.yieldText,
    },
    times: {
      prep: draft.prep,
      cook: draft.cook,
      extra,
    },
    ingredients: buildIngredients(draft.ingredientStrings),
    steps: draft.stepTexts.map((text) => ({ text })),
    notes: draft.description == null ? null : draft.description,
    tags: draft.tags,
    source: {
      url: draft.sourceUrl,
      title: draft.siteTitle,
      author: draft.author,
    },
    rating: null,
    history: [],
    photo: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

function draftFromJsonLd(node, sourceUrl, siteTitle) {
  const title = firstText(node.name);
  if (!title) return null;

  const ingredientStrings = ingredientStringsFromJsonLd(node.recipeIngredient);
  // Some pages put the lines in recipeInstructions as newline-separated text
  // with no recipeIngredient at all — handled naturally by the steps walker.
  const steps = [];
  stepsFromJsonLdInstructions(node.recipeInstructions, steps);

  const yieldInfo = parseYieldText(firstText(node.recipeYield));
  const prep = parseIsoDuration(firstText(node.prepTime));
  const cook = parseIsoDuration(firstText(node.cookTime));
  const total = parseIsoDuration(firstText(node.totalTime));

  const urlCandidates = [sourceUrl, node.url, node.mainEntityOfPage, node["@id"]];
  const sourceHref = urlCandidates.find(
    (u) => typeof u === "string" && u.trim() !== "",
  ) || null;

  const publisherName = node.publisher != null ? firstText(node.publisher.name) : null;

  return {
    title,
    description: firstText(node.description),
    serves: yieldInfo.serves,
    yieldText: yieldInfo.text,
    prep,
    cook,
    total,
    ingredientStrings,
    stepTexts: steps.map((s) => s.text),
    tags: keywordsToTags(node.keywords),
    author: authorNames(node.author),
    sourceUrl: sourceHref,
    siteTitle: publisherName || siteTitle || null,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extract every recipe we can honestly find in an HTML string.
 * Returns {ok:true, recipes:[partialRecipe...]} |
 *         {ok:false, reason:"invalid-html"} |
 *         {ok:false, reason:"no-recipe-data", details:string}.
 * Never throws.
 */
export function extractRecipesFromHtml(htmlString, sourceUrl = null) {
  try {
    if (
      typeof htmlString !== "string" ||
      htmlString.trim() === "" ||
      !/<[a-zA-Z!]/.test(htmlString)
    ) {
      return { ok: false, reason: "invalid-html" };
    }

    const siteTitle = extractSiteName(htmlString);
    const drafts = [];

    for (const node of recipeNodesFromJsonLd(htmlString)) {
      const draft = draftFromJsonLd(node, sourceUrl, siteTitle);
      if (draft) drafts.push(draft);
    }

    for (const draft of recipesFromMicrodata(htmlString)) {
      if (!draft.sourceUrl && typeof sourceUrl === "string" && sourceUrl.trim() !== "") {
        draft.sourceUrl = sourceUrl;
      }
      if (!draft.siteTitle && siteTitle) draft.siteTitle = siteTitle;
      drafts.push(draft);
    }

    if (drafts.length === 0) {
      const blockCount = collectJsonLdBlocks(htmlString).length;
      return {
        ok: false,
        reason: "no-recipe-data",
        details:
          "Parsed the page but found no schema.org Recipe markup. Panfare looked " +
          "for JSON-LD <script type=\"application/ld+json\"> blocks (found " +
          blockCount + ") and for microdata itemtype=\"schema.org/Recipe\". " +
          "The page may keep its recipe behind images or scripts — try manual entry.",
      };
    }

    return { ok: true, recipes: drafts.map(buildPartialRecipe) };
  } catch (err) {
    return {
      ok: false,
      reason: "invalid-html",
      details: "Extraction failed unexpectedly: " + (err && err.message),
    };
  }
}

/**
 * Fetch a URL and extract recipes from the response body.
 * Network/CORS failures map to reason "fetch-blocked" (the message explains
 * that site CORS rules — not Panfare — block the read, and points at the
 * paste-HTML fallback). Non-200 responses map to "http-error" with status.
 */
export async function fetchAndExtract(url, fetchImpl = globalThis.fetch) {
  let response;
  try {
    if (typeof fetchImpl !== "function") throw new Error("no fetch implementation available");
    response = await fetchImpl(url);
  } catch (err) {
    const cause = err && err.message ? err.message : String(err);
    return {
      ok: false,
      reason: "fetch-blocked",
      details:
        "Could not read " + url + " (" + cause + "). Most recipe sites send CORS " +
        "headers that forbid browser apps like Panfare from reading their pages — " +
        "that is a browser security rule, not a bug here. Fallback: open the page, " +
        "save or copy its HTML (Ctrl+S or view-source), and paste it into the " +
        "importer directly.",
    };
  }
  if (!response || typeof response.ok !== "boolean" || response.ok === false) {
    const status = response && typeof response.status === "number" ? response.status : 0;
    return {
      ok: false,
      reason: "http-error",
      status,
      details: "The site answered with HTTP status " + status + ".",
    };
  }
  let bodyText;
  try {
    bodyText = await response.text();
  } catch (err) {
    return {
      ok: false,
      reason: "fetch-blocked",
      details:
        "The response could not be read (" + (err && err.message) + "). If the site " +
        "blocks cross-origin reads, use the paste-HTML fallback instead.",
    };
  }
  return extractRecipesFromHtml(bodyText, url);
}

// ---------------------------------------------------------------------------
// Known limitations of the string-based extractor (deliberate, documented)
// ---------------------------------------------------------------------------
//
// 1. HTML comments are not stripped: recipe-looking markup inside
//    <!-- ... --> would be read. Rare in practice.
// 2. Attribute values containing ">" can confuse the tag scanner; quoted
//    values are handled, but a ">" inside an unquoted value is not.
// 3. Microdata property ownership is positional: the first itemprop="name"
//    inside the Recipe scope wins the title, so nested itemscopes that carry
//    their own "name" properties (HowToSection headings) must come after it.
// 4. Unbalanced tags make scope-end detection fall back to end-of-string,
//    which can over-collect properties on badly malformed pages.
// 5. JSON-LD @id references between graph nodes are not resolved; authors or
//    publishers referenced only by {"@id": "..."} yield null attribution.
// 6. The microdata path reads one flat region per Recipe itemscope and does
//    not model value ordering across interleaved multiple-value groups.
