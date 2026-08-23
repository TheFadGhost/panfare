// format.mjs — human rendering of quantities. The single place where
// Fractions become visible text. Never produces bare decimals like "0.333";
// prefers vulgar glyphs, then styled stacked fractions, with honest
// approximation markers when display must round.

import {
  makeFraction,
  floorFrac,
  eq,
  cmp,
  mul,
  div,
} from "./fraction.mjs";
import {
  getUnit,
  convert,
  DIMENSION,
} from "./units.mjs";

const VULGAR = {
  "1/2": "\u00BD",
  "1/3": "\u2153",
  "2/3": "\u2154",
  "1/4": "\u00BC",
  "3/4": "\u00BE",
  "1/5": "\u2155",
  "2/5": "\u2156",
  "3/5": "\u2157",
  "4/5": "\u2158",
  "1/6": "\u2159",
  "5/6": "\u215A",
  "1/8": "\u215B",
  "3/8": "\u215C",
  "5/8": "\u215D",
  "7/8": "\u215E",
};

const SMALL_WORDS = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight",
  "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen",
  "sixteen", "seventeen", "eighteen", "nineteen", "twenty",
];
const ORDINAL_DENOMS = {
  2: ["half", "halves"],
  3: ["third", "thirds"],
  4: ["quarter", "quarters"],
  5: ["fifth", "fifths"],
  6: ["sixth", "sixths"],
  7: ["seventh", "sevenths"],
  8: ["eighth", "eighths"],
  10: ["tenth", "tenths"],
  16: ["sixteenth", "sixteenths"],
};

// Display ladders per family: [unitId, promoteWhenAmountReaches].
// The threshold is expressed in the CURRENT unit and means "promote to the
// next unit once the amount is at least this many of it". Promotion keeps
// human-friendly results ("3 tsp -> 1 tbsp") without ever crossing between
// systems implicitly.
const LADDERS = {
  // Cups carry all the way to a gallon: intermediate pints/quarts produce
  // awkward amounts ("1⅛ pints"); they remain valid input units and convert
  // exactly into cups on display.
  imperialVolume: [
    ["tsp", 3], ["tbsp", 4], ["floz", 4], ["cup", 16], ["gallon", Infinity],
  ],
  metricVolume: [
    ["ml", 1000], ["l", Infinity],
  ],
  imperialMass: [
    ["oz", 16], ["lb", Infinity],
  ],
  metricMass: [
    ["mg", 1000], ["g", 1000], ["kg", Infinity],
  ],
};

function ladderFor(unitId) {
  switch (unitId) {
    case "tsp": case "tbsp": case "floz":
    case "cup": case "pint": case "quart": case "gallon":
      return LADDERS.imperialVolume;
    case "ml": case "l":
      return LADDERS.metricVolume;
    case "oz": case "lb":
      return LADDERS.imperialMass;
    case "mg": case "g": case "kg":
      return LADDERS.metricMass;
    default:
      return null;
  }
}

export function vulgarGlyph(frac) {
  const key = frac.n + "/" + frac.d;
  return VULGAR[key] || null;
}

function wantsPlural(unitId) {
  const unit = getUnit(unitId);
  if (!unit || !unit.label) return false;
  if (unit.dim === DIMENSION.COUNT) return unit.id !== "each";
  // metric symbols never pluralise; tsp/tbsp/floz stay invariant
  return unit.system === "imperial" &&
    (unit.id === "cup" || unit.id === "pint" || unit.id === "quart" || unit.id === "gallon");
}

function pluralizeLabel(unitId) {
  const label = getUnit(unitId).label;
  if (/z$|s$|x$|ch$|sh$/.test(label)) return label + "es";
  return label + "s";
}

// Spoken form of a pure number: "three quarters", "one and a half".
export function spokenFraction(frac) {
  const abs = { n: Math.abs(frac.n), d: frac.d };
  const { whole, rest } = floorFrac(abs);
  const parts = [];
  if (whole > 0 || rest.n === 0) {
    parts.push(whole <= SMALL_WORDS.length - 1 ? SMALL_WORDS[whole] : String(whole));
  }
  if (rest.n !== 0) {
    const denWords = ORDINAL_DENOMS[rest.d] || [rest.d + "th", rest.d + "ths"];
    const numWord = rest.n === 1 ? "one" : SMALL_WORDS[rest.n] || String(rest.n);
    parts.push(numWord + " " + (rest.n === 1 ? denWords[0] : denWords[1]));
  }
  return parts.length === 0 ? "zero" : parts.join(" and ");
}

/**
 * Render a Fraction for display.
 * Returns { text, html, aria }.
 * text uses unicode glyphs where clean, otherwise U+2044 ("13⁄16");
 * html may wrap uncommon fractions in sup/sub markup.
 */
