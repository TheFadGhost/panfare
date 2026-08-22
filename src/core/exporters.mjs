// exporters.mjs — Panfare's outward formats: lossless JSON, fridge-door
// markdown, and printable HTML.
//
// Rules honoured here: quantities stay exact rationals end to end (a Fraction
// becomes an [n, d] pair in the JSON envelope, never a float); attribution
// survives every format — a present source is always rendered.

import { makeFraction, eq, ONE } from "./fraction.mjs";
import { formatQuantity, formatQuantityRange } from "./format.mjs";
import { scaleRecipe } from "./scaling.mjs";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

export function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);
}

function isFractionShaped(o) {
  return (
    o !== null &&
    typeof o === "object" &&
    !Array.isArray(o) &&
    Object.keys(o).length === 2 &&
    Number.isInteger(o.n) &&
    Number.isInteger(o.d) &&
    o.d > 0
  );
}

// ---------------------------------------------------------------------------
// JSON export: {"format":"panfare/1","recipe":{...quantities as [n,d]...}}
// ---------------------------------------------------------------------------

function encodeValue(value) {
  if (Array.isArray(value)) return value.map(encodeValue);
  if (isFractionShaped(value)) return [value.n, value.d];
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = encodeValue(v);
    return out;
  }
  return value;
}

function decodeValue(value) {
  if (Array.isArray(value)) {
    if (
      value.length === 2 &&
      Number.isInteger(value[0]) &&
      Number.isInteger(value[1]) &&
      value[1] > 0
    ) {
      return { n: value[0], d: value[1] };
    }
    return value.map(decodeValue);
  }
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = decodeValue(v);
    return out;
  }
  return value;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const k of Object.keys(value).sort()) out[k] = stableValue(value[k]);
    return out;
  }
  return value;
}

/** Stable pretty JSON under the {"format":"panfare/1"} envelope. */
export function toJson(recipe) {
  if (!recipe || typeof recipe !== "object") throw new Error("recipe object required");
  const envelope = { format: "panfare/1", recipe: encodeValue(recipe) };
  return JSON.stringify(stableValue(envelope), null, 2) + "\n";
}

/** Exact inverse of toJson(); throws on anything that is not panfare/1. */
export function fromJson(jsonString) {
  let parsed;
  try {
    parsed = JSON.parse(String(jsonString));
  } catch (err) {
    throw new Error("Not valid JSON: " + err.message);
  }
  if (!parsed || typeof parsed !== "object" || parsed.format !== "panfare/1") {
    throw new Error("Missing or unsupported \"format\" field (expected \"panfare/1\")");
  }
  if (!parsed.recipe || typeof parsed.recipe !== "object") {
    throw new Error("Envelope carries no recipe object");
  }
  return decodeValue(parsed.recipe);
}

// ---------------------------------------------------------------------------
// Markdown export
// ---------------------------------------------------------------------------

function normalizeFactor(scaleFactor) {
  if (scaleFactor == null) return ONE;
  const f = makeFraction(scaleFactor.n, scaleFactor.d);
  return f;
}

function quantityText(line, system = null) {
  const hasMin = line.quantity != null;
  const hasMax = line.quantityMax != null;
  if (hasMin && hasMax && !eqSafe(line.quantity, line.quantityMax)) {
    return formatQuantityRange(
      { amount: line.quantity, unit: line.unit },
      { amount: line.quantityMax, unit: line.unit },
      { system },
    ).text;
  }
  const amount = hasMin ? line.quantity : hasMax ? line.quantityMax : null;
  if (amount == null) return "";
  return formatQuantity({ amount, unit: line.unit }, { system }).text;
}

function eqSafe(a, b) {
  try {
    return a.d * b.n === b.d * a.n;
  } catch {
    return false;
  }
}

function ingredientToMarkdown(line, system = null) {
  const bits = [];
  if (line.sectionOverride) bits.push(line.sectionOverride + ": ");
  const qty = quantityText(line, system);
  if (qty) bits.push(qty + " ");
  bits.push(line.item == null ? "" : String(line.item));
  if (line.preparation) bits.push(", " + line.preparation);
  if (line.substitute) bits.push(" (or " + line.substitute + ")");
  return "- " + bits.join("");
}

