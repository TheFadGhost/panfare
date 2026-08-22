// setup.mjs — integration wiring for entry points (browser app, tools).
// The importer takes the ingredient parser via injection so it can be
// tested in isolation; production code calls this once at boot.
import { parseIngredientLine } from "./parser.mjs";
import { setIngredientParser } from "./importer.mjs";

let wired = false;

export function wireCore() {
  if (!wired) {
    setIngredientParser(parseIngredientLine);
    wired = true;
  }
}
