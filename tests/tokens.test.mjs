// tests/tokens.test.mjs — WCAG-ratio gate for the Panfare token layer.
//
// The UI loads its colours from src/styles/tokens.mjs; these tests compute
// ratios from that same source, so a theme that fails AA cannot ship
// (DESIGN.md "Colour" rules). Floats appear only inside contrastRatio's
// display-colour math — see the note at the top of tokens.mjs.

import { describe, it, expect, afterEach } from "vitest";
import {
  THEMES,
  THEME_NAMES,
  ROLE_KEYS,
  contrastRatio,
  applyTheme,
  preferredTheme,
} from "../src/styles/tokens.mjs";

const METRIC_KEYS = [
  "fontSizeBody",
  "fontSizeStep",
  "minTouchTarget",
  "minTouchTargetCook",
];

// [foreground role, background role, minimum ratio] — from DESIGN.md rules:
// AA (4.5:1) for all text including muted prep in EVERY theme; accent is
// large-text/UI usage at 3:1; hairlines must be visible (1.2); focus ring is
// a UI indicator (3:1).
const CONTRAST_REQUIREMENTS = [
  ["ink", "paper", 4.5],
  ["ink", "surface", 4.5],
  ["inkMuted", "paper", 4.5],
  ["inkMuted", "surface", 4.5],
  ["warnText", "warnBg", 4.5],
  ["onAccent", "accent", 4.5],
  ["danger", "surface", 4.5],
  ["accent", "paper", 3],
  ["ok", "surface", 3],
  ["focusRing", "paper", 3],
  ["line", "paper", 1.2],
];

describe("contrastRatio — WCAG math correctness", () => {
  it("black on white is exactly 21", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 10);
  });

  it("#777777 on #FFFFFF ≈ 4.48 within ±0.05", () => {
    const r = contrastRatio("#777777", "#FFFFFF");
    // Manual delta compare (expect.closeTo style with explicit tolerance).
    expect(Math.abs(r - 4.48)).toBeLessThanOrEqual(0.05);
  });

  it("is order-independent and self-ratio is 1", () => {
    const ab = contrastRatio("#26221C", "#FAF6EF");
    const ba = contrastRatio("#FAF6EF", "#26221C");
    expect(ab).toBeCloseTo(ba, 12);
    expect(contrastRatio("#A64B22", "#A64B22")).toBeCloseTo(1, 12);
  });

  it("accepts shorthand hex and rejects non-hex input", () => {
    expect(contrastRatio("#777", "#FFF")).toBeCloseTo(
      contrastRatio("#777777", "#FFFFFF"),
      12,
    );
    expect(() => contrastRatio("papayawhip", "#FFFFFF")).toThrow();
  });
});

describe("theme contrast gates — every theme, every required pair", () => {
  for (const themeName of THEME_NAMES) {
    describe(`theme: ${themeName}`, () => {
      for (const [fg, bg, min] of CONTRAST_REQUIREMENTS) {
        it(`${fg}/${bg} ≥ ${min}`, () => {
          const ratio = contrastRatio(THEMES[themeName][fg], THEMES[themeName][bg]);
          expect(
            ratio,
            `${themeName}: ${fg} ${THEMES[themeName][fg]} on ${bg} ${THEMES[themeName][bg]} = ${ratio.toFixed(2)} (< ${min})`,
          ).toBeGreaterThanOrEqual(min);
        });
      }
    });
  }
});

