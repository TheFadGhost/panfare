import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { makeFraction as F, div } from "../src/core/fraction.mjs";
import { scaleRecipe } from "../src/core/scaling.mjs";
import { buildShoppingList, SECTIONS_ORDER } from "../src/core/shoppingList.mjs";

const samples = JSON.parse(
  readFileSync(new URL("../data/sampleRecipes.json", import.meta.url), "utf8")
);

function isFracLike(v) {
  return (
    v !== null &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    Number.isInteger(v.n) &&
    Number.isInteger(v.d) &&
    v.d >= 1
  );
}

function isFractionShape(q) {
  return q === null || (isFracLike(q) && q.d <= 10000);
}

function isIso(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(s);
}

const NON_LINEAR_RE =
  /baking powder|bicarbonate|\bsalt\b|chill?i|cayenne|wine|paprika|cumin|black pepper|vinegar/;

function flaggedRecipes() {
  return samples.filter((r) =>
    r.ingredients.some(
      (line) => NON_LINEAR_RE.test(String(line.item)) || NON_LINEAR_RE.test(String(line.raw))
    )
  );
}

describe("sample dataset: basics", () => {
  it("contains exactly ten recipes", () => {
    expect(Array.isArray(samples)).toBe(true);
    expect(samples).toHaveLength(10);
  });

  it("has unique ids in the r_sampleNN namespace", () => {
    const ids = samples.map((r) => r.id);
    expect(new Set(ids).size).toBe(10);
    for (const id of ids) expect(id).toMatch(/^r_sample\d{2}$/);
  });

  it("includes exactly one text-only yield with serves null", () => {
    const textOnly = samples.filter((r) => r.yield.serves === null);
    expect(textOnly).toHaveLength(1);
    expect(textOnly[0].yield.text).toMatch(/makes \d+/);
    const served = samples.filter((r) => r.yield.serves !== null);
    for (const r of served) {
      expect(Number.isInteger(r.yield.serves)).toBe(true);
      expect(typeof r.yield.text).toBe("string");
      expect(r.yield.text.length).toBeGreaterThan(0);
    }
  });
});

describe("sample dataset: CONTRACT shape conformance", () => {
  for (const recipe of samples) {
    describe(recipe.id, () => {
      it("carries complete top-level metadata", () => {
        expect(typeof recipe.title).toBe("string");
        expect(recipe.title.length).toBeGreaterThan(0);
        expect(Number.isInteger(recipe.times.prep)).toBe(true);
        expect(Number.isInteger(recipe.times.cook)).toBe(true);
        expect(Array.isArray(recipe.times.extra)).toBe(true);
        expect(isIso(recipe.createdAt)).toBe(true);
        expect(recipe.updatedAt).toBe(recipe.createdAt);
        expect(recipe.rating).toBeNull();
        expect(recipe.history).toEqual([]);
        expect(recipe.photo).toBeNull();
        expect(recipe.source).toEqual({ url: null, title: null, author: null });
        expect(recipe.notes === null || typeof recipe.notes === "string").toBe(true);
      });

      it("keeps tags between two and four strings", () => {
        expect(Array.isArray(recipe.tags)).toBe(true);
        expect(recipe.tags.length).toBeGreaterThanOrEqual(2);
        expect(recipe.tags.length).toBeLessThanOrEqual(4);
        for (const tag of recipe.tags) expect(typeof tag).toBe("string");
      });

      it("has between 7 and 12 fully-shaped ingredient lines", () => {
        expect(recipe.ingredients.length).toBeGreaterThanOrEqual(7);
        expect(recipe.ingredients.length).toBeLessThanOrEqual(12);
        let n = 0;
        for (const line of recipe.ingredients) {
          n += 1;
          expect(line.id).toBe("i_" + String(n).padStart(3, "0"));
          expect(typeof line.raw).toBe("string");
          expect(typeof line.item).toBe("string");
          expect(line.raw.length).toBeGreaterThan(0);
          expect(line.item.length).toBeGreaterThan(0);
          expect(isFractionShape(line.quantity)).toBe(true);
          expect(isFractionShape(line.quantityMax)).toBe(true);
          if (isFracLike(line.quantity)) {
            expect(Number.isInteger(line.quantity.n)).toBe(true);
            expect(Number.isInteger(line.quantity.d)).toBe(true);
            expect(line.quantity.d).toBeGreaterThanOrEqual(1);
            expect(line.quantity.d).toBeLessThanOrEqual(10000);
          }
          if (line.unit !== null) {
            expect(typeof line.unit).toBe("string");
            expect(line.unit).toMatch(/^[a-z]+$/);
          }
          expect(
            line.preparation === null || typeof line.preparation === "string"
          ).toBe(true);
          expect(
            line.substitute === null || typeof line.substitute === "string"
          ).toBe(true);
          expect(line.sectionOverride).toBeNull();
          expect(line.staple).toBe(false);
        }
      });

      it("has between 5 and 9 string steps", () => {
        expect(recipe.steps.length).toBeGreaterThanOrEqual(5);
        expect(recipe.steps.length).toBeLessThanOrEqual(9);
        for (const step of recipe.steps) {
          expect(typeof step.text).toBe("string");
          expect(step.text.length).toBeGreaterThan(0);
        }
      });
    });
  }

  it("never lets any quantity denominator exceed 10000", () => {
    for (const r of samples) {
      for (const line of [...r.ingredients]) {
        for (const q of [line.quantity, line.quantityMax]) {
          if (q !== null) expect(Math.max(q.d, 1)).toBeLessThanOrEqual(10000);
        }
      }
    }
  });
});

