// scaling.mjs — exact, fraction-preserving recipe scaling.
//
// Pan-size / tin-size category: deliberately NOT implemented. There is no
// reliable signal in a single ingredient line ("tin size" / "pan" items are
// not real ingredients), and yield.text formats vary too widely to guess.
// Pan geometry advice belongs to a human note, not a silent heuristic.

import {
  makeFraction,
  fromDecimalString,
  mul,
  eq,
  add,
  ONE,
} from "./fraction.mjs";
import { normalizeIngredientName } from "./names.mjs";
import { formatScalar } from "./format.mjs";

export function scaleFraction(frac, factor) {
  return mul(frac, factor);
}

export function scaleIngredientLine(line, factor) {
  if (!line) return line;
  const out = { ...line };
  out.quantity = line.quantity == null ? null : mul(line.quantity, factor);
  out.quantityMax =
    line.quantityMax == null ? null : mul(line.quantityMax, factor);
  return out;
}

const GUIDANCE = {
  leavening: "leavening does not scale linearly — adjust and watch the rise",
  salt: "season to taste after scaling",
  spice: "heat and spice do not scale linearly",
  alcohol: "reduction strength changes with volume",
};

const LEAVENING_RE =
  /baking powder|baking soda|bicarbonate|yeast|sourdough starter|sourdough/;
const SALT_RE = /\bsalt\b/;
const SPICE_OTHER_RE =
  /cayenne|chill?i(?:es)?|chiles?|\bpaprika\b|\bcumin\b|\bcinnamon\b|\bcurry\b|\bspices?\b/;
const PEPPER_RE = /\bpeppers?\b/;
const PEPPER_VEGETABLE_RE = /bell peppers?|capsicum|sweet peppers?/;
const ALCOHOL_RE =
  /\bwines?\b|\bbeers?\b|\brums?\b|\bbrandys?\b|whisk(?:e)y|\bsherrys?\b|vinegar/;

function matchCategory(hay) {
  if (LEAVENING_RE.test(hay)) return "leavening";
  if (SALT_RE.test(hay)) return "salt";
  if (SPICE_OTHER_RE.test(hay)) return "spice";
  if (PEPPER_RE.test(hay) && !PEPPER_VEGETABLE_RE.test(hay)) return "spice";
  if (ALCOHOL_RE.test(hay)) return "alcohol";
  return null;
}

export function classifyNonLinear(line) {
  if (!line) return null;
  const item = typeof line.item === "string" ? line.item : "";
  const raw = typeof line.raw === "string" ? line.raw : "";
  const primary =
    (normalizeIngredientName(item) || "") + " \u0001 " + item.toLowerCase();
  let category = matchCategory(primary);
  if (!category && raw) category = matchCategory(raw.toLowerCase());
  return category
    ? { category, guidance: GUIDANCE[category] }
    : null;
}

const GLYPHS = "\u00BC\u00BD\u00BE\u2150\u2151\u2152\u2153\u2154\u2155\u2156\u2157\u2158\u2159\u215A\u215B\u215C\u215D\u215E";
const GLYPH_CLASS = "[" + GLYPHS + "]";

const GLYPH_VALUES = {
  "\u00BC": makeFraction(1, 4),
  "\u00BD": makeFraction(1, 2),
  "\u00BE": makeFraction(3, 4),
  "\u2150": makeFraction(1, 7),
  "\u2151": makeFraction(1, 9),
  "\u2152": makeFraction(1, 10),
  "\u2153": makeFraction(1, 3),
  "\u2154": makeFraction(2, 3),
  "\u2155": makeFraction(1, 5),
  "\u2156": makeFraction(2, 5),
  "\u2157": makeFraction(3, 5),
  "\u2158": makeFraction(4, 5),
  "\u2159": makeFraction(1, 6),
  "\u215A": makeFraction(5, 6),
  "\u215B": makeFraction(1, 8),
  "\u215C": makeFraction(3, 8),
  "\u215D": makeFraction(5, 8),
  "\u215E": makeFraction(7, 8),
};

