// recipeView.mjs â€” the typographic recipe page.
//
// Reads the stored recipe, applies the remembered scale factor (state.getScale)
// and renders per DESIGN.md: three-column ingredient grid, vulgar-fraction
// quantities with spoken aria-labels, Fraunces step numerals, embedded
// <data class="scaled-qty"> quantities in step text, and a calm amber margin
// note for non-linear ingredients and unscaled step times.

import { h, escapeHtml, qtyHtml } from "../dom.mjs";
import { getState, getRecipe, getScale, setScale, deleteRecipe } from "../state.mjs";
import { ONE, eq } from "../../core/fraction.mjs";
import { scaleRecipe } from "../../core/scaling.mjs";
import {
  formatQuantity,
  formatScalar,
  formatFraction,
  pickDisplayUnit,
  roundMetricBase,
} from "../../core/format.mjs";
import { numberTokenToFraction } from "../../core/parser.mjs";
import { safeUrl } from "../../core/urlsafe.mjs";

const QUICK_FACTORS = [
  { label: "\u00BD", frac: { n: 1, d: 2 } },
  { label: "\u2154", frac: { n: 2, d: 3 } },
  { label: "\u00BE", frac: { n: 3, d: 4 } },
  { label: "1", frac: { n: 1, d: 1 } },
  { label: "1\u00BD", frac: { n: 3, d: 2 } },
  { label: "2", frac: { n: 2, d: 1 } },
  { label: "3", frac: { n: 3, d: 1 } },
];

// Number token shapes that can appear in step text (mirrors core/scaling).
const GLYPHS = "\u00BC\u00BD\u00BE\u2150\u2151\u2152\u2153\u2154\u2155\u2156\u2157\u2158\u2159\u215A\u215B\u215C\u215D\u215E";
const NUM_TOKEN_RE = new RegExp(
  "\\d+\\s+\\d+/\\d+" +
    "|\\d+\\s*[" + GLYPHS + "]" +
    "|[" + GLYPHS + "]" +
    "|\\d+/\\d+" +
    "|\\d+\u2044\\d+" +
    "|\\d+\\.\\d+" +
    "|\\d+",
  "g"
);
const YEAR_UNIT_RE =
// keep word-for-word in sync with scaling.mjs YEAR_UNIT_WHITELIST_RE
/^(?:cups?|tbsps?|tsps?|tablespoons?|teaspoons?|grams?|g|kgs?|kg|kilograms?|ml|millilitres?|milliliters?|l|litres?|liters?|floz|fluid ounces|oz|ounces?|lbs?|pounds?|cloves?|slices?|sprigs?|leaves|sticks?|pinches|pinchs?|dashes|handfuls|packets?|cans?|bunches|heads?|fillets?|rashers?|each|portions?|servings?|batches|tins?|trays?|sheets?|layers?|hours?|hrs?|minutes?|mins?|seconds?|secs?|days?|degrees?|x)/i;

/** True when this number must NOT be wrapped as a scaling quantity
 *  (temperatures, gas marks, servings counts, ordinals, years, durations). */
function isNonScalingToken(text, start, end) {
  const after = text.slice(end);
  const before = text.slice(0, start);
  if (/^\s*(?:\u00B0\s*[CF]\b|deg(?:rees?)?\s+(?:C|F|celsius|fahrenheit)\b|celsius\b|fahrenheit\b)/i.test(after)) return true;
  if (/\bgas\s+marks?\s*$/i.test(before)) return true;
  if (/\b(?:serves?|servings?|makes?)\s*$/i.test(before)) return true;
  if (/^(?:st|nd|rd|th)\b/i.test(after)) return true;
  if (/^\s*\./.test(after) && /(^|\n)[ \t]*$/.test(before)) return true;
  if (/^\s*(?:hours?|hrs?|minutes?|mins?|seconds?|secs?|days?)\b/i.test(after)) return true;
  if (/^\d+$/.test(text.slice(start, end))) {
    const v = Number(text.slice(start, end));
    if (v >= 1500 && v <= 2100) {
      const nextWord = /^\s*(\u00B0?[A-Za-z]+)/.exec(after);
      if (!nextWord || !YEAR_UNIT_RE.test(nextWord[1])) return true;
    }
  }
  return false;
}

