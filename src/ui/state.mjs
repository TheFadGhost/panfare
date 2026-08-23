// state.mjs — single app store over localStorage, with pub/sub.

import { createStore } from "../core/store.mjs";
import { wireCore } from "../core/setup.mjs";
import samples from "../../data/sampleRecipes.json" with { type: "json" };

wireCore();

const localStorageAdapter = {
  getItem: (k) => window.localStorage.getItem(k),
  setItem: (k, v) => window.localStorage.setItem(k, v),
  removeItem: (k) => window.localStorage.removeItem(k),
};

const persistence = createStore(localStorageAdapter);

let state = persistence.load();

const listeners = new Set();

export function getState() {
  return state;
}

export function setState(next) {
  state = next;
  try {
    persistence.save(state);
  } catch (err) {
    // quota exceeded: keep working in-memory; surface via event
    window.dispatchEvent(new CustomEvent("panfare:quota", { detail: String(err) }));
  }
  for (const fn of listeners) fn(state);
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ---- recipes ---------------------------------------------------------------

export function upsertRecipe(recipe) {
  const now = new Date().toISOString();
  const withStamp = { ...recipe, updatedAt: now };
  const existing = state.recipes.findIndex((r) => r.id === recipe.id);
  let recipes;
  if (existing >= 0) {
    recipes = state.recipes.slice();
    recipes[existing] = withStamp;
  } else {
    recipes = [withStamp, ...state.recipes];
  }
  setState({ ...state, recipes });
  return withStamp;
}

export function deleteRecipe(id) {
  setState({
    ...state,
    recipes: state.recipes.filter((r) => r.id !== id),
  });
}

export function getRecipe(id) {
  return state.recipes.find((r) => r.id === id) || null;
}

/** First-run helper: copies the bundled original sample set into the library. */
export function seedSamples() {
  const now = new Date().toISOString();
  const existing = new Set(state.recipes.map((r) => r.id));
  const additions = samples
    .filter((r) => !existing.has(r.id))
    .map((r) => ({ ...r, createdAt: r.createdAt || now, updatedAt: now }));
  if (additions.length) {
    setState({ ...state, recipes: [...additions, ...state.recipes] });
  }
  return additions.length;
}

// ---- per-recipe UI memory (not persisted except checks) ---------------------

const scaleMemory = new Map(); // recipeId -> Fraction

export function getScale(recipeId) {
  return scaleMemory.get(recipeId) || null;
}

export function setScale(recipeId, factor) {
  scaleMemory.set(recipeId, factor);
}

export function getListChecks() {
  return state.listChecks || {};
}

export function toggleListCheck(key) {
  const checks = { ...(state.listChecks || {}) };
  if (checks[key]) delete checks[key];
  else checks[key] = true;
  setState({ ...state, listChecks: checks });
}

export function resetListChecks() {
  setState({ ...state, listChecks: {} });
}

// ---- settings ----------------------------------------------------------------

export function updateSettings(patch) {
  setState({ ...state, settings: { ...state.settings, ...patch } });
}

// ---- backup --------------------------------------------------------------------

export function exportBackup() {
  return persistence.exportBackup(state);
}

export function importBackup(text, mode) {
  const next = persistence.importBackup(text, mode);
  setState(next);
}
