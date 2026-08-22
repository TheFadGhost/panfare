import { describe, it, expect } from "vitest";
import {
  buildSearchIndex,
  matchesQuery,
  totalMinutes,
  whatCanIMake,
  filterByTime,
  filterByYield,
  filterByTag,
} from "../src/core/search.mjs";

let seq = 0;
function recipe(overrides = {}) {
  seq += 1;
  return {
    id: "r_" + String(seq).padStart(3, "0"),
    title: "Untitled",
    yield: { serves: 4, text: "serves 4" },
    times: { prep: 10, cook: 20, extra: [] },
    ingredients: [],
    steps: [{ text: "Cook it." }],
    notes: null,
    tags: [],
    source: { url: null, title: null, author: null },
    rating: null,
    history: [],
    photo: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const ing = (item, extra = {}) => ({
  id: "i_" + item.replace(/\s+/g, "_"),
  raw: item,
  quantity: { n: 1, d: 1 },
  quantityMax: null,
  unit: "each",
  item,
  preparation: null,
  substitute: null,
  sectionOverride: null,
  staple: false,
  ...extra,
});

describe("buildSearchIndex", () => {
  it("lowercases and spans title, tags, ingredient items, notes and source", () => {
    const r = recipe({
      title: "Weeknight Red Lentil Soup",
      tags: ["Soup", "Vegan"],
      ingredients: [ing("red lentils"), ing("onion")],
      notes: "Freezes well.",
      source: { url: null, title: "Mum's Notebook", author: "A. Cook" },
    });
    const index = buildSearchIndex(r);
    expect(index).toBe(index.toLowerCase());
    for (const needle of [
      "weeknight red lentil soup",
      "soup vegan",
      "red lentils",
      "onion",
      "freezes well",
      "mum's notebook",
      "a. cook",
    ]) {
      expect(index.includes(needle)).toBe(true);
    }
  });

  it("survives recipes with missing optional fields", () => {
    const bare = { id: "r_0", title: "Bare" };
    expect(buildSearchIndex(bare)).toBe("bare");
  });
});

describe("totalMinutes", () => {
  it("sums prep + cook + numeric extras", () => {
    expect(totalMinutes(recipe({ times: { prep: 5, cook: 25, extra: [10] } }))).toBe(40);
  });

  it("accepts extras as {label, minutes} objects too", () => {
    expect(
      totalMinutes(recipe({ times: { prep: 5, cook: 25, extra: [{ label: "rest", minutes: 30 }] } }))
    ).toBe(60);
  });

  it("is null-safe: missing or partial times count as zero", () => {
    expect(totalMinutes({ id: "r_0" })).toBe(0);
    expect(totalMinutes(recipe({ times: null }))).toBe(0);
    expect(totalMinutes(recipe({ times: { prep: 15 } }))).toBe(15);
  });
});

describe("matchesQuery", () => {
  it("an empty query matches everything", () => {
    expect(matchesQuery(recipe(), {})).toBe(true);
    expect(matchesQuery(recipe())).toBe(true);
  });

  it("terms are AND across terms but OR across fields within a term", () => {
    const r = recipe({
      title: "Lentil Soup",
      tags: ["vegan"],
      ingredients: [ing("carrot")],
      source: { url: null, title: null, author: "Nigella" },
    });
    expect(matchesQuery(r, { terms: ["lentil"] })).toBe(true); // title
    expect(matchesQuery(r, { terms: ["vegan"] })).toBe(true); // tag
    expect(matchesQuery(r, { terms: ["carrot"] })).toBe(true); // ingredient
    expect(matchesQuery(r, { terms: ["nigella"] })).toBe(true); // author
    expect(matchesQuery(r, { terms: ["lentil", "carrot"] })).toBe(true); // AND
    expect(matchesQuery(r, { terms: ["lentil", "chicken"] })).toBe(false); // AND fails
    expect(matchesQuery(r, { terms: ["LENTIL"] })).toBe(true); // case-insensitive
    expect(matchesQuery(r, { terms: [""] })).toBe(true); // blank term is inert
  });

  it("tag filter is case-insensitive exact match", () => {
    const r = recipe({ tags: ["Vegan"] });
    expect(matchesQuery(r, { tag: "vegan" })).toBe(true);
    expect(matchesQuery(r, { tag: "VEGAN" })).toBe(true);
    expect(matchesQuery(r, { tag: "veg" })).toBe(false); // not substring matching
    expect(matchesQuery(recipe({ tags: [] }), { tag: null })).toBe(true);
  });

  it("maxTotalMinutes filters with boundary inclusivity", () => {
    const fast = recipe({ times: { prep: 10, cook: 20, extra: [] } }); // 30
    expect(matchesQuery(fast, { maxTotalMinutes: 30 })).toBe(true);
    expect(matchesQuery(fast, { maxTotalMinutes: 29 })).toBe(false);
    expect(matchesQuery(fast, { maxTotalMinutes: null })).toBe(true);
  });

  it("yield filters are inclusive bounds; unknown serves fails an active bound", () => {
    const servesFour = recipe();
    expect(matchesQuery(servesFour, { minYield: 4 })).toBe(true);
    expect(matchesQuery(servesFour, { maxYield: 4 })).toBe(true);
    expect(matchesQuery(servesFour, { minYield: 2, maxYield: 6 })).toBe(true);
    expect(matchesQuery(servesFour, { minYield: 5 })).toBe(false);
    expect(matchesQuery(servesFour, { maxYield: 3 })).toBe(false);
    const noServes = recipe({ yield: { text: "one tray" } });
    expect(matchesQuery(noServes, { minYield: 1 })).toBe(false);
    expect(matchesQuery(noServes, { maxYield: 99 })).toBe(false);
    expect(matchesQuery(noServes, {})).toBe(true);
  });

  it("includeIngredients requires ALL, matched via normalized names on both sides", () => {
    const omelette = recipe({
      ingredients: [ing("free-range eggs"), ing("butter"), ing("baby spinach")],
    });
    // "eggs" query must meet "free-range eggs" as "egg".
    expect(matchesQuery(omelette, { includeIngredients: ["eggs"] })).toBe(true);
    expect(matchesQuery(omelette, { includeIngredients: ["egg"] })).toBe(true);
    expect(matchesQuery(omelette, { includeIngredients: ["eggs", "spinach"] })).toBe(true);
    expect(matchesQuery(omelette, { includeIngredients: ["eggs", "cheddar"] })).toBe(false);
    expect(matchesQuery(omelette, { includeIngredients: ["BABY SPINACHES"] })).toBe(true);
    expect(matchesQuery(omelette, { includeIngredients: [] })).toBe(true);
  });

  it("clauses combine conjunctively", () => {
    const r = recipe({
      title: "Quick Soup",
      tags: ["vegan"],
      times: { prep: 5, cook: 15, extra: [] },
      ingredients: [ing("carrots")],
    });
    expect(
      matchesQuery(r, {
        terms: ["quick"],
        tag: "vegan",
        maxTotalMinutes: 20,
        includeIngredients: ["carrot"],
      })
    ).toBe(true);
    expect(
      matchesQuery(r, { terms: ["quick"], tag: "vegan", maxTotalMinutes: 19 })
    ).toBe(false);
  });
});

describe("whatCanIMake", () => {
  const pantry = ["eggs", "butter", "flour"];

  const pancakes = recipe({
    title: "Pancakes",
    ingredients: [ing("eggs"), ing("plain flour"), ing("butter"), ing("milk")],
  });
  const omelette = recipe({
    title: "Omelette",
    ingredients: [ing("eggs"), ing("butter"), ing("gruyere")],
  });
  const toast = recipe({
    title: "Buttered Toast",
    ingredients: [ing("bread"), ing("butter")],
  });
  const unrelated = recipe({ title: "Curry", ingredients: [ing("coconut milk"), ing("rice")] });

  it("ranks by matched desc then title asc, deterministically", () => {
    const ranked = whatCanIMake([toast, unrelated, omelette, pancakes], pantry);
    expect(ranked.map((r) => r.recipe.title)).toEqual([
      "Pancakes",
      "Omelette",
      "Buttered Toast",
      "Curry",
    ]);
    const again = whatCanIMake([unrelated, toast, pancakes, omelette], pantry);
    expect(JSON.stringify(again)).toEqual(JSON.stringify(ranked));
  });

  it("breaks matched ties by title ascending", () => {
    const zebra = recipe({ title: "Zebra Cake", ingredients: [ing("eggs")] });
    const apple = recipe({ title: "Apple Cake", ingredients: [ing("free-range eggs")] });
    const ranked = whatCanIMake([zebra, apple], ["eggs"]);
    expect(ranked.map((r) => r.recipe.title)).toEqual(["Apple Cake", "Zebra Cake"]);
  });

  it("counts distinct normalised intersections and lists missing names", () => {
    const [first] = whatCanIMake([pancakes], pantry);
    expect(first.matched).toBe(3); // egg, flour, butter — "plain flour" → "flour"
    expect(first.missing).toEqual(["milk"]);
    const [curry] = whatCanIMake([unrelated], pantry);
    expect(curry.matched).toBe(0);
    expect(curry.missing).toEqual(["coconut milk", "rice"]);
  });

  it("ignores junk pantry entries instead of throwing", () => {
    expect(() => whatCanIMake([pancakes], [null, 42, "", "eggs"])).not.toThrow();
    const [only] = whatCanIMake([pancakes], [null, 42, "", "eggs"]);
    expect(only.matched).toBe(1);
  });
});

describe("thin wrappers", () => {
  const quick = recipe({ title: "Quick", times: { prep: 5, cook: 10, extra: [] }, tags: ["fast"], yield: { serves: 2 } });
  const slow = recipe({ title: "Slow", times: { prep: 60, cook: 120, extra: [] }, tags: ["slow"], yield: { serves: 8 } });
  const untimed = recipe({ title: "Untimed", times: null, tags: [], yield: { serves: 4 } });
  const all = [quick, slow, untimed];

  it("filterByTime keeps totals at or under the bound (missing time = 0)", () => {
    expect(filterByTime(all, 15).map((r) => r.title)).toEqual(["Quick", "Untimed"]);
  });

  it("filterByYield applies inclusive bounds", () => {
    expect(filterByYield(all, 2, 4).map((r) => r.title)).toEqual(["Quick", "Untimed"]);
    expect(filterByYield(all, null, 3).map((r) => r.title)).toEqual(["Quick"]);
  });

  it("filterByTag is case-insensitive", () => {
    expect(filterByTag(all, "FAST").map((r) => r.title)).toEqual(["Quick"]);
    expect(filterByTag(all, "nope")).toEqual([]);
  });
});
