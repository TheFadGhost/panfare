// libraryView.mjs — recipe library: search, filters, sort, pantry mode
// ("What can I make with these?") and the first-run empty state.
//
// The toolbar is built once; only the results region re-renders, so focus
// stays in the search field while typing. State changes from elsewhere
// (seeding samples, deleting in another tab's session) refresh via subscribe.

import { h } from "../dom.mjs";
import { getState, subscribe, seedSamples } from "../state.mjs";
import { matchesQuery, totalMinutes, whatCanIMake } from "../../core/search.mjs";
import { safeUrl } from "../../core/urlsafe.mjs";

const SEARCH_DEBOUNCE_MS = 120;
const PANTRY_RESULT_LIMIT = 12;

function debounce(fn, ms) {
  let timer = null;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => clearTimeout(timer);
  return wrapped;
}

function distinctTags(recipes) {
  const seen = new Set();
  const tags = [];
  for (const r of recipes) {
    for (const tag of Array.isArray(r && r.tags) ? r.tags : []) {
      if (typeof tag !== "string" || !tag.trim()) continue;
      const key = tag.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      tags.push(tag);
    }
  }
  return tags.sort((a, b) => a.localeCompare(b));
}

function hasAnyTime(recipe) {
  const t = recipe.times;
  return !!(
    t &&
    ((t.prep != null && t.prep > 0) ||
      (t.cook != null && t.cook > 0) ||
      (Array.isArray(t.extra) && t.extra.length > 0))
  );
}

function formatTotalMinutes(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) return "";
  if (minutes < 60) return minutes + " min";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? h + " h" : h + " h " + m + " min";
}

function servesText(recipe) {
  const y = recipe.yield || {};
  if (typeof y.serves === "number" && y.serves > 0) return "serves " + y.serves;
  return typeof y.text === "string" && y.text.trim() ? y.text.trim() : "";
}

function sourceLine(recipe) {
  const src = recipe.source || {};
  const label = [src.author, src.title].find((v) => typeof v === "string" && v.trim());
  if (!label && !src.url) return null;
  const safeLink = safeUrl(src.url);
  if (safeLink) {
    return h("p", { class: "prep" }, "from ", h("a", { href: safeLink, target: "_blank", rel: "noopener noreferrer" }, label || safeLink));
  }
  if (label) return h("p", { class: "prep" }, "from ", label);
  return h("p", { class: "prep" }, "from ", "(unverified link removed)");
}

function ratingBadge(rating) {
  if (!(typeof rating === "number" && rating >= 1 && rating <= 5)) return null;
  const n = Math.round(rating); // integer display math only
  return h(
    "span",
    {
      class: "chip",
      "aria-label": "Rated " + n + " out of 5",
      title: "Rated " + n + " out of 5",
    },
    h("span", { "aria-hidden": "true", style: "color:var(--pf-accent,#a64b22);letter-spacing:1px;" }, "*".repeat(n)),
    " ",
    n + "/5"
  );
}

function recipeCard(recipe) {
  const meta = [];
  if (hasAnyTime(recipe)) {
    const mins = formatTotalMinutes(totalMinutes(recipe));
    if (mins) meta.push(mins);
  }
  const serves = servesText(recipe);
  if (serves) meta.push(serves);

  const thumb = recipe.photo
    ? h("img", {
        src: recipe.photo,
        alt: "",
        style:
          "width:56px;height:56px;flex:none;object-fit:cover;" +
          "border-radius:6px;border:1px solid var(--pf-line,#e4dcce);",
      })
    : null;

  return h(
    "li",
    { style: "padding:16px 0;border-bottom:1px solid var(--pf-line,#e4dcce);" },
    h(
      "div",
      { style: "display:flex;gap:12px;align-items:flex-start;" },
      thumb,
      h(
        "div",
        {},
        h(
          "h3",
          { style: "font-size:20px;margin-bottom:4px;" },
          h("a", { href: "#/recipe/" + encodeURIComponent(recipe.id) }, recipe.title || "Untitled recipe")
        ),
        meta.length
          ? h(
              "p",
              { style: "font-variant-numeric:tabular-nums;margin-bottom:4px;" },
              meta.join(" \u00B7 ")
            )
          : null,
        ratingBadge(recipe.rating),
        Array.isArray(recipe.tags) && recipe.tags.length
          ? h(
              "p",
              { style: "margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;" },
              recipe.tags.filter((t) => typeof t === "string").map((t) => h("span", { class: "chip" }, t))
            )
          : null,
        sourceLine(recipe)
      )
    )
  );
}

