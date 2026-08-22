// search.mjs — recipe search, filtering and "what can I make with these".
//
// All matching is over plain stored recipe objects (CONTRACT shape). Text
// matching is lowercase substring; ingredient identity goes through
// normalizeIngredientName so "eggs" meets "free-range egg" as "egg".
// Every function is pure.

import { normalizeIngredientName } from "./names.mjs";

/**
 * Lowercase text blob for substring search: title + tags + ingredient item
 * names + notes + source title/author. Missing fields contribute nothing.
 */
export function buildSearchIndex(recipe) {
  const parts = [];
  if (recipe && typeof recipe.title === "string") parts.push(recipe.title);
  if (recipe && Array.isArray(recipe.tags)) {
    parts.push(...recipe.tags.filter((t) => typeof t === "string"));
  }
  if (recipe && Array.isArray(recipe.ingredients)) {
    for (const ing of recipe.ingredients) {
      if (ing && typeof ing.item === "string") parts.push(ing.item);
    }
  }
  if (recipe && typeof recipe.notes === "string") parts.push(recipe.notes);
  else if (recipe && Array.isArray(recipe.notes)) {
    parts.push(...recipe.notes.filter((n) => typeof n === "string"));
  }
  const source = recipe && typeof recipe.source === "object" ? recipe.source : null;
  if (source) {
    if (typeof source.title === "string") parts.push(source.title);
    if (typeof source.author === "string") parts.push(source.author);
  }
  return parts.join(" ").toLowerCase();
}

/**
 * Total minutes across prep + cook + extra. Null-safe: missing times count
 * as zero. `times.extra` entries may be minute numbers or {label, minutes}.
 */
export function totalMinutes(recipe) {
  const times = recipe && typeof recipe.times === "object" && recipe.times ? recipe.times : {};
  let total = 0;
  if (typeof times.prep === "number" && Number.isFinite(times.prep)) total += times.prep;
  if (typeof times.cook === "number" && Number.isFinite(times.cook)) total += times.cook;
  const extra = Array.isArray(times.extra) ? times.extra : [];
  for (const entry of extra) {
    if (typeof entry === "number" && Number.isFinite(entry)) total += entry;
    else if (
      entry &&
      typeof entry === "object" &&
      typeof entry.minutes === "number" &&
      Number.isFinite(entry.minutes)
    ) {
      total += entry.minutes;
    }
  }
  return total;
}

function normalizedItemNames(recipe) {
  const names = new Set();
  if (!recipe || !Array.isArray(recipe.ingredients)) return names;
  for (const ing of recipe.ingredients) {
    if (!ing || typeof ing.item !== "string") continue;
    const name = normalizeIngredientName(ing.item);
    if (name) names.add(name);
  }
  return names;
}

function servesOf(recipe) {
  const yieldObj =
    recipe && typeof recipe.yield === "object" && recipe.yield ? recipe.yield : null;
  const serves = yieldObj ? yieldObj.serves : undefined;
  return typeof serves === "number" && Number.isInteger(serves) && serves > 0 ? serves : null;
}

/**
 * True when the recipe satisfies every active clause of the query.
 *   terms               — array of strings, AND semantics; each term must be a
 *                         case-insensitive substring of the search index
 *                         (which spans title/tags/items/notes/source), so
 *                         matching is OR across fields within one term.
 *   tag                 — exact match ignoring case.
 *   maxTotalMinutes     — excludes recipes taking longer (missing time = 0).
 *   minYield / maxYield — inclusive bounds on yield.serves; recipes without
 *                         an integer serves value fail any active yield bound
 *                         (we cannot claim they fit).
 *   includeIngredients  — ALL must be present, compared via
 *                         normalizeIngredientName on both sides.
 */
export function matchesQuery(recipe, query = {}) {
  const q = query || {};

  const terms = Array.isArray(q.terms) ? q.terms : [];
  const activeTerms = terms.filter((t) => typeof t === "string" && t.trim().length > 0);
  if (activeTerms.length > 0) {
    const index = buildSearchIndex(recipe);
    for (const term of activeTerms) {
      if (!index.includes(term.toLowerCase())) return false;
    }
  }

  if (q.tag != null) {
    const want = String(q.tag).toLowerCase();
    const tags = recipe && Array.isArray(recipe.tags) ? recipe.tags : [];
    let found = false;
    for (const tag of tags) {
      if (typeof tag === "string" && tag.toLowerCase() === want) {
        found = true;
        break;
      }
    }
    if (!found) return false;
  }

  if (q.maxTotalMinutes != null) {
    if (totalMinutes(recipe) > q.maxTotalMinutes) return false;
  }

  if (q.minYield != null || q.maxYield != null) {
    const serves = servesOf(recipe);
    if (serves === null) return false;
    if (q.minYield != null && serves < q.minYield) return false;
    if (q.maxYield != null && serves > q.maxYield) return false;
  }

  const includeIngredients = Array.isArray(q.includeIngredients) ? q.includeIngredients : [];
  if (includeIngredients.length > 0) {
    const available = normalizedItemNames(recipe);
    for (const wanted of includeIngredients) {
      const name = normalizeIngredientName(wanted); // null for non-string input
      if (!name || !available.has(name)) return false;
    }
  }

  return true;
}

/**
 * Rank recipes by how much of the given pantry they use.
 * matched counts distinct normalised ingredient names shared between pantry
 * and recipe; missing lists the recipe's own names absent from the pantry
 * (recipe order, deduplicated). Sort: matched desc, then title asc,
 * then id asc — fully deterministic.
 */
export function whatCanIMake(recipes, ingredientNames) {
  const pantry = new Set();
  for (const raw of Array.isArray(ingredientNames) ? ingredientNames : []) {
    const name = typeof raw === "string" ? normalizeIngredientName(raw) : null;
    if (name) pantry.add(name);
  }

  const results = [];
  for (const recipe of Array.isArray(recipes) ? recipes : []) {
    const seen = new Set();
    let matched = 0;
    const missing = [];
    for (const ing of recipe && Array.isArray(recipe.ingredients) ? recipe.ingredients : []) {
      if (!ing || typeof ing.item !== "string") continue;
      const name = normalizeIngredientName(ing.item);
      if (!name || seen.has(name)) continue;
      seen.add(name);
      if (pantry.has(name)) matched++;
      else missing.push(name);
    }
    results.push({ recipe, matched, missing });
  }

  const byString = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  results.sort(
    (a, b) =>
      b.matched - a.matched ||
      byString(String(a.recipe.title ?? ""), String(b.recipe.title ?? "")) ||
      byString(String(a.recipe.id ?? ""), String(b.recipe.id ?? ""))
  );
  return results;
}

/** Recipes whose total time is at most maxMinutes (missing time counts as 0). */
export function filterByTime(recipes, maxMinutes) {
  return recipes.filter((r) => matchesQuery(r, { maxTotalMinutes: maxMinutes }));
}

/** Recipes whose serves is within [min, max] inclusive; either bound may be null. */
export function filterByYield(recipes, min, max) {
  return recipes.filter((r) => matchesQuery(r, { minYield: min, maxYield: max }));
}

/** Recipes tagged `tag`, case-insensitive. */
export function filterByTag(recipes, tag) {
  return recipes.filter((r) => matchesQuery(r, { tag }));
}