export function formatFraction(frac, { approximate = false } = {}) {
  const sign = frac.n < 0 ? "-" : "";
  const abs = { n: Math.abs(frac.n), d: frac.d };
  const prefix = approximate ? "\u2248 " : "";
  const { whole, rest } = floorFrac(abs);
  let textWhole = "";
  let htmlWhole = "";
  let ariaWhole = "";
  if (whole > 0 || rest.n === 0) {
    textWhole = String(whole);
    htmlWhole = String(whole);
    ariaWhole = whole <= SMALL_WORDS.length - 1 ? SMALL_WORDS[whole] : String(whole);
  }
  let textFrac = "";
  let htmlFrac = "";
  let ariaFrac = "";
  if (rest.n !== 0) {
    const glyph = vulgarGlyph(rest);
    if (glyph) {
      textFrac = glyph;
      htmlFrac = glyph;
    } else {
      textFrac = rest.n + "\u2044" + rest.d;
      htmlFrac =
        '<span class="frac"><sup>' +
        rest.n +
        "</sup>\u2044<sub>" +
        rest.d +
        "</sub></span>";
    }
    ariaFrac = spokenFraction(rest);
  }
  const text = prefix + sign + textWhole + textFrac;
  const html = prefix + sign + htmlWhole + htmlFrac;
  const aria =
    ariaWhole && ariaFrac
      ? ariaWhole + " and " + ariaFrac
      : ariaWhole || ariaFrac || "zero";
  return { text, html, aria };
}

/**
 * Choose the friendliest display unit inside one dimension using exact
 * conversions only. system ("metric"|"imperial"|null): null keeps the
 * origin unit's own family ladder.
 * -> { unitId, amount }
 */
export function pickDisplayUnit(amount, unitId, { system = null } = {}) {
  const unit = getUnit(unitId);
  if (!unit) throw new Error("unknown unit id: " + unitId);
  if (unit.dim === DIMENSION.COUNT) return { unitId: unit.id, amount };

  const ladder = ladderFor(unit.id);
  if (!ladder) return { unitId: unit.id, amount };
  const originFamilyIsMetric =
    ladder === LADDERS.metricVolume || ladder === LADDERS.metricMass;

  // Bridge families only when explicitly asked.
  let entries = ladder;
  let value = amount;
  if (system === "metric" && !originFamilyIsMetric) {
    value = convert(value, unitId, unit.dim === DIMENSION.VOLUME ? "ml" : "g");
    entries = unit.dim === DIMENSION.VOLUME ? LADDERS.metricVolume : LADDERS.metricMass;
  } else if (system === "imperial" && originFamilyIsMetric) {
    value = convert(value, unitId, unit.dim === DIMENSION.VOLUME ? "tsp" : "oz");
    entries = unit.dim === DIMENSION.VOLUME ? LADDERS.imperialVolume : LADDERS.imperialMass;
  }

  let idx = entries.findIndex(([id]) => id === unitId);
  if (idx === -1) {
    // Amount was bridged into the target family's base entry.
    const base =
      entries === LADDERS.imperialVolume ? "tsp"
      : entries === LADDERS.metricVolume ? "ml"
      : entries === LADDERS.imperialMass ? "oz"
      : "g";
    idx = entries.findIndex(([id]) => id === base);
  } else {
    value = convert(value, unitId, entries[idx][0]);
  }
  let guard = 0;
  while (guard++ < 12) {
    const nextEntry = entries[idx + 1];
    if (!nextEntry) break;
    const [, threshold] = entries[idx];
    if (!Number.isFinite(threshold)) break;
    // threshold is expressed in the current unit ("3 tsp", "16 tbsp")
    const promoteAt = makeFraction(threshold);
    if (cmp(value, promoteAt) >= 0) {
      value = convert(value, entries[idx][0], nextEntry[0]);
      idx += 1;
    } else {
      break;
    }
  }
  return { unitId: entries[idx][0], amount: value };
}

/**
 * Kitchen-precision rounding for metric base units (ml, g):
 * <10 -> nearest half, <100 -> nearest whole, >=100 -> nearest 5.
 * -> { value, approx }
 */
export function roundMetricBase(amount) {
  if (amount.d === 1) return { value: amount, approx: false };
  // Kitchen precision by magnitude: halves below 10, whole grams/ml up to
  // 100, nearest multiple of 5 above.
  let step;
  if (cmp(amount, makeFraction(10)) < 0) step = makeFraction(1, 2);
  else if (cmp(amount, makeFraction(100)) < 0) step = makeFraction(1);
  else step = makeFraction(5);
  const steps = div(amount, step); // how many whole steps fit
  const k = Math.max(0, Math.round(steps.n / steps.d));
  const rounded = k === 0 ? makeFraction(0) : mul(step, makeFraction(k));
  const exactInt = eq(rounded, amount);
  let approx = false;
  if (!exactInt) {
    // relative error = |rounded - amount| / amount <= 2% ?
    const diffN = Math.abs(amount.n * rounded.d - rounded.n * amount.d);
    const diffD = amount.d * rounded.d;
    if (!(50 * diffN * amount.d <= diffD * amount.n)) approx = true;
  }
  return { value: rounded, approx };
}

