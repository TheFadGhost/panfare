import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The real parser module is built concurrently elsewhere; these tests run
// against a deterministic fake so they never depend on its existence.
// vi.mock is the instructed mechanism; because vitest cannot resolve a mock
// for a file that does not exist on disk yet, the same fake is also injected
// through the importer's setIngredientParser() hook below — belt and braces.
vi.mock("../src/core/parser.mjs", async () => {
  const { makeFraction, fromDecimalString } = await import(
    "../src/core/fraction.mjs"
  );
  return {
    parseIngredientLine(raw) {
      return fakeParseIngredientLine(raw, { makeFraction, fromDecimalString });
    },
  };
});

function makeFakeParser({ makeFraction, fromDecimalString }) {
  return (raw) => fakeParseIngredientLine(raw, { makeFraction, fromDecimalString });
}

function fakeParseIngredientLine(raw, { makeFraction, fromDecimalString }) {
  const UNIT_IDS = {
    tbsp: "tbsp", tsp: "tsp", g: "g", kg: "kg", ml: "ml", l: "l",
    lb: "lb", oz: "oz", cup: "cup", cups: "cup",
    clove: "clove", cloves: "clove", can: "can", cans: "can",
  };
  const text = String(raw).trim();
  const base = {
    raw: String(raw),
    quantity: null,
    quantityMax: null,
    unit: null,
    item: text,
    preparation: null,
    substitute: null,
    sectionOverride: null,
    staple: false,
  };
  const m = /^(\d+(?:\.\d+)?)\s+(.+)$/.exec(text);
  if (!m) {
    return { ...base, uncertain: true, uncertaintyReason: "no-quantity" };
  }
  const quantity = /^\d+$/.test(m[1])
    ? makeFraction(Number(m[1]))
    : fromDecimalString(m[1]);
  let unit = null;
  let remainder = m[2];
  const um = /^([A-Za-z]+)\s+(.+)$/.exec(remainder);
  if (um && UNIT_IDS[um[1].toLowerCase()]) {
    unit = UNIT_IDS[um[1].toLowerCase()];
    remainder = um[2];
  }
  const commaAt = remainder.indexOf(",");
  const item = commaAt === -1 ? remainder : remainder.slice(0, commaAt);
  const preparation = commaAt === -1 ? null : remainder.slice(commaAt + 1).trim();
  return {
    ...base,
    quantity,
    unit,
    item,
    preparation,
    uncertain: false,
    uncertaintyReason: null,
  };
}

import {
  extractRecipesFromHtml,
  fetchAndExtract,
  parseIsoDuration,
  setIngredientParser,
} from "../src/core/importer.mjs";

beforeEach(async () => {
  // Deterministic parser regardless of whether src/core/parser.mjs exists.
  const { makeFraction, fromDecimalString } = await import(
    "../src/core/fraction.mjs"
  );
  setIngredientParser(makeFakeParser({ makeFraction, fromDecimalString }));
});

afterEach(() => {
  // Never leak the fake into integration runs that use the real parser.
  setIngredientParser(null);
});

const here = dirname(fileURLToPath(import.meta.url));
const loadHtml = (name) =>
  readFileSync(join(here, "fixtures", "html", name), "utf8");

describe("parseIsoDuration", () => {
  it("converts ISO durations to whole minutes", () => {
    expect(parseIsoDuration("PT1H30M")).toBe(90);
    expect(parseIsoDuration("PT15M")).toBe(15);
    expect(parseIsoDuration("P2DT3H")).toBe(3060);
    expect(parseIsoDuration("PT45S")).toBe(1);
  });
  it("returns null for junk instead of guessing", () => {
    expect(parseIsoDuration("1 hour")).toBeNull();
    expect(parseIsoDuration("")).toBeNull();
    expect(parseIsoDuration("P")).toBeNull();
    expect(parseIsoDuration(null)).toBeNull();
    expect(parseIsoDuration(undefined)).toBeNull();
    expect(parseIsoDuration(90)).toBeNull();
  });
});

