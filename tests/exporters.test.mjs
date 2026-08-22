import { describe, it, expect } from "vitest";
import { makeFraction as F } from "../src/core/fraction.mjs";
import { toJson, fromJson, toMarkdown, toPrintableHtml } from "../src/core/exporters.mjs";

const recipe = () => ({
  id: "r_test0001",
  title: "Cardamom Pear Loaf",
  yield: { serves: 6, text: "Serves 6" },
  times: { prep: 20, cook: 55, extra: [] },
  ingredients: [
    {
      id: "i_001",
      raw: "200 g plain flour, sifted",
      quantity: F(200),
      quantityMax: null,
      unit: "g",
      item: "plain flour",
      preparation: "sifted",
      substitute: null,
      sectionOverride: null,
      staple: false,
    },
    {
      id: "i_002",
      raw: "2 cups whole milk",
      quantity: F(2),
      quantityMax: null,
      unit: "cup",
      item: "whole milk",
      preparation: null,
      substitute: null,
      sectionOverride: null,
      staple: false,
    },
    {
      id: "i_003",
      raw: "1 to 2 tbsp honey",
      quantity: F(1),
      quantityMax: F(2),
      unit: "tbsp",
      item: "honey",
      preparation: null,
      substitute: null,
      sectionOverride: null,
      staple: false,
    },
    {
      id: "i_004",
      raw: "salt to taste",
      quantity: null,
      quantityMax: null,
      unit: null,
      item: "salt",
      preparation: null,
      substitute: null,
      sectionOverride: null,
      staple: true,
    },
  ],
  steps: [
    { text: "Whisk 2 eggs with 250 ml milk." },
    { text: "Fold in the flour and bake at 180\u00B0C for 55 minutes." },
  ],
  notes: "Keeps three days wrapped in paper.",
  tags: ["baking", "dessert"],
  source: {
    url: "https://cardamomrye.example/pear-loaf",
    title: "Cardamom & Rye Bakery",
    author: "Ines Halvorsen",
  },
  rating: null,
  history: [],
  photo: null,
  createdAt: "2026-08-01T09:00:00.000Z",
  updatedAt: "2026-08-01T09:00:00.000Z",
});

describe("toJson / fromJson", () => {
  it("wraps the recipe under the panfare/1 envelope", () => {
    const json = toJson(recipe());
    expect(typeof json).toBe("string");
    const parsed = JSON.parse(json);
    expect(parsed.format).toBe("panfare/1");
    expect(parsed.recipe.title).toBe("Cardamom Pear Loaf");
  });

  it("encodes Fractions as [n,d] integer pairs (never floats)", () => {
    const parsed = JSON.parse(toJson(recipe()));
    expect(parsed.recipe.ingredients[0].quantity).toEqual([200, 1]);
    expect(jsonHasNoFloats(toJson(recipe()))).toBe(true);
  });

  it("round-trips exactly, modulo key order", () => {
    const original = recipe();
    const back = fromJson(toJson(original));
    expect(back).toEqual(original);
    expect(back.ingredients[0].quantity).toEqual({ n: 200, d: 1 });
  });

  it("is stable: key order of the input never changes the output", () => {
    const r = recipe();
    const shuffled = {
      updatedAt: r.updatedAt,
      steps: r.steps,
      title: r.title,
      ingredients: r.ingredients,
      yield: r.yield,
      id: r.id,
      times: r.times,
      tags: r.tags,
      notes: r.notes,
      source: r.source,
      rating: r.rating,
      history: r.history,
      photo: r.photo,
      createdAt: r.createdAt,
    };
    expect(toJson(r)).toBe(toJson(shuffled));
  });

  it("rejects payloads that are not panfare/1", () => {
    expect(() => fromJson('{"format":"other/9","recipe":{}}')).toThrow(/format/i);
    expect(() => fromJson("{not json at all")).toThrow();
    expect(() => fromJson('{"format":"panfare/1"}')).toThrow(/recipe/i);
  });
});

function jsonHasNoFloats(json) {
  return !/"\s*:\s*-?\d+\.\d+/.test(json) && !/\[\s*\d+\.\d+/.test(json);
}