function htmlFragment(htmlString) {
  const tpl = document.createElement("template");
  tpl.innerHTML = htmlString;
  return tpl.content.firstElementChild;
}

const MARKER = "\u2248 ";

/**
 * Split one scaled amount into grid cells: the bare number (with honest
 * approx marker) and the display unit label (pluralised exactly as
 * formatQuantity would pluralise it).
 */
function quantityCells(frac, unitId, system) {
  let value = frac;
  let unit = unitId || null;
  let approx = false;
  let unknownUnit = false;
  if (unit) {
    try {
      const picked = pickDisplayUnit(value, unit, { system: system || null });
      value = picked.amount;
      unit = picked.unitId;
    } catch {
      unit = null; // stale/unknown unit id in storage
      unknownUnit = true;
    }
    if ((unit === "ml" || unit === "g") && system !== "imperial") {
      const r = roundMetricBase(value);
      value = r.value;
      approx = r.approx;
    }
  }
  const bare = formatQuantity({ amount: value }, { approximateMetric: false });
  let unitText = "";
  if (unit) {
    try {
      const fullText = formatQuantity({ amount: value, unit }, { approximateMetric: false }).text;
      if (fullText.startsWith(bare.text)) {
        unitText = fullText.slice(bare.text.length).replace(/^ /, "");
      }
    } catch {
      unitText = "";
    }
  } else if (unknownUnit) {
    unitText = "unknown unit";
  }
  // Preserve formatQuantity's own honesty marker; add one only for metric
  // rounding this helper performed itself.
  const prefix = approx && !bare.text.startsWith(MARKER) ? MARKER : "";
  const markedText = prefix + bare.text;
  const markedHtml = prefix + bare.html;
  return {
    text: markedText,
    html: markedHtml,
    aria: (approx || bare.approx ? "approximately " : "") + bare.aria + (unknownUnit ? ", unknown unit" : ""),
    unitText,
  };
}

function rangeCells(minFrac, maxFrac, unitId, system) {
  const lo = quantityCells(minFrac, unitId, system);
  const hi = quantityCells(maxFrac, unitId, system);
  return {
    text: lo.text + "\u2013" + hi.text,
    html: lo.html + "\u2013" + hi.html,
    aria: lo.aria + " to " + hi.aria,
    unitText: hi.unitText || lo.unitText,
  };
}

function ingredientRow(line, system) {
  const hasQty = line.quantity != null;
  const cells = !hasQty
    ? null
    : line.quantityMax != null
      ? rangeCells(line.quantity, line.quantityMax, line.unit, system)
      : quantityCells(line.quantity, line.unit, system);

  const qtyCell = h("data", { class: "qty" });
  if (cells) {
    qtyCell.setAttribute("aria-label", cells.aria);
    qtyCell.setAttribute("title", cells.text);
    qtyCell.innerHTML = cells.html;
  }

  const itemBits = [line.item || ""];
  if (line.uncertain) {
    itemBits.push(
      h("span", { class: "chip", title: line.raw || "Unparsed line" }, "needs check")
    );
  }
  if (line.preparation) {
    itemBits.push(h("span", { class: "prep" }, " \u2014 ", line.preparation));
  }

  const children = [qtyCell, h("span", { class: "unit" }, cells ? cells.unitText : ""), h("span", {}, itemBits)];
  if (line.substitute) {
    children.push(h("span", { class: "ingredient-sub" }, "or ", line.substitute));
  }
  return h("li", { class: "ingredient-row" }, children);
}

/** Step text as safe HTML: plain text escaped, quantity tokens wrapped in
 *  <data class="scaled-qty"> via dom.qtyHtml (which escapes itself). */