describe("extractRecipesFromHtml — JSON-LD", () => {
  const html = loadHtml("recipe-with-jsonld.html");

  it("finds the recipe through @graph and decodes entities in the title", () => {
    const result = extractRecipesFromHtml(html);
    expect(result.ok).toBe(true);
    expect(result.recipes).toHaveLength(1);
    const r = result.recipes[0];
    expect(r.id).toMatch(/^r_[a-z0-9]{6,}$/);
    expect(r.title).toBe("Sunlit Tomato & White Bean Stew");
    expect(r.title).not.toContain("&amp;");
  });

  it("parses yield and ISO times onto the CONTRACT shape", () => {
    const r = extractRecipesFromHtml(html).recipes[0];
    expect(r.yield).toEqual({ serves: 6, text: "Serves 6" });
    expect(r.times.prep).toBe(15);
    expect(r.times.cook).toBe(90);
    expect(r.times.extra).toEqual([]);
  });

  it("keeps all 8 ingredient lines with raw text and strips parser flags", () => {
    const r = extractRecipesFromHtml(html).recipes[0];
    expect(r.ingredients).toHaveLength(8);
    const oil = r.ingredients.find((l) => l.item === "olive oil");
    expect(oil.raw).toBe("2 tbsp olive oil");
    expect(oil.quantity).toEqual({ n: 2, d: 1 });
    expect(oil.unit).toBe("tbsp");
    // uncertain/uncertaintyReason must be stripped into the final shape
    for (const line of r.ingredients) {
      expect(line).not.toHaveProperty("uncertain");
      expect(line).not.toHaveProperty("uncertaintyReason");
    }
    // unicode vulgar fractions survive verbatim in raw
    const tomato = r.ingredients.find((l) => l.raw.startsWith("1\u00BD kg"));
    expect(tomato.raw).toContain("\u00BD kg ripe tomatoes");
    // no-number line survives best-effort with null quantity
    const basil = r.ingredients.find((l) => l.raw.includes("basil"));
    expect(basil.quantity).toBeNull();
  });

  it("flattens HowToStep arrays into ordered {text} steps", () => {
    const r = extractRecipesFromHtml(html).recipes[0];
    expect(r.steps).toHaveLength(4);
    expect(r.steps[0]).toEqual({
      text: "Warm the olive oil in a wide casserole over medium heat and soften the onion for 8 minutes.",
    });
    expect(r.steps[3].text).toContain("serve in warm bowls");
  });

  it("splits keywords into tags", () => {
    const r = extractRecipesFromHtml(html).recipes[0];
    expect(r.tags).toEqual(["stew", "vegan", "one-pot", "weeknight"]);
  });

  it("preserves attribution: author, site title, canonical url", () => {
    const r = extractRecipesFromHtml(html).recipes[0];
    expect(r.source.author).toBe("Marisol Okafor");
    expect(r.source.title).toBe("Meridian Kitchen");
    expect(r.source.url).toBe(
      "https://meridiankitchen.example/recipes/sunlit-tomato-white-bean-stew",
    );
  });

  it("lets an explicit sourceUrl override win over page markup", () => {
    const r = extractRecipesFromHtml(
      html,
      "https://cookingnotes.example/paste/42",
    ).recipes[0];
    expect(r.source.url).toBe("https://cookingnotes.example/paste/42");
  });

  it("collects several recipes when the graph carries them", () => {
    const two = `<html><head><script type="application/ld+json">${JSON.stringify([
      {
        "@context": "https://schema.org",
        "@graph": [
          { "@type": "Recipe", "name": "Quick Pickled Onions", "recipeYield": "Makes 1 jar", "recipeIngredient": ["1 red onion"], "recipeInstructions": ["Slice thinly."] },
          { "@type": "Recipe", "name": "Chilli Oil", "recipeYield": "Makes 200 ml", "recipeIngredient": ["200 ml oil"], "recipeInstructions": ["Warm gently."] },
        ],
      },
    ])}</script></head><body></body></html>`;
    const result = extractRecipesFromHtml(two);
    expect(result.ok).toBe(true);
    expect(result.recipes.map((r) => r.title)).toEqual([
      "Quick Pickled Onions",
      "Chilli Oil",
    ]);
  });

  it("records total time under extra when it differs from prep+cook", () => {
    const html2 = `<html><head><script type="application/ld+json">
    {"@type":"Recipe","name":"Overnight Oats","totalTime":"PT8H","recipeYield":"Serves 1"}
    </script></head><body>x</body></html>`;
    const r = extractRecipesFromHtml(html2).recipes[0];
    expect(r.times.prep).toBeNull();
    expect(r.times.cook).toBeNull();
    expect(r.times.extra).toEqual([{ label: "total", minutes: 480 }]);
  });
});