const NUM_SRC =
  "\\d+\\s+\\d+/\\d+" +
  "|\\d+\\s*" + GLYPH_CLASS +
  "|" + GLYPH_CLASS +
  "|\\d+/\\d+" +
  "|\\d+\u2044\\d+" +
  "|\\d+\\.\\d+" +
  "|\\d+";

const MASTER = new RegExp(NUM_SRC, "g");

const MIXED_UNICODE_RE = new RegExp("^(\\d+)\\s*([" + GLYPHS + "])$");

export function numberTokenToFraction(token) {
  const t = String(token).trim();
  let m = MIXED_UNICODE_RE.exec(t);
  if (m) return add(makeFraction(Number(m[1])), GLYPH_VALUES[m[2]]);
  if (Object.prototype.hasOwnProperty.call(GLYPH_VALUES, t)) {
    return { ...GLYPH_VALUES[t] };
  }
  m = /^(\d+)\s+(\d+)\/(\d+)$/.exec(t);
  if (m) {
    return makeFraction(
      Number(m[1]) * Number(m[3]) + Number(m[2]),
      Number(m[3]),
    );
  }
  m = /^(\d+)\u2044(\d+)$/.exec(t) || /^(\d+)\/(\d+)$/.exec(t);
  if (m) return makeFraction(Number(m[1]), Number(m[2]));
  if (/^\d+\.\d+$/.test(t)) return fromDecimalString(t);
  return makeFraction(Number(t));
}

const TEMP_AFTER_RE =
  /^\s*(?:\u00B0\s*[CF]\b|deg(?:rees?)?\s+(?:C|F|celsius|fahrenheit)\b|celsius\b|fahrenheit\b)/i;
const GAS_MARK_BEFORE_RE = /\bgas\s+marks?\s*$/i;
const SERVES_BEFORE_RE = /\b(?:serves?|servings?|makes?)\s*$/i;
const ORDINAL_AFTER_RE = /^(?:st|nd|rd|th)\b/i;
const LIST_MARKER_BEFORE_RE = /(^|\n)[ \t]*$/;
const YEAR_UNIT_WHITELIST_RE =
  /^(?:cups?|tbsps?|tsps?|tablespoons?|teaspoons?|grams?|g|kgs?|kg|kilograms?|ml|millilitres?|milliliters?|l|litres?|liters?|floz|fluid ounces|oz|ounces?|lbs?|pounds?|cloves?|slices?|sprigs?|leaves|sticks?|pinches|pinchs?|dashes|handfuls|packets?|cans?|bunches|heads?|fillets?|rashers?|each|portions?|servings?|batches|tins?|trays?|sheets?|layers?|hours?|hrs?|minutes?|mins?|seconds?|secs?|days?|degrees?|x)/i;
const DURATION_AFTER_RE =
  /^\s*(?:hours?|hrs?|minutes?|mins?|seconds?|secs?|days?)\b/i;
const RANGE_SEP_RE = /^[ \t]*(?:\u2013|\u2014|-|to)[ \t]*$/i;
const TO_SEP_RE = /^[ \t]*to[ \t]*$/i;
const WORD_DURATION_RE = /\b(?:half\s+an\s+hour|an\s+hour)\b/gi;

function classifyNumberMatch(token, src, start, end) {
  const after = src.slice(end);
  const before = src.slice(0, start);
  if (TEMP_AFTER_RE.test(after)) return "temp";
  if (GAS_MARK_BEFORE_RE.test(before)) return "temp";
  if (SERVES_BEFORE_RE.test(before)) return "serving";
  if (ORDINAL_AFTER_RE.test(after)) return "ordinal";
  if (/^\s*\./.test(after) && LIST_MARKER_BEFORE_RE.test(before)) {
    return "ordinal";
  }
  if (/^\d+$/.test(token)) {
    const v = Number(token);
    if (v >= 1500 && v <= 2100) {
      const nextWord = /^\s*(\u00B0?[A-Za-z]+)/.exec(after);
      if (!nextWord || !YEAR_UNIT_WHITELIST_RE.test(nextWord[1])) {
        return "year";
      }
    }
  }
  if (DURATION_AFTER_RE.test(after)) return "duration";
  return "qty";
}