function stepHtml(text) {
  let out = "";
  let last = 0;
  NUM_TOKEN_RE.lastIndex = 0;
  let m;
  while ((m = NUM_TOKEN_RE.exec(text)) !== null) {
    out += escapeHtml(text.slice(last, m.index));
    const token = m[0];
    if (isNonScalingToken(text, m.index, m.index + token.length)) {
      out += escapeHtml(token);
    } else {
      let frac = null;
      try {
        frac = numberTokenToFraction(token);
      } catch {
        frac = null;
      }
      out += frac ? qtyHtml(formatScalar(frac, 16)) : escapeHtml(token);
    }
    last = m.index + token.length;
  }
  out += escapeHtml(text.slice(last));
  return out;
}

function parseFactorInput(raw) {
  const t = String(raw == null ? "" : raw).trim().toLowerCase();
  if (!t) return null;
  let f = null;
  try {
    f = numberTokenToFraction(t);
  } catch {
    return null;
  }
  return f && f.n > 0 ? f : null;
}

export function recipeView(container, params) {
  const id = params && params.id ? decodeURIComponent(params.id) : null;
  const recipe = id ? getRecipe(id) : null;

  // ---- missing recipe ---------------------------------------------------------

  if (!recipe) {
    container.append(
      h(
        "section",
        { class: "empty-state" },
        h("h2", { class: "empty-state__title" }, "That recipe is gone."),
        h("p", {}, "It may have been deleted, or the link is out of date."),
        h("a", { class: "btn btn-primary", href: "#/library" }, "Back to the library")
      )
    );
    return function cleanup() {};
  }

  const settings = getState().settings || {};
  const unitsSystem = settings.unitsSystem || null;

  let factor = getScale(recipe.id) || ONE;
  let armedDelete = false;
  let deleteTimer = null;

  // ---- print ------------------------------------------------------------------

  const afterPrint = () => document.body.classList.remove("print-recipe");
  window.addEventListener("afterprint", afterPrint);

  function printRecipe() {
    document.body.classList.add("print-recipe");
    window.print();
  }

  // ---- page-level shortcuts ----------------------------------------------------

  function onKeydown(e) {
    const t = e.target;
    const typing =
      t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "c") {
      location.hash = "#/cook/" + encodeURIComponent(recipe.id);
      e.preventDefault();
    } else if (e.key === "e") {
      location.hash = "#/recipe/edit/" + encodeURIComponent(recipe.id);
      e.preventDefault();
    }
  }
  document.addEventListener("keydown", onKeydown);

  // ---- rendering -----------------------------------------------------------------

  function resolvedYieldText(scaled) {
    const serves = scaled.yield && typeof scaled.yield.serves === "number" ? scaled.yield.serves : null;
    if (serves != null) return "serves " + serves;
    const text = scaled.yield && typeof scaled.yield.text === "string" ? scaled.yield.text.trim() : "";
    return text;
  }

  function metaLine() {
    const bits = [];
    const y = recipe.yield || {};
    if (typeof y.serves === "number" && y.serves > 0) bits.push("serves " + y.serves);
    else if (typeof y.text === "string" && y.text.trim()) bits.push(y.text.trim());
    const times = recipe.times || {};
    if (typeof times.prep === "number") bits.push("prep " + times.prep + " min");
    if (typeof times.cook === "number") bits.push("cook " + times.cook + " min");

    const parts = [];
    if (bits.length) parts.push(bits.join(" \u00B7 "));
    for (const tag of Array.isArray(recipe.tags) ? recipe.tags : []) {
      if (typeof tag !== "string" || !tag.trim()) continue;
      parts.push(", ");
      parts.push(h("span", { class: "chip" }, tag));
    }
    const src = recipe.source || {};
    const label = [src.author, src.title].find((v) => typeof v === "string" && v.trim());
    const safeLink = safeUrl(src.url);
    if (label || src.url) {
      parts.push(" \u00B7 from ");
      parts.push(
        safeLink
          ? h("a", { href: safeLink, target: "_blank", rel: "noopener noreferrer" }, label || safeLink)
          : String(label)
      );
    }
    return h("p", { style: "margin:8px 0 0;font-variant-numeric:tabular-nums;" }, parts);
  }

  function warnPanel(scaled) {
    if (eq(factor, ONE)) return null;
    const lines = [];
    const seen = new Set();
    for (const w of Array.isArray(scaled.warnings) ? scaled.warnings : []) {
      const key = String(w.item) + "\u0001" + String(w.guidance);
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(h("li", {}, h("strong", {}, w.item), " \u2014 ", w.guidance));
    }
    const timeSnippets = [];
    for (const step of Array.isArray(scaled.steps) ? scaled.steps : []) {
      for (const flag of Array.isArray(step.flags) ? step.flags : []) {
        if (flag && flag.snippet && !timeSnippets.includes(flag.snippet)) {
          timeSnippets.push(flag.snippet);
        }
      }
    }
    if (!lines.length && !timeSnippets.length) return null;
    const list = h("ul", {});
    list.append(...lines);
    if (timeSnippets.length) {
      list.append(
        h(
          "li",
          {},
          "Step times do not change with scaling \u2014 oven and simmer times stay as written."
        )
      );
    }
    return h(
      "aside",
      { class: "warn-panel", "aria-label": "Scaling notes" },
      h("strong", {}, "A note on scaling"),
      list
    );
  }

  function scalingControl() {
    const errId = "pf-scale-error";
    const errorLine = h("span", { id: errId, class: "field-message", hidden: true });

    function commitCustom() {
      const raw = customInput.value.trim();
      if (!raw) {
        applyFactor(ONE);
        return;
      }
      const parsed = parseFactorInput(raw);
      if (!parsed) {
        errorLine.textContent = "Enter an amount like 1 1/2, 3/4 or 2.";
        errorLine.hidden = false;
        customInput.setAttribute("aria-invalid", "true");
        customInput.setAttribute("aria-describedby", errId);
        customInput.value = formatFraction(factor).text;
        return;
      }
      customInput.removeAttribute("aria-invalid");
      customInput.removeAttribute("aria-describedby");
      errorLine.hidden = true;
      applyFactor(parsed);
    }

    const customInput = h("input", {
      type: "text",
      inputmode: "text",
      "aria-label": "Custom scale factor",
      style: "width:7rem;",
      onchange: commitCustom,
      onkeydown: (e) => {
        if (e.key === "Enter") {
          commitCustom();
          e.preventDefault();
        }
      },
    });

    function applyFactor(f) {
      factor = f;
      setScale(recipe.id, f);
      const focusedLabel = document.activeElement instanceof HTMLElement &&
        segmented.contains(document.activeElement)
        ? document.activeElement.textContent
        : null;
      render();
      if (focusedLabel) {
        const again = segmented.querySelector(
          'button[aria-pressed="true"]'
        );
        const byLabel = Array.from(segmented.querySelectorAll("button"))
          .find((b) => b.textContent === focusedLabel);
        const target = again || byLabel;
        if (target instanceof HTMLElement) target.focus();
      }
    }

    const segmented = h("div", { class: "segmented", role: "group", "aria-label": "Quick scale factors" });
    for (const option of QUICK_FACTORS) {
      segmented.append(
        h(
          "button",
          {
            type: "button",
            "aria-pressed": eq(factor, option.frac) ? "true" : "false",
            onclick: () => applyFactor(option.frac),
            onkeydown: (e) => {
              // roving arrows within the group, per WAI-ARIA button-group pattern
              if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
              e.preventDefault();
              const buttons = Array.from(segmented.querySelectorAll("button"));
              const i = buttons.indexOf(document.activeElement);
              if (i === -1) return;
              const delta = e.key === "ArrowRight" ? 1 : -1;
              const next = buttons[(i + delta + buttons.length) % buttons.length];
              next.focus();
              applyFactor(QUICK_FACTORS[buttons.indexOf(next)].frac);
            },
          },
          option.label
        )
      );
    }

    return h(
      "div",
      { class: "no-print", style: "display:flex;gap:16px;flex-wrap:wrap;align-items:center;margin-top:24px;" },
      segmented,
      customInput,
      h("output", { style: "font-weight:600;font-variant-numeric:tabular-nums;" }, resolvedYieldText(scaleRecipe(recipe, factor))),
      errorLine
    );
  }

  function notesSection() {
    const notes = recipe.notes;
    if (notes == null) return null;
    const paragraphs = Array.isArray(notes)
      ? notes.filter((n) => typeof n === "string" && n.trim())
      : typeof notes === "string" && notes.trim()
        ? notes.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean)
        : [];
    if (!paragraphs.length) return null;
    return h(
      "section",
      {},
      h("h2", { class: "section-heading" }, "Notes"),
      paragraphs.map((p) => h("p", { style: "max-width:68ch;margin-bottom:8px;" }, p))
    );
  }

  function actionsRow() {
    const deleteBtn = h("button", { class: "btn", type: "button" }, "Delete\u2026");
    deleteBtn.addEventListener("click", () => {
      if (!armedDelete) {
        armedDelete = true;
        deleteBtn.textContent = "Really delete?";
        deleteBtn.setAttribute("aria-label", "Select again to permanently delete this recipe");
        deleteBtn.style.borderColor = "var(--pf-danger, #a03123)";
        deleteBtn.style.color = "var(--pf-danger, #a03123)";
        deleteTimer = setTimeout(disarmDelete, 5000);
      } else {
        clearTimeout(deleteTimer);
        deleteTimer = null;
        deleteRecipe(recipe.id);
        location.hash = "#/library";
      }
    });
    function disarmDelete() {
      armedDelete = false;
      deleteBtn.textContent = "Delete\u2026";
      deleteBtn.removeAttribute("aria-label");
      deleteBtn.style.borderColor = "";
      deleteBtn.style.color = "";
    }

    return h(
      "div",
      {
        class: "no-print",
        style: "display:flex;gap:12px;flex-wrap:wrap;margin:32px 0 16px;",
      },
      h("a", { class: "btn btn-primary", href: "#/cook/" + encodeURIComponent(recipe.id) }, "Cook"),
      h("a", { class: "btn", href: "#/recipe/edit/" + encodeURIComponent(recipe.id) }, "Edit"),
      h("button", { class: "btn", type: "button", onclick: printRecipe }, "Print"),
      h("a", { class: "btn", href: "#/planner" }, "Add to planner"),
      deleteBtn
    );
  }

  function render() {
    const scaled = scaleRecipe(recipe, factor);

    container.textContent = "";

    const headerBits = [
      h("h1", {}, recipe.title || "Untitled recipe"),
      metaLine(),
    ];
    if (recipe.photo) {
      headerBits.push(
        h(
          "figure",
          { style: "margin:24px 0 0;" },
          h("img", {
            src: recipe.photo,
            alt: (recipe.title || "Recipe") + " photo",
            style: "max-height:320px;width:auto;border-radius:8px;border:1px solid var(--pf-line,#e4dcce);",
          })
        )
      );
    }
    container.append(h("header", {}, headerBits));

    container.append(scalingControl());
    const panel = warnPanel(scaled);
    if (panel) container.append(panel);

    container.append(h("h2", { class: "section-heading" }, "Ingredients"));
    const ingList = h("ul", { class: "ingredient-list ingredients" });
    for (const line of Array.isArray(scaled.ingredients) ? scaled.ingredients : []) {
      ingList.append(ingredientRow(line, unitsSystem));
    }
    container.append(ingList);

    container.append(h("h2", { class: "section-heading" }, "Method"));
    const stepsOl = h("ol", { class: "steps" });
    for (const step of Array.isArray(scaled.steps) ? scaled.steps : []) {
      const flags = Array.isArray(step.flags) ? step.flags.filter((f) => f && f.type === "time") : [];
      const li = h("li", {}, h("span", { html: stepHtml(step && step.text) }));
      if (flags.length) {
        li.classList.add("has-time-flag");
        li.setAttribute("title", flags.map((f) => f.snippet).join(" \u00B7 "));
        li.append(h("span", { class: "prep" }, " \u2014 cooking time unchanged"));
      }
      stepsOl.append(li);
    }
    container.append(stepsOl);

    const notes = notesSection();
    if (notes) container.append(notes);

    container.append(actionsRow());
  }

  render();

  return function cleanup() {
    clearTimeout(deleteTimer);
    document.removeEventListener("keydown", onKeydown);
    window.removeEventListener("afterprint", afterPrint);
    document.body.classList.remove("print-recipe");
  };
}