describe("extractRecipesFromHtml — microdata", () => {
  const html = loadHtml("recipe-with-microdata.html");

  it("extracts title, yield text and serves count", () => {
    const result = extractRecipesFromHtml(html, "https://cardamomrye.example/loaf");
    expect(result.ok).toBe(true);
    const r = result.recipes[0];
    expect(r.title).toBe("Cardamom Pear Loaf");
    expect(r.yield).toEqual({ serves: 10, text: "Makes 10 slices" });
  });

  it("reads ISO times from datetime attributes", () => {
    const r = extractRecipesFromHtml(html).recipes[0];
    expect(r.times.prep).toBe(20);
    expect(r.times.cook).toBe(55);
  });

  it("gathers every recipeIngredient element and parses a known line", () => {
    const r = extractRecipesFromHtml(html).recipes[0];
    expect(r.ingredients).toHaveLength(7);
    const flour = r.ingredients.find((l) => l.item === "plain flour");
    expect(flour.raw).toBe("225 g plain flour, sifted");
    expect(flour.quantity).toEqual({ n: 225, d: 1 });
    expect(flour.unit).toBe("g");
    expect(flour.preparation).toBe("sifted");
    // named entity decoding inside ingredient text (&frac12;)
    const cardamom = r.ingredients.find((l) => l.raw.includes("cardamom"));
    expect(cardamom.raw).toContain("1\u00BD tsp ground cardamom");
  });

  it("flattens HowToSection trees plainly, in document order", () => {
    const r = extractRecipesFromHtml(html).recipes[0];
    expect(r.steps).toHaveLength(6);
    expect(r.steps[0].text).toBe(
      "Peel and dice the pears, catching every drop of juice.",
    );
    expect(r.steps[5].text).toContain("skewer comes out clean");
    const joined = r.steps.map((s) => s.text).join(" | ");
    expect(joined).not.toContain("Prepare the fruit");
    expect(joined).not.toContain("Make the batter");
  });

  it("keeps author, keywords and description attribution intact", () => {
    const r = extractRecipesFromHtml(html, "https://cardamomrye.example/loaf")
      .recipes[0];
    expect(r.source.author).toBe("Ines Halvorsen");
    expect(r.source.title).toBe("Cardamom & Rye Bakery");
    expect(r.source.url).toBe("https://cardamomrye.example/loaf");
    expect(r.tags).toEqual(["baking", "loaf", "dessert", "autumn"]);
    expect(r.notes).toBe(
      "A warmly spiced loaf with toasted pears and freshly ground cardamom.",
    );
  });
});

describe("extractRecipesFromHtml — failure states", () => {
  it("reports no-recipe-data for pages with other schema types", () => {
    const result = extractRecipesFromHtml(loadHtml("page-without-recipe.html"));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("no-recipe-data");
    expect(typeof result.details).toBe("string");
    expect(result.details).toMatch(/Recipe/);
    expect(result.details).toMatch(/JSON-LD/);
  });

  it("handles a broken ld+json script gracefully", () => {
    const result = extractRecipesFromHtml(loadHtml("malformed.html"));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("no-recipe-data");
    expect(result.details).toBeTruthy();
  });

  it("reports invalid-html for garbage input without throwing", () => {
    for (const garbage of ["", "   ", "just some plain words", 42, null, undefined, {}]) {
      const result = extractRecipesFromHtml(garbage);
      expect(result.ok).toBe(false);
      expect(result.reason).toBe("invalid-html");
    }
  });

  it("never throws outward on adversarial markup", () => {
    expect(extractRecipesFromHtml("<html><body>nothing here</body></html>").reason).toBe(
      "no-recipe-data",
    );
    expect(
      extractRecipesFromHtml('<script type="application/ld+json">not json</script>')
        .reason,
    ).toBe("no-recipe-data");
  });
});

describe("fetchAndExtract", () => {
  const html = loadHtml("recipe-with-jsonld.html");

  it("extracts from a successful response body", async () => {
    const fakeFetch = async () => ({ ok: true, status: 200, text: async () => html });
    const result = await fetchAndExtract("https://meridiankitchen.example/stew", fakeFetch);
    expect(result.ok).toBe(true);
    expect(result.recipes[0].title).toBe("Sunlit Tomato & White Bean Stew");
    expect(result.recipes[0].source.url).toBe("https://meridiankitchen.example/stew");
  });

  it("maps non-200 responses to http-error with status", async () => {
    const fakeFetch = async () => ({ ok: false, status: 404, text: async () => "" });
    const result = await fetchAndExtract("https://site.example/gone", fakeFetch);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("http-error");
    expect(result.status).toBe(404);
  });

  it("maps network/CORS failures to fetch-blocked with fallback guidance", async () => {
    const fakeFetch = async () => {
      throw new TypeError("Failed to fetch");
    };
    const result = await fetchAndExtract("https://site.example/locked", fakeFetch);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("fetch-blocked");
    expect(result.details).toMatch(/CORS/);
    expect(result.details).toMatch(/paste/i);
  });
});