function sentenceAround(src, start, end) {
  const head = src.slice(0, start);
  const lIdx = Math.max(
    head.lastIndexOf(". "),
    head.lastIndexOf("! "),
    head.lastIndexOf("? "),
    head.lastIndexOf("\n"),
  );
  const left = lIdx === -1 ? 0 : lIdx + 1;
  const rest = src.slice(end);
  const rM = /[.!?](?:\s|$)|\n/.exec(rest);
  const right = rM ? end + rM.index + 1 : src.length;
  return src.slice(left, right).trim();
}

export function scaleStepText(text, factor) {
  const src = text == null ? "" : String(text);
  const flags = [];
  const durationSpans = [];

  let out = "";
  let cursor = 0;
  let pending = null;

  MASTER.lastIndex = 0;
  let m;
  while ((m = MASTER.exec(src)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    const kind = classifyNumberMatch(m[0], src, start, end);
    const gap = src.slice(cursor, start);

    if (kind !== "qty") {
      if (pending) {
        out += pending.text;
        pending = null;
      }
      out += gap + m[0];
      cursor = end;
      if (kind === "duration") {
        const unitMatch =
          /^\s*(?:hours?|hrs?|minutes?|mins?|seconds?|secs?|days?)\b/i.exec(
            src.slice(end),
          );
        durationSpans.push([start, end + unitMatch[0].length]);
      }
      continue;
    }

    const scaled = formatScalar(
      mul(numberTokenToFraction(m[0]), factor),
      16,
    ).text;
    if (pending && RANGE_SEP_RE.test(gap)) {
      const joiner = TO_SEP_RE.test(gap) ? " to " : "\u2013";
      pending.text = pending.text + joiner + scaled;
    } else {
      if (pending) {
        out += pending.text;
        pending = null;
      }
      out += gap;
      pending = { text: scaled };
    }
    cursor = end;
  }
  if (pending) out += pending.text;
  out += src.slice(cursor);

  WORD_DURATION_RE.lastIndex = 0;
  let w;
  while ((w = WORD_DURATION_RE.exec(src)) !== null) {
    durationSpans.push([w.index, w.index + w[0].length]);
  }

  // Compound durations ("1 hour 15 minutes") are one mention; merge spans
  // separated by nothing but whitespace or "and".
  durationSpans.sort((a, b) => a[0] - b[0]);
  const groups = [];
  for (const span of durationSpans) {
    const prev = groups[groups.length - 1];
    if (prev && /^\s*(?:and\s+)?$/i.test(src.slice(prev[1], span[0]))) {
      prev[1] = span[1];
    } else {
      groups.push([...span]);
    }
  }
  for (const [start, end] of groups) {
    flags.push({ type: "time", snippet: sentenceAround(src, start, end) });
  }

  return { text: out, flags };
}

const UNIT_SECONDS = {
  hour: 3600,
  hours: 3600,
  hr: 3600,
  hrs: 3600,
  minute: 60,
  minutes: 60,
  min: 60,
  mins: 60,
  second: 1,
  seconds: 1,
  sec: 1,
  secs: 1,
  day: 86400,
  days: 86400,
};

const DUR_UNIT_SRC = "hours?|hrs?|minutes?|mins?|seconds?|secs?|days?";
const DUR_SINGLE = new RegExp(
  "(" + NUM_SRC + ")\\s*(" + DUR_UNIT_SRC + ")\\b",
  "gi",
);
const DUR_RANGE = new RegExp(
  "(" +
    NUM_SRC +
    ")\\s*(?:[\u2013\u2014-]|\\bto\\b)\\s*(" +
    NUM_SRC +
    ")\\s*(" +
    DUR_UNIT_SRC +
    ")\\b",
  "gi",
);

function durationSeconds(numToken, unitWord) {
  const f = numberTokenToFraction(numToken);
  const unit = UNIT_SECONDS[String(unitWord).toLowerCase()];
  return unit == null ? null : Math.round((f.n * unit) / f.d);
}

export function parseStepTimers(text) {
  if (text == null) return [];
  const src = String(text);
  const found = [];
  const taken = [];
  const isTaken = (start, end) =>
    taken.some(([a, b]) => start < b && a < end);

  let m;
  DUR_RANGE.lastIndex = 0;
  while ((m = DUR_RANGE.exec(src)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    taken.push([start, end]);
    const seconds = durationSeconds(m[1], m[3]);
    if (seconds != null) {
      found.push({
        start,
        label: m[0].replace(/\s+/g, " ").trim(),
        seconds,
      });
    }
  }

  const singles = [];
  DUR_SINGLE.lastIndex = 0;
  while ((m = DUR_SINGLE.exec(src)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    if (isTaken(start, end)) continue;
    const seconds = durationSeconds(m[1], m[2]);
    if (seconds != null) {
      singles.push({ start, end, seconds });
    }
  }

  const merged = [];
  for (const entry of singles) {
    const prev = merged[merged.length - 1];
    if (prev && /^\s*(?:and\s+)?$/i.test(src.slice(prev.end, entry.start))) {
      prev.end = entry.end;
      prev.seconds += entry.seconds;
    } else {
      merged.push({ ...entry });
    }
  }
  for (const entry of merged) {
    found.push({
      start: entry.start,
      label: src.slice(entry.start, entry.end).replace(/\s+/g, " ").trim(),
      seconds: entry.seconds,
    });
  }

  WORD_DURATION_RE.lastIndex = 0;
  while ((m = WORD_DURATION_RE.exec(src)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    if (isTaken(start, end)) continue;
    taken.push([start, end]);
    found.push({
      start,
      label: m[0].replace(/\s+/g, " ").trim(),
      seconds: /^half/i.test(m[0]) ? 1800 : 3600,
    });
  }

  found.sort((a, b) => a.start - b.start);
  return found.map(({ label, seconds }) => ({ label, seconds }));
}

function scaledWholeCount(serves, factor) {
  if (serves == null) return null;
  const f = mul(makeFraction(serves), factor);
  const sign = f.n < 0 ? -1 : 1;
  const an = Math.abs(f.n);
  return sign * Math.floor((2 * an + f.d) / (2 * f.d));
}

export function scaleRecipe(recipe, factor) {
  if (!recipe) throw new Error("recipe required");
  const identity = eq(factor, ONE);
  const out = structuredClone(recipe);
  const sourceLines = Array.isArray(recipe.ingredients)
    ? recipe.ingredients
    : [];

  out.ingredients = sourceLines.map((line) => scaleIngredientLine(line, factor));

  if (identity) return out;

  const warnings = [];
  for (const line of sourceLines) {
    const nonLinear = classifyNonLinear(line);
    if (nonLinear) {
      warnings.push({
        lineId: line.id,
        item: line.item,
        category: nonLinear.category,
        guidance: nonLinear.guidance,
      });
    }
  }
  out.warnings = warnings;

  out.yield = {
    ...(out.yield || {}),
    serves: scaledWholeCount(out.yield && out.yield.serves, factor),
  };

  out.steps = (Array.isArray(recipe.steps) ? recipe.steps : []).map((step) => {
    const result = scaleStepText(step && step.text, factor);
    return { ...structuredClone(step), text: result.text, flags: result.flags };
  });

  return out;
}
