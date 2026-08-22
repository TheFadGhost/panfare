import { describe, it, expect, vi, afterEach } from "vitest";
import {
  STORAGE_KEY,
  createStore,
  defaultState,
  updateSettings,
} from "../src/core/store.mjs";
import { assignSlot } from "../src/core/planner.mjs";

function mapStorage() {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

const soup = {
  id: "r_soup",
  title: "Soup",
  yield: { serves: 4 },
  times: { prep: 10, cook: 30, extra: [] },
  ingredients: [],
  steps: [],
  notes: null,
  tags: [],
  source: { url: null, title: null, author: null },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createStore basics", () => {
  it("exposes the contract storage key", () => {
    expect(STORAGE_KEY).toBe("panfare.v1");
  });

  it("rejects a storage backend without getItem/setItem", () => {
    expect(() => createStore({})).toThrow(TypeError);
  });

  it("load on empty storage returns defaults", () => {
    const store = createStore(mapStorage());
    expect(store.load()).toEqual({
      recipes: [],
      plan: null,
      settings: { unitsSystem: null, theme: "system", staples: null },
      meta: { schemaVersion: 1 },
    });
  });

  it("save then load round-trips state exactly", () => {
    const storage = mapStorage();
    const store = createStore(storage);
    const emptyPlan = {
      days: ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"].map(
        (label) => ({ label, slots: [] })
      ),
      slots: [],
    };
    const plan = assignSlot(emptyPlan, 0, null, { recipeId: "r_soup", servings: 4 });
    const state = {
      recipes: [soup],
      plan,
      settings: { unitsSystem: "metric", theme: "dark", staples: ["salt"] },
      meta: { schemaVersion: 1 },
    };
    store.save(state);
    expect(JSON.parse(storage.map.get(STORAGE_KEY))).toEqual(state);
    expect(store.load()).toEqual(state);
  });
});

describe("corruption recovery", () => {
  it("resets to defaults and warns exactly once across repeated loads", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const storage = mapStorage();
    storage.setItem(STORAGE_KEY, "{not json!!");
    const store = createStore(storage);
    const first = store.load();
    const second = store.load();
    expect(first).toEqual(defaultState());
    expect(second).toEqual(defaultState());
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("unreadable");
  });

  it("merges partial stored objects over defaults instead of crashing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const storage = mapStorage();
    storage.setItem(STORAGE_KEY, JSON.stringify({ recipes: [soup], settings: { theme: "dark" } }));
    const state = createStore(storage).load();
    expect(state.recipes).toEqual([soup]);
    expect(state.plan).toBe(null);
    expect(state.settings).toEqual({ unitsSystem: null, theme: "dark", staples: null });
    expect(state.meta).toEqual({ schemaVersion: 1 });
    // malformed plan resets without breaking load
    storage.setItem(STORAGE_KEY, JSON.stringify({ plan: { days: "nope" } }));
    expect(createStore(storage).load()).toEqual(defaultState());
  });

  it("a fresh store instance warns again for still-corrupt data", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const storage = mapStorage();
    storage.setItem(STORAGE_KEY, "]]]");
    createStore(storage).load();
    createStore(storage).load();
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

describe("updateSettings", () => {
  it("patches immutably — input state untouched", () => {
    const before = defaultState();
    const snapshot = JSON.parse(JSON.stringify(before));
    const next = updateSettings(before, { unitsSystem: "imperial" });
    expect(next.settings).toEqual({ unitsSystem: "imperial", theme: "system", staples: null });
    expect(before).toEqual(snapshot);
    expect(next).not.toBe(before);
    expect(next.settings).not.toBe(before.settings);
  });
});

describe("backup export/import", () => {
  const state = {
    recipes: [soup],
    plan: null,
    settings: { unitsSystem: "metric", theme: "light", staples: ["olive oil"] },
    meta: { schemaVersion: 1 },
  };

  it("exportBackup produces the documented envelope", () => {
    let iso = "";
    const store = createStore(mapStorage(), { now: () => (iso = "2026-08-23T12:00:00.000Z") });
    const backup = JSON.parse(store.exportBackup(state));
    expect(backup.app).toBe("panfare");
    expect(backup.version).toBe(1);
    expect(backup.exportedAt).toBe(iso);
    expect(backup.data).toEqual(state);
  });

  it("importBackup replace returns the validated backup data", () => {
    const store = createStore(mapStorage(), { now: () => "2026-08-23T12:00:00.000Z" });
    const restored = store.importBackup(store.exportBackup(state), "replace");
    expect(restored).toEqual({ ...state, meta: { schemaVersion: 1 } });
  });

  it("importBackup merge unions recipes by id with newer updatedAt winning both ways", () => {
    const store = createStore(mapStorage(), { now: () => "2026-08-23T12:00:00.000Z" });
    const older = { ...soup, id: "r_old", updatedAt: "2026-01-01T00:00:00.000Z" };
    const newerInCurrent = { ...soup, id: "r_keep", title: "Current wins", updatedAt: "2026-06-01T00:00:00.000Z" };

    const currentState = {
      recipes: [newerInCurrent, { ...older }],
      plan: null,
      settings: { unitsSystem: null, theme: "dark", staples: null },
      meta: { schemaVersion: 1 },
    };
    const backupState = {
      recipes: [
        { ...older, title: "Backup wins", updatedAt: "2026-05-01T00:00:00.000Z" },
        newerInCurrent, // stale copy of r_keep
        { ...soup, id: "r_new", updatedAt: "2026-07-01T00:00:00.000Z" },
      ],
      plan: null,
      settings: { unitsSystem: "metric", theme: "light", staples: [] },
      meta: { schemaVersion: 1 },
    };

    const merged = store.importBackup(store.exportBackup(backupState), "merge", currentState);
    const byId = new Map(merged.recipes.map((r) => [r.id, r]));
    expect(byId.size).toBe(3); // r_old + r_keep + r_new
    expect(byId.get("r_old").title).toBe("Backup wins"); // backup is newer
    expect(byId.get("r_keep").title).toBe("Current wins"); // current is newer
    expect(byId.get("r_new").title).toBe("Soup"); // unioned in from backup
    expect(merged.settings).toEqual(backupState.settings); // replaced wholesale
  });

  it("importBackup throws Error('not-a-panfare-backup') on wrong shapes", () => {
    const store = createStore(mapStorage());
    for (const bad of [
      "",
      "not json at all",
      "42",
      JSON.stringify({ app: "otherapp", version: 1, data: {} }),
      JSON.stringify({ app: "panfare", version: 2, data: {} }),
      JSON.stringify({ app: "panfare", version: 1 }),
      JSON.stringify({ app: "panfare", version: 1, data: "string not object" }),
    ]) {
      expect(() => store.importBackup(bad, "replace")).toThrowError("not-a-panfare-backup");
    }
  });
});

describe("quota passthrough", () => {
  class QuotaExceededError extends Error {
    constructor() {
      super("storage quota exceeded");
      this.name = "QuotaExceededError";
    }
  }

  it("save() lets setItem quota errors surface unchanged", () => {
    const failing = {
      getItem: () => null,
      setItem: () => {
        throw new QuotaExceededError();
      },
      removeItem: () => {},
    };
    const store = createStore(failing);
    expect(() => store.save(defaultState())).toThrow(QuotaExceededError);
    try {
      store.save(defaultState());
      expect.unreachable("save should have thrown");
    } catch (err) {
      expect(err.name).toBe("QuotaExceededError");
    }
  });
});