describe("sample dataset: ingredient grammar coverage", () => {
  const allLines = samples.flatMap((r) => r.ingredients);

  it("uses unicode vulgar fractions in raw text and quantities", () => {
    expect(allLines.some((l) => /[\u00BC-\u00BE\u2150-\u215E]/.test(l.raw))).toBe(true);
    expect(allLines.some((l) => l.quantity !== null && l.quantity.d > 1)).toBe(true);
  });

  it("expresses at least one range via quantityMax", () => {
    const ranged = allLines.filter((l) => l.quantityMax !== null);
    expect(ranged.length).toBeGreaterThanOrEqual(1);
    for (const l of ranged) expect(l.raw).toMatch(/\u2013|to/);
  });

  it("mixes metric and imperial families across the set", () => {
    const units = new Set(allLines.map((l) => l.unit));
    expect(units.has("g")).toBe(true);
    expect(units.has("ml")).toBe(true);
    expect(units.has("lb")).toBe(true);
    expect(units.has("floz")).toBe(true);
    expect(units.has("cup")).toBe(true);
  });

  it("spells multi-word volume units both ways in raw text", () => {
    expect(allLines.some((l) => /\bfl oz\b/.test(l.raw))).toBe(true);
    expect(allLines.some((l) => /\bfluid ounces\b/.test(l.raw))).toBe(true);
  });

  it("relies on countable units including cloves, sprigs and cans", () => {
    const units = new Set(allLines.map((l) => l.unit));
    for (const u of ["clove", "sprig", "can", "leaf", "bunch", "head", "pinch"]) {
      expect(units.has(u)).toBe(true);
    }
  });

  it("features density-known items: flour cups, butter g and cups, honey, oats", () => {
    const flourCup = allLines.some(
      (l) => /flour/i.test(l.item) && l.unit === "cup"
    );
    expect(flourCup).toBe(true);
    expect(
      allLines.some((l) => /butter/i.test(l.item) && !/peanut|bean/.test(l.item) && l.unit === "g")
    ).toBe(true);
    expect(
      allLines.some((l) => l.item === "butter" && l.unit === "cup")
    ).toBe(true);
    expect(allLines.some((l) => l.item === "honey")).toBe(true);
    expect(allLines.some((l) => /oats/i.test(l.item))).toBe(true);
  });

  it("carries a to-taste line with no quantity", () => {
    const toTaste = allLines.filter((l) => /,\s*to taste$/i.test(l.raw));
    expect(toTaste.length).toBeGreaterThanOrEqual(1);
    expect(toTaste.every((l) => l.quantity === null && l.unit === null)).toBe(true);
  });

  it("offers at least one substitution phrased with 'or'", () => {
    const subs = allLines.filter((l) => typeof l.substitute === "string");
    expect(subs.length).toBeGreaterThanOrEqual(1);
    expect(subs.every((l) => /^or /.test(l.substitute))).toBe(true);
  });

  it("records preparations after commas and parenthetical pack sizes", () => {
    expect(allLines.some((l) => typeof l.preparation === "string")).toBe(true);
    const parenthetical = allLines.filter((l) => /\(\s*\d+\s*g?\s*[^)]*\)/.test(l.raw));
    expect(parenthetical.length).toBeGreaterThanOrEqual(3);
    expect(
      parenthetical.some((l) => /\(400 g each\)/.test(l.raw))
    ).toBe(true);
  });

  it("embeds quantities, temperatures and durations across the steps", () => {
    const steps = samples.flatMap((r) => r.steps.map((s) => s.text));
    expect(steps.some((t) => /\d+ (ml|g|tbsp|cup)\b/.test(t))).toBe(true);
    expect(steps.some((t) => /\d+\u00B0C( fan)?/.test(t))).toBe(true);
    expect(steps.some((t) => /\bfor \d+(\u2013\d+)? minutes\b/.test(t))).toBe(true);
  });
});

