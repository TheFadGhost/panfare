// src/styles/tokens.mjs — Panfare design-token single source of truth.
//
// Themes are pure token overrides keyed by ROLE name; components reference
// roles only (see DESIGN.md "Colour"). The same module feeds both the CSS
// custom-property injection (applyTheme) and the automated WCAG-ratio tests
// in tests/tokens.test.mjs — themes that fail contrast cannot ship.
//
// ---------------------------------------------------------------------------
// FLOAT ARITHMETIC NOTE — the one sanctioned place floats appear here:
// contrastRatio() implements the WCAG 2.x relative-luminance formula, whose
// definition requires real-valued sRGB linearisation
//   c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ^ 2.4
// on normalised 8-bit channels. Display-referred colour science is
// inherently continuous; the standard itself specifies these curves.
//
// This is NOT licence for floats elsewhere: recipe quantities — scaling,
// fractions, unit conversion, list merging — must stay in exact rational
// arithmetic (src/core/fraction.mjs) because 0.1 + 0.2 cups is a lie a cook
// can taste. Colour math approximates pixels; recipe math must be true.
// ---------------------------------------------------------------------------

export const THEME_NAMES = ["light", "dark", "contrast"];

/** Colour roles present in every theme. Exactly these keys. */
export const ROLE_KEYS = [
  "paper",
  "surface",
  "ink",
  "inkMuted",
  "accent",
  "onAccent",
  "line",
  "warnBg",
  "warnText",
  "ok",
  "danger",
  "focusRing",
];

/**
 * Non-colour tokens shared per theme. fontSizeStep is the cook-mode step
 * size; minTouchTargetCook is the 56px cook-mode floor vs the standard 48px.
 */
const METRICS_STANDARD = {
  fontSizeBody: "17px",
  fontSizeStep: "30px",
  minTouchTarget: "48px",
  minTouchTargetCook: "56px",
};

const METRICS_COOK = {
  ...METRICS_STANDARD,
  fontSizeBody: "24px",
};

function theme(colours, metrics = METRICS_STANDARD) {
  // focusRing mirrors accent: DESIGN.md specifies focus as "2px accent
  // outline". It is listed as its own role so themes could diverge later
  // without touching consumers.
  return { ...colours, focusRing: colours.accent, ...metrics };
}

export const THEMES = {
  light: theme({
    paper: "#FAF6EF",
    surface: "#FFFFFF",
    ink: "#26221C",
    inkMuted: "#5D564A",
    accent: "#A64B22",
    onAccent: "#FFFFFF",
    line: "#E4DCCE",
    warnBg: "#F6EBD4",
    warnText: "#6B4A12",
    ok: "#3E6B4F",
    danger: "#A03123",
  }),
  dark: theme({
    paper: "#1B1815",
    surface: "#25211D",
    ink: "#F1EBE1",
    inkMuted: "#B4AA99",
    accent: "#E8946A",
    onAccent: "#1B1815",
    line: "#3B352E",
    warnBg: "#3A2F1B",
    warnText: "#EFC983",
    ok: "#7FB894",
    danger: "#E77A67",
  }),
  // High-contrast cook mode ("contrast"). Cook mode forces this set
  // regardless of active theme; body size steps up to 24px.
  contrast: theme(
    {
      paper: "#12100D",
      surface: "#1A1713",
      ink: "#FFF8EC",
      inkMuted: "#D8CFBE",
      accent: "#FFB65C",
      onAccent: "#12100D",
      line: "#4A4238",
      warnBg: "#40331A",
      warnText: "#FFD98A",
      ok: "#8FE0AC",
      danger: "#FF9E8A",
    },
    METRICS_COOK,
  ),
};

/** camelCase token key -> kebab-case CSS custom property (--pf-…). */
export function cssVarName(key) {
  return "--pf-" + key.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
}

/** Parse #rgb / #rrggbb to [r, g, b] as 0–255 integers. Throws otherwise. */
export function hexToRgb(hex) {
  let h = String(hex).trim().replace(/^#/, "");
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  if (!/^[0-9a-f]{6}$/i.test(h)) throw new Error(`Not a hex colour: ${hex}`);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

/** sRGB channel -> linear value. Floats: see note at top of file. */
function linearise(channel8) {
  const s = channel8 / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** WCAG 2.x relative luminance of a hex colour. */
export function relativeLuminance(hex) {
  const [r, g, b] = hexToRgb(hex).map(linearise);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * WCAG 2.x contrast ratio between two hex colours, from 1 (identical)
 * to 21 (black on white). Order-independent.
 */
export function contrastRatio(hex1, hex2) {
  const l1 = relativeLuminance(hex1);
  const l2 = relativeLuminance(hex2);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Apply a named theme by setting --pf-* custom properties on the root
 * element plus the data-theme attribute. Unknown names fall back to
 * "light". Returns the resolved theme name.
 *
 * @param {string} name one of THEME_NAMES (or anything falsy/unknown)
 * @param {{root?: Document}} [options]
 */
export function applyTheme(name, { root = document } = {}) {
  const resolved = THEME_NAMES.includes(name) ? name : "light";
  const tokens = THEMES[resolved];
  for (const [key, value] of Object.entries(tokens)) {
    root.documentElement.style.setProperty(cssVarName(key), value);
  }
  root.documentElement.setAttribute("data-theme", resolved);
  return resolved;
}

/**
 * System-preferred theme: high user contrast preference selects the
 * high-contrast cook set; otherwise the warm light default. Safe outside
 * a browser (returns "light").
 */
export function preferredTheme() {
  if (typeof matchMedia !== "function") return "light";
  try {
    return matchMedia("(prefers-contrast: more)").matches ? "contrast" : "light";
  } catch {
    return "light";
  }
}