/**
 * Format a full quantity { amount, unit } for display.
 * options: { system?: "metric"|"imperial"|null, maxDen?: number (default 8),
 *            approximateMetric?: boolean (default true) }
 * Returns { text, html, aria, unitId, approx }
 */
export function formatQuantity(quantity, options = {}) {
  if (!quantity || typeof quantity !== "object") throw new Error("quantity object required");
  const amount = quantity.amount;
  if (!amount || typeof amount.n !== "number" || typeof amount.d !== "number") {
    throw new Error("quantity.amount must be a Fraction");
  }
  const unit = quantity.unit || null;
  const maxDen = options.maxDen ?? 8;

  let unitId = unit;
  let value = amount;
  let approx = false;
  if (unitId) {
    const picked = pickDisplayUnit(value, unitId, { system: options.system ?? null });
    unitId = picked.unitId;
    value = picked.amount;
    const u = getUnit(unitId);
    if ((unitId === "ml" || unitId === "g") && options.approximateMetric !== false) {
      const r = roundMetricBase(value);
      value = r.value;
      approx = r.approx;
    }
  }

  const rendered = renderAmount(value, maxDen);
  const unitText = unitId ? renderUnitText(unitId, value) : "";
  const sep = unitText ? " " : "";
  const isApprox = approx || rendered.approx;
  return {
    text: (isApprox ? "\u2248 " : "") + rendered.bodyText + sep + unitText,
    html: (isApprox ? "\u2248 " : "") + rendered.bodyHtml + sep + escapeHtml(unitText),
    aria: (isApprox ? "approximately " : "") + rendered.aria + (unitText ? " " + unitText : ""),
    unitId,
    approx: isApprox,
  };
}

/** Format a scalar (no unit) for embedding inside step text. */
export function formatScalar(amount, maxDen = 8) {
  const r = renderAmount(amount, maxDen);
  const marker = r.approx ? "\u2248 " : "";
  return { text: marker + r.bodyText, html: marker + r.bodyHtml, aria: r.aria, approx: r.approx };
}

/**
 * Range formatting for two quantity objects of compatible shape.
 * Returns { text, html, aria, approx }.
 */
export function formatQuantityRange(minQ, maxQ, options = {}) {
  const minF = formatQuantity(minQ, options);
  const maxF = formatQuantity(maxQ, options);
  const strip = (s) => s.replace(/^\u2248 /, "");
  const dash = "\u2013";
  return {
    text: minF.text + dash + strip(maxF.text),
    html: minF.html + dash + strip(maxF.html),
    aria: minF.aria + " to " + maxF.aria,
    approx: minF.approx || maxF.approx,
  };
}

// ---- internals -------------------------------------------------------------

function renderUnitText(unitId, value) {
  // English convention: fractions below one take the singular
  // ("½ cup", "¾ pound"); amounts above one pluralise.
  const plural = cmp(value, makeFraction(1)) > 0 && wantsPlural(unitId);
  if (plural) return pluralizeLabel(unitId);
  return getUnit(unitId).label;
}

function renderAmount(value, maxDen) {
  if (value.d === 1) {
    const n = value.n;
    const aria = n >= 0 && n <= SMALL_WORDS.length - 1
      ? SMALL_WORDS[n]
      : spokenLarge(n);
    return { bodyText: String(n), bodyHtml: String(n), aria, approx: false };
  }
  if (value.n > 0 && value.n < value.d && vulgarGlyph(value)) {
    return {
      bodyText: vulgarGlyph(value),
      bodyHtml: vulgarGlyph(value),
      aria: spokenFraction(value),
      approx: false,
    };
  }
  // Nearest friendly fraction with denominator <= maxDen.
  // Diff between value and candidate = errN / (value.d * cand.d);
  // candidates compare on that ratio via cross-multiplication.
  let best = null;
  for (let den = 1; den <= Math.min(maxDen, 16); den++) {
    let num = Math.round((value.n * den) / value.d);
    if (num < 0) num = 0;
    const cand = makeFraction(num, den);
    // |value - cand| as a fraction: |vN*cD - cN*vD| / (vD*cD)
    const errN = Math.abs(value.n * cand.d - cand.n * value.d);
    if (!best || errN * best.errD < best.errN * (value.d * cand.d)) {
      best = { value: cand, errN, errD: value.d * cand.d };
    }
    if (errN === 0) break;
  }
  const exact = best.errN === 0;
  // Relative error <= 2% renders unmarked; anything looser gets "≈".
  // rel = |vN/vD - cN/cD| / (vN/vD) = errN / (cand.d * vN)
  // rel <= 1/50  <=>  50*errN <= cand.d * vN
  const tinyError = !exact && 50 * best.errN <= best.value.d * value.n;
  const approx = !exact && !tinyError;
  const f = formatFraction(best.value);
  return { bodyText: f.text, bodyHtml: f.html, aria: f.aria, approx };
}

function spokenLarge(n) {
  const s = String(Math.abs(n));
  if (s.length <= 6) return n.toLocaleString("en-GB").replace(/,/g, " ");
  return s.split("").join(" ");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}