function timesParts(times) {
  const parts = [];
  const add = (label, minutes) => {
    if (typeof minutes === "number" && Number.isFinite(minutes)) {
      parts.push(label + ": " + minutes + " min");
    }
  };
  add("Prep", times.prep);
  add("Cook", times.cook);
  for (const extra of Array.isArray(times.extra) ? times.extra : []) {
    if (extra && typeof extra.minutes === "number") {
      add(extra.label ? extra.label.charAt(0).toUpperCase() + extra.label.slice(1) : "Extra", extra.minutes);
    }
  }
  return parts;
}

/**
 * Render a recipe as markdown. scaleFactor is a Fraction-shaped {n, d}.
 * opts.system optionally steers display units ("metric"|"imperial"|null).
 * Scaling reuses the shared engine: quantities scale exactly, step text is
 * rewritten with scaleStepText, and the stated yield follows suit. Times are
 * deliberately untouched (they never scale silently). The "Source:" line is
 * emitted whenever any attribution exists — never omitted, never trimmed.
 */
export function toMarkdown(recipe, scaleFactor = { n: 1, d: 1 }, opts = {}) {
  if (!recipe || typeof recipe !== "object") throw new Error("recipe object required");
  const factor = normalizeFactor(scaleFactor);
  const scaled = eq(factor, ONE) ? recipe : scaleRecipe(recipe, factor);

  const lines = [];
  lines.push("# " + (recipe.title == null ? "(untitled)" : String(recipe.title)));
  lines.push("");

  const meta = [];
  const yields = scaled.yield || {};
  if (yields.serves != null) meta.push("Yield: serves " + yields.serves);
  else if (yields.text) meta.push("Yield: " + yields.text);
  meta.push(...timesParts(scaled.times || {}));
  if (meta.length) {
    lines.push(...meta);
    lines.push("");
  }

  const ingredients = Array.isArray(scaled.ingredients) ? scaled.ingredients : [];
  if (ingredients.length) {
    lines.push("## Ingredients");
    lines.push("");
    for (const line of ingredients) lines.push(ingredientToMarkdown(line, opts.system));
    lines.push("");
  }

  const steps = Array.isArray(scaled.steps) ? scaled.steps : [];
  if (steps.length) {
    lines.push("## Method");
    lines.push("");
    steps.forEach((step, i) => {
      lines.push(i + 1 + ". " + (step && step.text != null ? String(step.text) : ""));
    });
    lines.push("");
  }

  if (recipe.notes != null && String(recipe.notes).trim() !== "") {
    lines.push("## Notes");
    lines.push("");
    lines.push(String(recipe.notes));
    lines.push("");
  }

  const source = recipe.source || {};
  const srcBits = [];
  if (source.author) srcBits.push(source.author);
  if (source.title) srcBits.push(source.title);
  let sourceLine = null;
  if (srcBits.length) sourceLine = "Source: " + srcBits.join(" \u2014 ");
  else if (source.url) sourceLine = "Source: " + source.url;
  if (sourceLine) {
    if (source.url && srcBits.length) sourceLine += " (" + source.url + ")";
    lines.push(sourceLine);
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

// ---------------------------------------------------------------------------
// Printable HTML export
// ---------------------------------------------------------------------------

const PRINT_CSS = [
  "@page { margin: 18mm; }",
  "* { box-sizing: border-box; }",
  "html, body { background: #ffffff; color: #000000; margin: 0; padding: 0;",
  "  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;",
  "  font-size: 12pt; line-height: 1.5; }",
  "h1.pf-title { font-family: 'Fraunces', Georgia, 'Times New Roman', serif;",
  "  font-weight: 600; font-size: 24pt; line-height: 1.15; margin: 0 0 4mm 0; }",
  "h2.pf-label { font-family: system-ui, sans-serif; font-weight: 600;",
  "  font-size: 9.5pt; letter-spacing: 0.08em; text-transform: uppercase;",
  "  border-bottom: 1px solid #000; padding-bottom: 1mm; margin: 6mm 0 3mm 0; }",
  ".pf-head { page-break-after: avoid; break-after: avoid; }",
  ".pf-meta { margin: 0 0 1mm 0; }",
  ".pf-source { margin-top: 2mm; }",
  ".pf-section { margin-bottom: 4mm; }",
  "ul.pf-ingredients, ol.pf-steps, ul.pf-list-items { list-style: none;",
  "  margin: 0; padding: 0; }",
  "ol.pf-steps { counter-reset: pfstep; }",
  "ol.pf-steps > li::before { counter-increment: pfstep;",
  "  content: counter(pfstep) '.'; font-family: 'Fraunces', Georgia, serif;",
  "  position: absolute; left: 0; font-weight: 500; }",
  "ol.pf-steps > li { position: relative; padding-left: 9mm;",
  "  page-break-inside: avoid; break-inside: avoid; margin-bottom: 2.5mm; }",
  ".pf-row { page-break-inside: avoid; break-inside: avoid;",
  "  margin-bottom: 1.5mm; }",
  ".pf-qty { display: inline-block; min-width: 16ch; font-weight: 600;",
  "  font-variant-numeric: tabular-nums; }",
  ".pf-check { display: flex; align-items: baseline; gap: 3mm;",
  "  padding: 1mm 0; }",
  ".pf-check::before { content: ''; flex: 0 0 auto; width: 4mm; height: 4mm;",
  "  border: 0.6mm solid #000; align-self: center; background: #ffffff;",
  "  box-shadow: none; }",
  ".pf-muted { color: #444444; }",
  ".pf-sub { display: block; margin-left: 19mm; }",
  ".pf-note-chip { display: inline-block; border: 1px solid #000;",
  "  padding: 0 1.5mm; margin-left: 2mm; font-size: 9pt; }",
  ".pf-footer { margin-top: 8mm; border-top: 1px solid #000;",
  "  padding-top: 2mm; }",
].join("\n");

function quantityCell(line, system = null) {
  const hasMin = line.quantity != null;
  const hasMax = line.quantityMax != null;
  if (hasMin && hasMax && !eqSafe(line.quantity, line.quantityMax)) {
    return escapeHtml(
      formatQuantityRange(
        { amount: line.quantity, unit: line.unit },
        { amount: line.quantityMax, unit: line.unit },
        { system },
      ).text,
    );
  }
  const amount = hasMin ? line.quantity : hasMax ? line.quantityMax : null;
  if (amount == null) return "";
  return escapeHtml(formatQuantity({ amount, unit: line.unit }, { system }).text);
}

function sourceSentence(source) {
  const src = source || {};
  const bits = [];
  if (src.author) bits.push(src.author);
  if (src.title) bits.push(src.title);
  if (bits.length === 0 && !src.url) return null;
  let line = bits.length ? "Source: " + bits.join(" \u2014 ") : "Source: unknown";
  if (src.url) line += " (" + src.url + ")";
  return line;
}

function printableRecipeDoc(doc, opts) {
  const factor = doc.scaleFactor == null ? ONE : makeFraction(doc.scaleFactor.n, doc.scaleFactor.d);
  const scaled = eq(factor, ONE) ? doc.recipe : scaleRecipe(doc.recipe, factor);
  const r = scaled;
  const source = sourceSentence(r.source);

  const head = [
    '<header class="pf-head">',
    '<h1 class="pf-title">' + escapeHtml(r.title == null ? "(untitled)" : r.title) + "</h1>",
  ];
  const metaBits = [];
  if (r.yield && r.yield.serves != null) metaBits.push("serves " + escapeHtml(r.yield.serves));
  else if (r.yield && r.yield.text) metaBits.push(escapeHtml(r.yield.text));
  const tp = timesParts(r.times || {});
  if (tp.length) metaBits.push(escapeHtml(tp.join(" \u00B7 ")));
  if (metaBits.length) head.push('<p class="pf-meta">' + metaBits.join(" \u00B7 ") + "</p>");
  if (source) head.push('<p class="pf-source">' + escapeHtml(source) + "</p>");
  head.push("</header>");

  const ingRows = (Array.isArray(r.ingredients) ? r.ingredients : [])
    .map((line) => {
      const qty = quantityCell(line, opts.system);
      const item =
        (line.item == null ? "" : escapeHtml(line.item)) +
        (line.preparation ? " \u2014 <span class=\"pf-muted\">" + escapeHtml(line.preparation) + "</span>" : "");
      const sub = line.substitute
        ? '<span class="pf-sub pf-muted">or ' + escapeHtml(line.substitute) + "</span>"
        : "";
      return (
        '<li class="pf-row">' +
        '<span class="pf-qty">' + qty + "</span> " +
        "<span>" + item + "</span>" + sub +
        "</li>"
      );
    })
    .join("\n");

  const stepRows = (Array.isArray(r.steps) ? r.steps : [])
    .map((step) =>
      '<li class="pf-row pf-step">' + escapeHtml(step && step.text != null ? step.text : "") + "</li>",
    )
    .join("\n");

  const notes =
    r.notes != null && String(r.notes).trim() !== ""
      ? '<section class="pf-section"><h2 class="pf-label">Notes</h2><p>' +
        escapeHtml(r.notes) +
        "</p></section>"
      : "";

  return (
    '<article class="pf-print">' +
    head.join("") +
    '<section class="pf-section"><h2 class="pf-label">Ingredients</h2>' +
    '<ul class="pf-ingredients">' + ingRows + "</ul></section>" +
    '<section class="pf-section"><h2 class="pf-label">Method</h2>' +
    '<ol class="pf-steps">' + stepRows + "</ol></section>" +
    notes +
    "</article>"
  );
}

function printableListDoc(list, opts) {
  const groups = Array.isArray(list.groups) ? list.groups : [];
  const sections = groups
    .map((group) => {
      const items = (group.items || [])
        .map((item) => {
          const qtyText = (item.quantities || [])
            .map((q) =>
              (q.approx ? "\u2248 " : "") +
              formatQuantity({ amount: q.amount, unit: q.unit }, { system: opts.system ?? null }).text,
            )
            .join(" \u00B7 ");
          const prepText =
            item.preparations && item.preparations.length
              ? item.preparations.join(", ")
              : "";
          // Kept-separate reasons render as chips only (not duplicated in
          // the muted preparation line).
          const chips = (item.notes || [])
            .map((note) => '<span class="pf-note-chip">' + escapeHtml(note) + "</span>")
            .join(" ");
          return (
            '<li class="pf-row pf-check">' +
            "<span>" + escapeHtml(qtyText) + "</span>" +
            "<span>" + escapeHtml(item.displayName) +
            (prepText ? ' <span class="pf-muted">\u2014 ' + escapeHtml(prepText) + "</span>" : "") +
            chips +
            "</span></li>"
          );
        })
        .join("\n");
      return (
        '<section class="pf-list-section pf-section">' +
        '<h2 class="pf-label">' + escapeHtml(group.section) + "</h2>" +
        '<ul class="pf-list-items">' + items + "</ul></section>"
      );
    })
    .join("\n");
  const footer =
    list.hiddenStaples > 0
      ? '<footer class="pf-footer">' + escapeHtml(list.hiddenStaples + " pantry staples hidden") + "</footer>"
      : "";
  return '<article class="pf-print"><h1 class="pf-title">Shopping list</h1>' + sections + footer + "</article>";
}

/**
 * Standalone printable HTML (inline CSS, zero external assets, zero scripts).
 * doc: {kind:"recipe", recipe, scaleFactor?} | {kind:"shoppingList", list}
 * opts: { system?: "metric"|"imperial"|null } — display-time unit preference.
 */
export function toPrintableHtml(doc, opts = {}) {
  if (!doc || typeof doc !== "object") throw new Error("doc object required");

  let body;
  let title;
  if (doc.kind === "shoppingList") {
    body = printableListDoc(doc.list || {}, opts);
    title = "Shopping list";
  } else if (doc.kind === "recipe") {
    if (!doc.recipe || typeof doc.recipe !== "object") throw new Error("doc.recipe required");
    body = printableRecipeDoc(doc, opts);
    title = doc.recipe.title == null ? "Recipe" : doc.recipe.title;
  } else {
    throw new Error("Unsupported doc.kind: " + String(doc.kind));
  }

  return (
    "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n" +
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n" +
    "<title>" + escapeHtml(title) + " \u2014 Panfare</title>\n" +
    "<style>\n" + PRINT_CSS + "\n</style>\n</head>\n<body>\n" +
    body + "\n</body>\n</html>\n"
  );
}
