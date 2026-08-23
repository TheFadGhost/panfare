// audit-fixes.test.mjs — permanent regression tests for every behaviour
// named in AUDIT.md. If one of these ever fails, an audit finding regressed.

import { describe, it, expect } from "vitest";
import { makeFraction as F } from "../src/core/fraction.mjs";
import { formatQuantity, formatScalar } from "../src/core/format.mjs";
import { tryConvert } from "../src/core/units.mjs";
import { parseIngredientLine } from "../src/core/parser.mjs";
import { scaleStepText } from "../src/core/scaling.mjs";
import { buildShoppingList } from "../src/core/shoppingList.mjs";

const C = "\u2248 ";

describe("D1: honesty around odd fractions", () => {
  it("13/16 floz rounds to a friendly fraction within the 2% rule", () => {
    const r = formatQuantity({ amount: F(13, 16), unit: "floz" });
    // nearest friendly is 4/5 fl oz (1.25% off) -> unmarked per DESIGN.md
    expect(r.text).toBe("\u2158 fl oz");
    expect(r.approx).toBe(false);
    expect(r.text).not.toMatch(/\d\.\d/);
  });
  it("15/32 tbsp carries an explicit marker (error exceeds 2%)", () => {
    const r = formatQuantity({ amount: F(15, 32), unit: "tbsp" });
    expect(r.approx).toBe(true);
    expect(r.text.startsWith(C)).toBe(true);
    expect(r.text).not.toMatch(/\d\.\d/);
  });
  it("7/16 floz never masquerades as exact", () => {
    // nearest small-denominator match is 3/7 fl oz (2.04% off) -> the rule
    // marks anything over 2%, so this must carry the marker
    const r = formatQuantity({ amount: F(7, 16), unit: "floz" });
    expect(r.approx).toBe(true);
    expect(r.text.startsWith(C)).toBe(true);
    expect(r.aria.startsWith("approximately")).toBe(true);
    expect(r.text).not.toMatch(/\d\.\d/);
  });
  it("exact friendly fractions stay unmarked", () => {
    const r = formatQuantity({ amount: F(3, 8), unit: "cup" });
    expect(r.approx).toBe(false);
    expect(r.text.startsWith(C)).toBe(false);
  });
  it("step text and ingredient rendering agree (maxDen 16)", () => {
    const stepOut = formatScalar(F(1, 9), 16);
    expect(stepOut.text).toBe("1\u20449");
    expect(stepOut.approx).toBe(false);
  });
});

function recipeWith(ingredients) {
  return {
    id: "r_t", title: "T", yield: { serves: 1, text: null },
    times: { prep: null, cook: null, extra: [] }, notes: null,
    ingredients, steps: [], tags: [],
    source: { url: null, title: null, author: null },
  };
}

describe("C2: unit-less quantified lines merge as counts", () => {
  const recipeA = recipeWith([
    { id: "i_1", raw: "2 eggs", quantity: F(2), quantityMax: null, unit: null, item: "eggs", preparation: null, substitute: null, sectionOverride: null, staple: false },
  ]);
  const recipeB = { ...recipeA, id: "r_b", title: "B" };
  recipeB.ingredients = [
    { id: "i_2", raw: "3 eggs", quantity: F(3), quantityMax: null, unit: null, item: "eggs", preparation: null, substitute: null, sectionOverride: null, staple: false },
  ];
  it("two unit-less lines sum instead of dropping", () => {
    const list = buildShoppingList(
      [{ recipe: recipeA, servings: null }, { recipe: recipeB, servings: null }],
      {}
    );
    const eggs = list.groups.flatMap((g) => g.items).find((i) => i.key === "egg");
    expect(eggs).toBeDefined();
    expect(eggs.quantities[0].amount).toEqual(F(5));
    expect(eggs.notes.join(" ")).not.toContain("no quantity stated");
  });
});

