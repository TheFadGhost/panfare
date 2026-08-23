// app.mjs — entry point: theme boot, route registration, global shortcuts.

import { applyTheme, preferredTheme, THEME_NAMES } from "../styles/tokens.mjs";
import { getState, subscribe } from "./state.mjs";
import { initRouter, registerRoute } from "./router.mjs";
import { libraryView } from "./views/library.mjs";
import { recipeView } from "./views/recipeView.mjs";
import { recipeForm } from "./views/recipeForm.mjs";
import { cookView } from "./views/cookMode.mjs";
import { listView } from "./views/listView.mjs";
import { plannerView } from "./views/plannerView.mjs";
import { settingsView } from "./views/settingsView.mjs";

function resolveTheme(setting) {
  if (THEME_NAMES.includes(setting)) return setting;
  return preferredTheme();
}

function boot() {
  const settings = getState().settings || {};
  applyTheme(resolveTheme(settings.theme));
  subscribe((s) => applyTheme(resolveTheme((s.settings || {}).theme)));

  // literal segments must register before the parameterised route so
  // "#/recipe/new" is not swallowed by "#/recipe/:id"
  registerRoute("#/recipe/new", (container) => recipeForm(container, { id: "new" }));
  registerRoute("#/recipe/edit/:id", (container, params) =>
    recipeForm(container, { id: "edit:" + params.id }));
  registerRoute("#/library", libraryView);
  registerRoute("#/recipe/:id", recipeView);
  registerRoute("#/cook/:id", cookView);
  registerRoute("#/list", listView);
  registerRoute("#/planner", plannerView);
  registerRoute("#/settings", settingsView);
  initRouter(document.getElementById("main"));

  // Storage-full banner: quota errors are broadcast by state; without a
  // listener users would keep editing while every change silently failed.
  const quotaBanner = document.createElement("div");
  quotaBanner.className = "banner-error";
  quotaBanner.setAttribute("role", "alert");
  quotaBanner.hidden = true;
  quotaBanner.textContent =
    "Changes could not be saved — storage is full. Export a backup from Settings and remove some photos or recipes.";
  document.body.append(quotaBanner);
  window.addEventListener("panfare:quota", () => {
    quotaBanner.hidden = false;
  });

  // Global keyboard shortcuts (input-safe). Full list behind "?".
  document.addEventListener("keydown", (e) => {
    const target = e.target;
    const typing =
      target &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable);
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "?") {
      import("./views/shortcutsOverlay.mjs").then((m) => m.showShortcuts());
      e.preventDefault();
      return;
    }
    if (e.key === "/") {
      const search = document.querySelector("[data-shortcut-search]");
      if (search) { search.focus(); e.preventDefault(); }
      return;
    }
    const map = {
      g: "#/library",
      l: "#/list",
      p: "#/planner",
      s: "#/settings",
    };
    if (map[e.key]) {
      location.hash = map[e.key];
      e.preventDefault();
    }
  });

  const swSupported =
    "serviceWorker" in navigator &&
    (location.protocol === "https:" || location.hostname === "localhost");
  if (swSupported) {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* offline support is best-effort */
    });
  }

  window.dispatchEvent(new CustomEvent("panfare:ready"));
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
