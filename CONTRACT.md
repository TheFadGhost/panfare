# CONTRACT.md — Panfare shared data model and module APIs

Every module codes against this. Nothing converts a quantity to a float, anywhere.

## Fraction (src/core/fraction.mjs)

`makeFraction(n, d=1)` returns `{n, d}` reduced, `d > 0`. Arithmetic: `add sub mul div neg abs`,
comparison `cmp eq lt gt`, helpers `floorFrac`, `nearestWithDenominator(frac, maxDen)`,
parsing `fromString("3/4"|"-1.5")`, `fromDecimalString`. Constants `ZERO ONE`.
Errors: `FractionOverflowError`, `DivisionByZeroError`, `MalformedFractionError`.
Fractions are plain `{n, d}` objects and serialize to JSON directly.

## Units (src/core/units.mjs)

Canonical unit ids: `ml l tsp tbsp floz cup pint quart gallon mg g kg oz lb each clove slice
sprig leaf stick can packet bunch head fillet rasher pinch dash handful`.
- `resolveUnit(token)` — human token → id or **null** (never guesses).
- `registerCountUnit(word)` — ad-hoc countable ("wedge").
- `convert(amount, fromId, toId)` — exact, throws across dimensions/countables.
- `tryConvert(...)` — `{ok:true,value}|{ok:false,reason}` where reason ∈ `unknown-unit |
  different-dimension | different-count-unit`.
- `convertWithDensity(amount, fromId, toId, density)` — volume↔mass only, refuses otherwise.
- `lookupDensity(normalizedName)` — `{density, note}` or null. Densities are approximations;
  anything converted with them must be displayed with the ≈ marker.
- `dimensionOf(id)` ∈ `volume mass count`.

## Formatting (src/core/format.mjs)

- `formatQuantity({amount,unit}, {system:"metric"|"imperial"|null})` →
  `{text, html, aria, unitId, approx}` — e.g. `½ cup`, `150 ml`, `13⁄16 lb`; `aria` is spoken
  form ("one and a half cups"); `approx` true ⇒ prefix `≈`.
- `formatScalar(frac)` / `formatFraction(frac)` / `formatQuantityRange(minQ,maxQ)`.
- `pickDisplayUnit(amount, unitId, {system})` → `{unitId, amount}` exact conversions only.

## Names (src/core/names.mjs)

`normalizeIngredientName(item)` → canonical lowercase singular identity ("free-range eggs" →
"egg"); `splitQualifiers(item)` → `{core, qualifiers}`. Used for merging and density lookup —
never replaces display text.

## Recipe (stored JSON, localStorage key `panfare.v1`)

```jsonc
{
  "id": "r_abc123",
  "title": "Weeknight Red Lentil Soup",
  "yield": { "serves": 4, "text": "serves 4" },
  "times": { "prep": 10, "cook": 30, "extra": [] },
  "ingredients": [
    {
      "id": "i_001",
      "raw": "1\u00BD cups red lentils, rinsed",
      "quantity": {"n":3,"d":2},
      "quantityMax": null,
      "unit": "cup",
      "item": "red lentils",
      "preparation": "rinsed",
      "substitute": null,
      "sectionOverride": null,
      "staple": false
    }
  ],
  "steps": [ { "text": "Soften the onion in the oil." } ],
  "notes": null,
  "tags": ["soup", "vegan"],
  "source": { "url": null, "title": null, "author": null },
  "rating": null,
  "history": [],
  "photo": null,
  "createdAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-01-01T00:00:00.000Z"
}
```

Rules: `quantity`/`quantityMax` are Fractions or null; `unit` is a unit id or null; lines with
null quantity never scale (they merge by name only). `source` preserves attribution — never
strip it. Times are whole minutes or null.

## Ingredient parsing result shape

`parseIngredientLine(raw)` → the ingredient object above plus
`uncertain: boolean` and `uncertaintyReason: string|null`
(reasons like `"no-quantity"`, `"unparseable-amount"`, `"ambiguous-unit"`).
Uncertain lines are still returned best-effort — never dropped, never silently guessed.

## Plan (meal planner)

```jsonc
{
  "days": [
    { "label": "Monday", "slots": [ { "recipeId": "r_abc123", "servings": 4 } ] }
    // 7 entries, Monday..Sunday
  ]
}
```

## Shopping list output shape

```jsonc
{
  "groups": [
    {
      "section": "Produce",
      "items": [
        {
          "key": "carrot",
          "displayName": "carrots",
          "quantities": [ { "amount": {"n":7,"d":1}, "unit": "each", "approx": false } ],
          "preparations": ["grated"],
          "recipeIds": ["r_a", "r_b"],
          "notes": []
        }
      ]
    }
  ],
  "hiddenStaples": 3,
  "sectionsOrder": ["Produce","Bakery","Dairy & chilled","Meat & fish","Frozen","Pantry","Spices & baking","Other"]
}
```

A merged item carries ONE quantity per display unit (usually one); two entries inside
`quantities` mean "kept separate deliberately" and the reason lives in the item's `notes`
(e.g. "no reliable cup↔gram conversion").

## Settings

```jsonc
{ "unitsSystem": null, "theme": "system", "staples": ["salt","black pepper","olive oil","butter"] }
```

`unitsSystem` null = keep each ingredient's own family; "metric"/"imperial" bridge exactly at
display time only.