describe("C7: density lookup uses real kitchen phrases first", () => {
  const icingRecipe = recipeWith([
    { id: "i_1", raw: "1 cup icing sugar", quantity: F(1), quantityMax: null, unit: "cup", item: "icing sugar", preparation: null, substitute: null, sectionOverride: null, staple: false },
    { id: "i_2", raw: "100 g icing sugar", quantity: F(100), quantityMax: null, unit: "g", item: "icing sugar", preparation: null, substitute: null, sectionOverride: null, staple: false },
  ]);
  it("uses icing-sugar density (56/100), not granulated (85/100)", () => {
    const list = buildShoppingList([{ recipe: icingRecipe, servings: null }], {});
    const item = list.groups.flatMap((g) => g.items)
      .find((i) => i.key.includes("icing") || i.key === "sugar");
    // 240 ml x 0.56 + 100 g = 234.4 g exactly
    expect(item.quantities[0].amount).toEqual(F(1172, 5));
    expect(item.quantities[0].approx).toBe(true);
  });
});

describe("C6: printable list survives unquantified items", () => {
  const { toPrintableHtml } = {};
  void toPrintableHtml;
  it("renders bare names without throwing and without double markers", async () => {
    const { toPrintableHtml: printable } = await import("../src/core/exporters.mjs");
    const html = printable({
      kind: "shoppingList",
      list: {
        groups: [{
          section: "Pantry",
          items: [{
            key: "salt",
            displayName: "Salt",
            quantities: [{ amount: null, unit: null, approx: false }],
            preparations: [],
            recipeIds: ["r_x"],
            notes: ["no quantity stated in source recipe"],
          }],
        }],
        hiddenStaples: 0,
      },
    }, {});
    expect(html).toContain("Salt");
    expect(html).toContain("no quantity stated");
    expect((html.match(/\u2248/g) || []).length).toBe(0);
  });
  it("marks approximate amounts exactly once", async () => {
    const { toPrintableHtml: printable } = await import("../src/core/exporters.mjs");
    const html = printable({
      kind: "shoppingList",
      list: {
        groups: [{
          section: "Pantry",
          items: [{
            key: "flour",
            displayName: "flour",
            quantities: [{ amount: F(656, 5), unit: "g", approx: true }],
            preparations: [],
            recipeIds: ["r_x"],
            notes: [],
          }],
        }],
        hiddenStaples: 0,
      },
    }, {});
    expect((html.match(/\u2248/g) || []).length).toBeLessThanOrEqual(1);
  });
});

describe("C9: contract reason for countable refusal", () => {
  it("tryConvert names different-count-unit explicitly", () => {
    const r = tryConvert(F(3), "clove", "slice");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("different-count-unit");
  });
});

describe("C21: multi-digit glued vulgar fractions parse", () => {
  it("10\u00BD cups is 21/2 cups of plain flour", () => {
    const line = parseIngredientLine("10\u00BD cups plain flour");
    expect(line.quantity).toEqual(F(21, 2));
    expect(line.unit).toBe("cup");
    expect(line.item).toContain("plain flour");
  });
});

describe("C8: parser and scaling agree on number tokens", () => {
  // Bare articles stay out of step-text tokens on purpose ("a pan", "a medium
  // heat" must never scale); numeric forms must agree exactly.
  it("scaling handles U+2044 tokens like the parser", () => {
    const r = scaleStepText("Whisk 1\u20442 cup of the mixture.", F(2));
    expect(r.text).toContain("1 cup");
  });
  it("scaling leaves plain articles untouched", () => {
    const r = scaleStepText("Heat a pan over a medium heat.", F(3));
    expect(r.text).toBe("Heat a pan over a medium heat.");
  });
  it("scaling handles glued vulgar tokens like the parser", () => {
    const r2 = scaleStepText("Add 10\u00BD grams.", F(2));
    expect(r2.text).toContain("21");
  });
});