describe("sample dataset: scaling smoke", () => {
  const factors = [F(1, 2), F(2, 3), F(3), F(11, 7)];

  it("scales every recipe by every factor without throwing", () => {
    for (const recipe of samples) {
      for (const factor of factors) {
        let scaled;
        expect(() => {
          scaled = scaleRecipe(recipe, factor);
        }).not.toThrow();
        expect(scaled.ingredients).toHaveLength(recipe.ingredients.length);
      }
    }
  });

  it("emits warnings for non-linear lines whenever the factor differs from one", () => {
    const flagged = flaggedRecipes();
    expect(flagged.length).toBeGreaterThanOrEqual(8);
    for (const recipe of flagged) {
      for (const factor of factors) {
        const scaled = scaleRecipe(recipe, factor);
        expect(Array.isArray(scaled.warnings)).toBe(true);
        expect(scaled.warnings.length).toBeGreaterThanOrEqual(1);
        for (const warning of scaled.warnings) {
          expect(warning.lineId).toBeTruthy();
          expect(typeof warning.category).toBe("string");
          expect(typeof warning.guidance).toBe("string");
        }
      }
    }
    for (const recipe of samples) {
      const scaled = scaleRecipe(recipe, F(3));
      expect(Array.isArray(scaled.warnings)).toBe(true);
    }
  });

  it("restores identical ingredient fractions after scaling by a factor then its inverse", () => {
    for (const recipe of samples) {
      for (const factor of factors) {
        const inverse = div(F(1), factor);
        const there = scaleRecipe(recipe, factor);
        const back = scaleRecipe(there, inverse);
        expect(back.ingredients).toHaveLength(recipe.ingredients.length);
        recipe.ingredients.forEach((original, i) => {
          expect(back.ingredients[i].quantity).toEqual(original.quantity);
          expect(back.ingredients[i].quantityMax).toEqual(original.quantityMax);
          expect(back.ingredients[i].id).toBe(original.id);
          expect(back.ingredients[i].unit).toBe(original.unit);
          expect(back.ingredients[i].item).toBe(original.item);
        });
      }
    }
  });
});

describe("sample dataset: shopping list integration", () => {
  it("builds one merged list over all ten recipes at factor one", () => {
    const inputs = samples.map((recipe) => ({ recipe, servings: null }));
    let list;
    expect(() => {
      list = buildShoppingList(inputs, {});
    }).not.toThrow();

    expect(list.groups.length).toBeGreaterThan(0);
    expect(list.sectionsOrder).toEqual([...SECTIONS_ORDER]);
    for (const group of list.groups) {
      expect(SECTIONS_ORDER).toContain(group.section);
      expect(group.items.length).toBeGreaterThan(0);
      for (const item of group.items) {
        expect(typeof item.key).toBe("string");
        expect(item.key.length).toBeGreaterThan(0);
        expect(item.recipeIds.length).toBeGreaterThanOrEqual(1);
        for (const entry of item.quantities) {
          if (entry.amount !== null) expect(isFracLike(entry.amount)).toBe(true);
        }
      }
    }
    const seenSections = list.groups.map((g) => g.section);
    const ordered = [...seenSections].sort(
      (a, b) => SECTIONS_ORDER.indexOf(a) - SECTIONS_ORDER.indexOf(b)
    );
    expect(seenSections).toEqual(ordered);
    expect(typeof list.hiddenStaples).toBe("number");
  });
});