export function libraryView(container) {
  let unsubscribe = null;

  const filters = {
    q: "",
    tag: "",
    maxTime: "",
    minYield: null,
    maxYield: null,
    sort: "title",
  };

  // ---- toolbar ---------------------------------------------------------------

  const searchInput = h("input", {
    type: "search",
    placeholder: "Search recipes, tags, ingredients\u2026",
    "data-shortcut-search": true,
    "aria-label": "Search recipes, tags and ingredients",
  });

  const tagSelect = h("select", { "aria-label": "Filter by tag" });
  const timeSelect = h(
    "select",
    { "aria-label": "Maximum total time" },
    h("option", { value: "" }, "Any time"),
    h("option", { value: "30" }, "\u2264 30 min"),
    h("option", { value: "45" }, "\u2264 45 min"),
    h("option", { value: "60" }, "\u2264 1 h")
  );

  function numberInput(label) {
    return h("input", {
      type: "number",
      min: 1,
      step: 1,
      placeholder: label,
      "aria-label": label === "Min" ? "Minimum servings" : "Maximum servings",
      style: "width:5.5rem;",
    });
  }
  const minYieldInput = numberInput("Min");
  const maxYieldInput = numberInput("Max");

  const sortSelect = h(
    "select",
    { "aria-label": "Sort recipes" },
    h("option", { value: "title" }, "Title A to Z"),
    h("option", { value: "newest" }, "Newest first"),
    h("option", { value: "oldest" }, "Oldest first"),
    h("option", { value: "rating" }, "Highest rating"),
    h("option", { value: "time" }, "Quickest first")
  );
  sortSelect.value = filters.sort;

  function rebuildTagOptions() {
    const current = tagSelect.value;
    tagSelect.textContent = "";
    tagSelect.append(h("option", { value: "" }, "All tags"));
    for (const tag of distinctTags(getState().recipes)) {
      tagSelect.append(h("option", { value: tag.toLowerCase() }, tag));
    }
    tagSelect.value = [...tagSelect.options].some((o) => o.value === current)
      ? current
      : "";
  }

  // ---- pantry mode -------------------------------------------------------------

  const pantryInput = h("textarea", {
    placeholder: "One ingredient per line, e.g.\nflour\neggs\nolive oil",
    "aria-label": "Ingredients you have, one per line",
    style: "margin-bottom:12px;",
  });
  const pantryResults = h("div", {});

  function renderPantryResults() {
    pantryResults.textContent = "";
    const names = String(pantryInput.value || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (!names.length) {
      pantryResults.append(h("p", { class: "field-hint" }, "List what you have above, then choose Find."));
      return;
    }
    const ranked = whatCanIMake(getState().recipes, names).filter((r) => r.matched > 0);
    if (!ranked.length) {
      pantryResults.append(
        h("p", {}, "Nothing matches yet. Add one or two more ingredients and try again.")
      );
      return;
    }
    const list = h("ul", {});
    for (const entry of ranked.slice(0, PANTRY_RESULT_LIMIT)) {
      list.append(
        h(
          "li",
          { style: "padding:8px 0;border-bottom:1px solid var(--pf-line,#e4dcce);" },
          h("a", { href: "#/recipe/" + encodeURIComponent(entry.recipe.id) }, entry.recipe.title || "Untitled recipe"),
          " ",
          h("span", { class: "chip" }, "uses " + entry.matched + " of your ingredients"),
          entry.missing.length
            ? h("span", { class: "prep" }, " missing: " + entry.missing.join(", "))
            : h("span", { class: "prep" }, " you have everything")
        )
      );
    }
    pantryResults.append(list);
  }

  const pantrySection = h(
    "details",
    { class: "no-print", style: "margin:24px 0;padding:16px;border:1px solid var(--pf-line,#e4dcce);border-radius:8px;background:var(--pf-surface,#ffffff);" },
    h("summary", { style: "cursor:pointer;font-weight:600;" }, "What can I make with these?"),
    h("div", { style: "margin-top:16px;" },
      pantryInput,
      h("button", { class: "btn btn-primary", type: "button", onclick: renderPantryResults }, "Find recipes"),
      h("div", { style: "margin-top:16px;", role: "region", "aria-live": "polite" }, pantryResults)
    )
  );

  // ---- results -----------------------------------------------------------------

  const statusLine = h("p", { role: "status", "aria-live": "polite", class: "field-hint" });
  const resultsRegion = h("div", {});

  function applyFilters() {
    const query = {
      terms: filters.q.split(/\s+/),
      tag: filters.tag || undefined,
      maxTotalMinutes: filters.maxTime ? Number(filters.maxTime) : undefined,
      minYield: filters.minYield != null ? filters.minYield : undefined,
      maxYield: filters.maxYield != null ? filters.maxYield : undefined,
    };
    let list = getState().recipes.filter((r) => matchesQuery(r, query));

    const byTitle = (a, b) => String(a.title ?? "").localeCompare(String(b.title ?? ""));
    switch (filters.sort) {
      case "newest":
        list = list.slice().sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")) || byTitle(a, b));
        break;
      case "oldest":
        list = list.slice().sort((a, b) => String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")) || byTitle(a, b));
        break;
      case "rating":
        list = list.slice().sort((a, b) => (Number(b.rating) || 0) - (Number(a.rating) || 0) || byTitle(a, b));
        break;
      case "time":
        list = list.slice().sort((a, b) => {
          const ta = hasAnyTime(a) ? totalMinutes(a) : Number.POSITIVE_INFINITY;
          const tb = hasAnyTime(b) ? totalMinutes(b) : Number.POSITIVE_INFINITY;
          return ta - tb || byTitle(a, b);
        });
        break;
      default:
        list = list.slice().sort(byTitle);
    }
    return list;
  }

  function clearFilters() {
    debouncedSearch.cancel();
    filters.q = "";
    filters.tag = "";
    filters.maxTime = "";
    filters.minYield = null;
    filters.maxYield = null;
    searchInput.value = "";
    tagSelect.value = "";
    timeSelect.value = "";
    minYieldInput.value = "";
    maxYieldInput.value = "";
    renderResults();
    searchInput.focus();
  }

  function renderResults() {
    resultsRegion.textContent = "";
    const all = getState().recipes;

    if (all.length === 0) {
      statusLine.textContent = "";
      resultsRegion.append(
        h(
          "section",
          { class: "empty-state" },
          h("h2", { class: "empty-state__title" }, "Nothing here yet."),
          h("p", {}, "Your cookbook is waiting for its first page."),
          h(
            "div",
            { style: "display:flex;gap:12px;justify-content:center;flex-wrap:wrap;" },
            h("a", { class: "btn btn-primary", href: "#/recipe/new" }, "Add your first recipe"),
            h("button", { class: "btn", type: "button", onclick: () => { seedSamples(); } }, "Load 10 sample recipes")
          )
        )
      );
      return;
    }

    const list = applyFilters();
    const count = list.length;
    statusLine.textContent =
      count === 1 ? "1 recipe" : count + " recipes";

    if (count === 0) {
      resultsRegion.append(
        h(
          "section",
          { class: "empty-state" },
          h("h2", { class: "empty-state__title" }, "No recipes match."),
          h("p", {}, "Try removing a filter or shortening your search."),
          h("button", { class: "btn", type: "button", onclick: clearFilters }, "Clear filters")
        )
      );
      return;
    }

    const ul = h("ul", { style: "list-style:none;margin:0;padding:0;" });
    for (const recipe of list) ul.append(recipeCard(recipe));
    resultsRegion.append(ul);
  }

  const debouncedSearch = debounce(() => {
    filters.q = searchInput.value.trim();
    renderResults();
  }, SEARCH_DEBOUNCE_MS);

  searchInput.addEventListener("input", debouncedSearch);

  tagSelect.addEventListener("change", () => {
    debouncedSearch.cancel();
    filters.tag = tagSelect.value;
    renderResults();
  });
  timeSelect.addEventListener("change", () => {
    debouncedSearch.cancel();
    filters.maxTime = timeSelect.value;
    renderResults();
  });
  const yieldChange = () => {
    debouncedSearch.cancel();
    const min = parseInt(minYieldInput.value, 10);
    const max = parseInt(maxYieldInput.value, 10);
    filters.minYield = Number.isInteger(min) && min > 0 ? min : null;
    filters.maxYield = Number.isInteger(max) && max > 0 ? max : null;
    renderResults();
  };
  minYieldInput.addEventListener("change", yieldChange);
  maxYieldInput.addEventListener("change", yieldChange);
  sortSelect.addEventListener("change", () => {
    debouncedSearch.cancel();
    filters.sort = sortSelect.value;
    renderResults();
  });

  const toolbar = h(
    "div",
    {
      class: "no-print",
      style: "display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin:24px 0 8px;",
    },
    h("div", { style: "flex:2 1 240px;" }, searchInput),
    h("div", { style: "flex:1 1 130px;" }, tagSelect),
    h("div", { style: "flex:1 1 130px;" }, timeSelect),
    minYieldInput,
    maxYieldInput,
    h("span", { "aria-hidden": "true", class: "prep" }, "serves"),
    h("div", { style: "flex:1 1 150px;" }, sortSelect),
    h("a", { class: "btn btn-primary", href: "#/recipe/new" }, "New recipe")
  );

  container.append(toolbar, pantrySection, statusLine, resultsRegion);

  rebuildTagOptions();
  renderPantryResults();
  renderResults();

  unsubscribe = subscribe(() => {
    rebuildTagOptions();
    renderResults();
    if (pantrySection.open) renderPantryResults();
  });

  return function cleanup() {
    if (unsubscribe) unsubscribe();
    debouncedSearch.cancel();
  };
}
