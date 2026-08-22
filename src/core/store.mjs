// store.mjs — persistence, backups and settings for Panfare's local state.
//
// Storage is injected: createStore({getItem, setItem, removeItem}). Tests pass
// a Map-based fake; the browser passes window.localStorage. Nothing touches
// storage at module scope — every access happens inside the store instance.
//
// QUOTA: save() deliberately does not catch errors from setItem(). When the
// storage quota is exceeded, the platform's QuotaExceededError propagates to
// the caller unchanged — the UI decides how to message it.

import { planFromJson } from "./planner.mjs";

export const STORAGE_KEY = "panfare.v1";
const SCHEMA_VERSION = 1;

export function defaultState() {
  return {
    recipes: [],
    plan: null,
    settings: { unitsSystem: null, theme: "system", staples: null },
    meta: { schemaVersion: SCHEMA_VERSION },
  };
}

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function sanitizeSettings(raw) {
  const src = isPlainObject(raw) ? raw : {};
  const unitsSystem =
    src.unitsSystem === "metric" || src.unitsSystem === "imperial" ? src.unitsSystem : null;
  const theme = typeof src.theme === "string" && src.theme.length > 0 ? src.theme : "system";
  const staples = Array.isArray(src.staples)
    ? src.staples.filter((s) => typeof s === "string")
    : null;
  return { unitsSystem, theme, staples };
}

function sanitizeState(raw) {
  if (!isPlainObject(raw)) return defaultState();
  const recipes = Array.isArray(raw.recipes)
    ? raw.recipes.filter((r) => isPlainObject(r) && typeof r.id === "string")
    : [];
  let plan = null;
  if (isPlainObject(raw.plan)) {
    try {
      plan = planFromJson(raw.plan);
    } catch (err) {
      console.warn("[panfare] stored meal plan was malformed and has been reset.", err?.message ?? err);
      plan = null;
    }
  }
  return {
    recipes,
    plan,
    settings: sanitizeSettings(raw.settings),
    meta: { schemaVersion: SCHEMA_VERSION },
  };
}

/**
 * Build a store bound to the given injectable storage backend.
 * `now` is an optional ISO-timestamp factory (tests inject a fixed one).
 */
export function createStore(storage, { now = () => new Date().toISOString() } = {}) {
  if (
    !storage ||
    typeof storage.getItem !== "function" ||
    typeof storage.setItem !== "function"
  ) {
    throw new TypeError("storage must provide getItem and setItem");
  }

  let warnedCorruption = false;

  function warnCorrupt(reason) {
    if (warnedCorruption) return;
    warnedCorruption = true;
    console.warn(
      "[panfare] stored data at key \"" + STORAGE_KEY + "\" was unreadable (" +
        reason + "); resetting to defaults."
    );
  }

  /**
   * Read state from storage. Always returns a valid state object:
   * missing key → defaults; corrupted JSON → defaults plus exactly one
   * console.warn per store instance; partial data merged over defaults.
   */
  function load() {
    let raw;
    try {
      raw = storage.getItem(STORAGE_KEY);
    } catch (err) {
      warnCorrupt("storage read failed: " + String(err));
      return defaultState();
    }
    if (raw == null) return defaultState();
    let parsed;
    try {
      parsed = JSON.parse(String(raw));
    } catch (err) {
      warnCorrupt(err instanceof Error ? err.message : String(err));
      return defaultState();
    }
    return sanitizeState(parsed);
  }

  /**
   * Persist the whole state as one JSON document under STORAGE_KEY.
   * Serialization errors from setItem (notably QuotaExceededError on quota
   * exhaustion) are NOT caught — they propagate to the UI layer.
   */
  function save(state) {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  /** Human-readable backup envelope as a JSON string. */
  function exportBackup(state) {
    return JSON.stringify({
      app: "panfare",
      version: 1,
      exportedAt: now(),
      data: state,
    });
  }

  function updatedAtOf(recipe) {
    const t =
      recipe && typeof recipe.updatedAt === "string" ? Date.parse(recipe.updatedAt) : NaN;
    return Number.isNaN(t) ? -Infinity : t;
  }

  /**
   * Validate a backup string and turn it into app state.
   *   mode "replace" — the backup becomes the whole state.
   *   mode "merge"   — recipes unioned by id with the current state (newer
   *                    updatedAt wins per id), settings replaced by the
   *                    backup's, plan taken from the backup when present.
   * Anything that does not parse or lacks the panfare envelope shape throws
   * Error("not-a-panfare-backup"). currentState defaults to defaults().
   */
  function importBackup(str, mode = "replace", currentState) {
    let parsed;
    try {
      parsed = JSON.parse(str);
    } catch (err) {
      throw new Error("not-a-panfare-backup");
    }
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      parsed.app !== "panfare" ||
      parsed.version !== 1 ||
      !isPlainObject(parsed.data)
    ) {
      throw new Error("not-a-panfare-backup");
    }
    const incoming = sanitizeState(parsed.data);

    if (mode === "merge") {
      const base = currentState ? sanitizeState(currentState) : defaultState();
      const byId = new Map();
      for (const recipe of base.recipes) byId.set(recipe.id, recipe);
      for (const recipe of incoming.recipes) {
        const existing = byId.get(recipe.id);
        if (!existing || updatedAtOf(recipe) > updatedAtOf(existing)) {
          byId.set(recipe.id, recipe);
        }
      }
      return {
        recipes: [...byId.values()],
        plan: incoming.plan ?? base.plan,
        settings: incoming.settings,
        meta: { schemaVersion: SCHEMA_VERSION },
      };
    }

    return incoming;
  }

  return { load, save, exportBackup, importBackup };
}

/** Immutable settings patch: returns a NEW state, input untouched. */
export function updateSettings(state, patch) {
  return {
    ...state,
    settings: { ...state.settings, ...patch },
  };
}