describe("applyTheme", () => {
  /** Fake document capturing setProperty/setAttribute calls — no DOM needed. */
  function makeFakeDoc() {
    const props = new Map();
    const attrs = new Map();
    return {
      documentElement: {
        style: {
          setProperty: (k, v) => props.set(k, v),
        },
        setAttribute: (k, v) => attrs.set(k, v),
      },
      props,
      attrs,
    };
  }

  it("sets every --pf-* property and data-theme for each known theme", () => {
    for (const themeName of THEME_NAMES) {
      const doc = makeFakeDoc();
      applyTheme(themeName, { root: doc });

      expect(doc.attrs.get("data-theme")).toBe(themeName);

      const expectedKeys = Object.keys(THEMES[themeName]);
      for (const key of expectedKeys) {
        const cssVar =
          "--pf-" + key.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
        expect(doc.props.get(cssVar), cssVar).toBe(THEMES[themeName][key]);
      }
      expect(doc.props.size).toBe(expectedKeys.length);
    }
  });

  it("covers colour roles AND font-size/touch-target tokens", () => {
    const doc = makeFakeDoc();
    applyTheme("contrast", { root: doc });
    for (const key of [...ROLE_KEYS, ...METRIC_KEYS]) {
      const cssVar =
        "--pf-" + key.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
      expect(doc.props.has(cssVar), cssVar).toBe(true);
    }
    expect(doc.props.get("--pf-font-size-body")).toBe("24px");
    expect(doc.props.get("--pf-font-size-step")).toBe("30px");
    expect(doc.props.get("--pf-min-touch-target-cook")).toBe("56px");
  });

  it("falls back to light for an unknown theme name", () => {
    const doc = makeFakeDoc();
    const resolved = applyTheme("sepia-dream", { root: doc });

    expect(resolved).toBe("light");
    expect(doc.attrs.get("data-theme")).toBe("light");
    // Applied light values, not the unknown name's absence or another theme.
    expect(doc.props.get("--pf-paper")).toBe(THEMES.light.paper);
    expect(doc.props.get("--pf-paper")).not.toBe(THEMES.contrast.paper);
  });

  it("returns the resolved theme name for known themes", () => {
    const doc = makeFakeDoc();
    expect(applyTheme("dark", { root: doc })).toBe("dark");
  });
});

describe("theme integrity", () => {
  it("token sets differ between themes", () => {
    const serialised = Object.fromEntries(
      THEME_NAMES.map((name) => [name, JSON.stringify(THEMES[name])]),
    );
    expect(serialised.light).not.toBe(serialised.dark);
    expect(serialised.light).not.toBe(serialised.contrast);
    expect(serialised.dark).not.toBe(serialised.contrast);
  });

  it("every theme has every role key, exactly, as hex", () => {
    for (const themeName of THEME_NAMES) {
      const keys = Object.keys(THEMES[themeName]);
      for (const role of ROLE_KEYS) {
        expect(keys, `${themeName} missing role "${role}"`).toContain(role);
        expect(THEMES[themeName][role], `${themeName}.${role}`).toMatch(
          /^#[0-9a-fA-F]{6}$/,
        );
      }
    }
  });

  it("every theme carries the non-colour metric tokens", () => {
    for (const themeName of THEME_NAMES) {
      for (const key of METRIC_KEYS) {
        expect(typeof THEMES[themeName][key], `${themeName}.${key}`).toBe("string");
      }
    }
    expect(THEMES.light.fontSizeBody).toBe("17px");
    expect(THEMES.dark.fontSizeBody).toBe("17px");
    expect(THEMES.contrast.fontSizeBody).toBe("24px");
    expect(THEMES.contrast.fontSizeStep).toBe("30px");
    expect(THEMES.light.minTouchTarget).toBe("48px");
    expect(THEMES.light.minTouchTargetCook).toBe("56px");
  });

  it("exposes exactly the three documented theme names", () => {
    expect([...THEME_NAMES].sort()).toEqual(["contrast", "dark", "light"]);
  });
});

describe("preferredTheme", () => {
  afterEach(() => {
    delete globalThis.matchMedia;
  });

  it('returns "contrast" when prefers-contrast: more matches', () => {
    globalThis.matchMedia = (query) => ({
      matches: query === "(prefers-contrast: more)",
    });
    expect(preferredTheme()).toBe("contrast");
  });

  it('returns "light" when the media query does not match', () => {
    globalThis.matchMedia = () => ({ matches: false });
    expect(preferredTheme()).toBe("light");
  });

  it('returns "light" when matchMedia is unavailable', () => {
    delete globalThis.matchMedia;
    expect(preferredTheme()).toBe("light");
  });
});