describe("toMarkdown", () => {
  it("renders title, meta block, ingredient lines and numbered steps", () => {
    const md = toMarkdown(recipe());
    expect(md).toContain("# Cardamom Pear Loaf");
    expect(md).toContain("Yield: serves 6");
    expect(md).toContain("Prep: 20 min");
    expect(md).toContain("Cook: 55 min");
    expect(md).toContain("- 200 g plain flour, sifted");
    expect(md).toMatch(/^1\. Whisk 2 eggs with 250 ml milk\.$/m);
    expect(md).toContain("## Notes");
  });

  it("doubles grams exactly at x2 and rewrites step quantities", () => {
    const md = toMarkdown(recipe(), { n: 2, d: 1 });
    expect(md).toContain("400 g plain flour");
    expect(md).not.toContain("200 g plain flour");
    expect(md).toContain("Yield: serves 12");
    expect(md).toContain("Whisk 4 eggs with 500 ml milk.");
    // times never scale silently
    expect(md).toContain("Cook: 55 min");
    // oven temperature stays put
    expect(md).toContain("180\u00B0C for 55 minutes");
  });

  it("never omits the Source line when attribution exists", () => {
    const md = toMarkdown(recipe());
    expect(md).toContain(
      "Source: Ines Halvorsen \u2014 Cardamom & Rye Bakery (https://cardamomrye.example/pear-loaf)",
    );
  });

  it("handles a null-quantity line and a missing source gracefully", () => {
    const md = toMarkdown(recipe());
    expect(md).toContain("- salt");
    const anonymous = { ...recipe(), source: { url: null, title: null, author: null } };
    expect(toMarkdown(anonymous)).not.toContain("Source:");
  });
});

describe("toPrintableHtml", () => {
  it("emits a standalone document with inline CSS only", () => {
    const html = toPrintableHtml({ kind: "recipe", recipe: recipe() });
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/@import|<link|url\(http/);
  });

  it("honours DESIGN.md print rules", () => {
    const html = toPrintableHtml({ kind: "recipe", recipe: recipe() });
    expect(html).toContain("#ffffff");
    expect(html).toContain("#000000");
    expect(html).toContain(".pf-check::before");
    expect(html).toContain("page-break-inside: avoid");
    expect(html).toContain("page-break-after: avoid");
    expect(html).toContain('class="pf-head"');
    expect(html).toContain('class="pf-row"');
    expect(html).toContain('class="pf-row pf-step"');
    expect(html).toContain("tabular-nums");
  });

  it("keeps title, scaled yield and source on the first block", () => {
    const html = toPrintableHtml({
      kind: "recipe",
      recipe: recipe(),
      scaleFactor: { n: 2, d: 1 },
    });
    const headStart = html.indexOf('<header class="pf-head">');
    const headEnd = html.indexOf("</header>");
    const head = html.slice(headStart, headEnd);
    expect(head).toContain("Cardamom Pear Loaf");
    expect(head).toContain("serves 12");
    expect(head).toContain("Ines Halvorsen");
    expect(html).toContain("400 g");
  });

  it("escapes hostile content instead of executing it", () => {
    const hostile = recipe();
    hostile.title = 'Loaf </title><script>alert("x")</script>';
    const html = toPrintableHtml({ kind: "recipe", recipe: hostile });
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain("&lt;script&gt;");
  });

  it("prints shopping lists with checkbox squares and hidden-staple footer", () => {
    const list = {
      groups: [
        {
          section: "Produce",
          items: [
            {
              key: "carrot",
              displayName: "carrots",
              quantities: [{ amount: F(7), unit: "each", approx: false }],
              preparations: ["grated"],
              recipeIds: ["r_a", "r_b"],
              notes: [],
            },
          ],
        },
        {
          section: "Pantry",
          items: [
            {
              key: "flour",
              displayName: "plain flour",
              quantities: [{ amount: F(250), unit: "g", approx: true }],
              preparations: [],
              recipeIds: ["r_a"],
              notes: ["kept separate \u2014 different preparation"],
            },
          ],
        },
      ],
      hiddenStaples: 4,
      sectionsOrder: ["Produce", "Pantry"],
    };
    const html = toPrintableHtml({ kind: "shoppingList", list });
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain(">Produce</h2>");
    expect(html).toContain("carrots");
    expect(html).toContain('class="pf-row pf-check"');
    expect(html).toContain("\u2248 250 g");
    expect(html).toContain("kept separate \u2014 different preparation");
    expect(html).toContain("4 pantry staples hidden");
  });
});
