// router.mjs — hash router. Routes: #/library #/recipe/:id #/cook/:id
// #/list #/planner #/settings. Views are mount(container, params) functions
// that may return a cleanup() — invoked before the next mount (cook mode
// releases its wake lock and timers there).

import { h, clear } from "./dom.mjs";

const routes = new Map();
let cleanup = null;
let mainEl = null;

export function initRouter(main) {
  mainEl = main;
  window.addEventListener("hashchange", () => render());
  render();
}

export function registerRoute(pattern, view) {
  // pattern like "#/recipe/:id"
  routes.set(pattern, { pattern, view });
}

export function navigate(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

function matchRoute(hash) {
  const raw = hash || "#/library";
  const [path, queryString] = raw.split("?");
  const query = new URLSearchParams(queryString || "");
  for (const { pattern, view } of routes.values()) {
    const patParts = pattern.split("/");
    const pathParts = path.split("/");
    if (patParts.length !== pathParts.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < patParts.length; i++) {
      if (patParts[i].startsWith(":")) params[patParts[i].slice(1)] = decodeURIComponent(pathParts[i]);
      else if (patParts[i] !== pathParts[i]) { ok = false; break; }
    }
    if (ok) return { view, params: Object.assign(params, { query }) };
  }
  return null;
}

function render() {
  if (!mainEl) return;
  const hash = location.hash || "#/library";
  const matched = matchRoute(hash);
  if (typeof cleanup === "function") {
    try { cleanup(); } catch { /* cleanup must never block navigation */ }
  }
  cleanup = null;
  clear(mainEl);
  if (!matched) {
    mainEl.append(
      h("section", { class: "empty-state" },
        h("h2", {}, "Page not found"),
        h("p", {}, "That link doesn’t lead anywhere in the kitchen."),
        h("a", { class: "btn btn-primary", href: "#/library" }, "Back to the library"))
    );
    return;
  }
  document.body.dataset.route = matched.params && Object.keys(matched.params).length ? hash.split("/")[1] : hash.replace("#/", "");
  const result = matched.view(mainEl, matched.params);
  if (result && typeof result.catch === "function") {
    result.then((c) => { if (typeof c === "function") cleanup = c; });
  } else if (typeof result === "function") {
    cleanup = result;
  }
  window.scrollTo(0, 0);
}
