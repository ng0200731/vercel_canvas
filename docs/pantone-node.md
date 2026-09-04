# Pantone Node

The **Pantone** node is a canvas node that lets users look up branded Pantone
color swatches (name, code, HEX, RGB) and reference them downstream via an
`@alias`. It loads its color libraries at runtime from vendored JSON datasets
and does fuzzy/structured matching on free-text queries (e.g. `Red 032 C`,
`Red032C`, `032`, `17-5641`).

## Source files

| File | Role |
| --- | --- |
| [`components/canvas/nodes/pantone-node.tsx`](components/canvas/nodes/pantone-node.tsx) | Node UI: alias, catalog filter, search, swatch card, matches list, copy HEX |
| [`lib/nodes/pantone.ts`](lib/nodes/pantone.ts) | Data loading, parsing, normalization, and fuzzy scoring/lookup |
| [`public/data/pantone-colors.README.md`](public/data/pantone-colors.README.md) | Provenance + licensing notes for the vendored datasets |
| [`lib/nodes/types.ts`](lib/nodes/types.ts) | `PantoneCanvasNode` data shape |
| [`lib/nodes/palette.test.ts`](lib/nodes/palette.test.ts), [`lib/nodes/pantone.test.ts`](lib/nodes/pantone.test.ts) | Tests |

## Data sources (GitHub)

The node's `PANTONE_DATA_SOURCES` map and README record the upstream
datasets. The two GitHub-hosted community sources are:

| Catalog | GitHub link | Used for |
| --- | --- | --- |
| Fashion + Home TCX (FHI TCX) | [github.com/Margaret2/pantone-colors](https://github.com/Margaret2/pantone-colors/blob/master/pantone-numbers.json) | `pantone-colors.json` (the `fhi-tcx` catalog, non-optional) |
| Solid Coated (Lab/CSV) | [github.com/aj90909/unofficial-pantone-solid-coated-2024-v5](https://github.com/aj90909/unofficial-pantone-solid-coated-2024-v5/blob/main/colors.csv) | Larger Solid Coated Lab/ACB source (optional) |

Other (non-GitHub) parsed sources referenced in the README:

- `pantone-solid-coated.json` — parsed from Webtemple's "All Pantone C colors
  with HEX and RGB codes": https://webtemple.design/resources/all-pantone-c-colors-with-hex-and-rgb-codes
- `pantone-solid-uncoated.json` — parsed from a public Solid Uncoated HEX/RGB
  table: https://force4u.cocolog-nifty.com/skywalker/2009/09/pantone-u-panto.html

> ⚠️ The README explicitly notes these are **approximate web HEX values**, not
> official print-critical Pantone matches. Optional licensed libraries
> (`fhi-tpg`, `metallics-coated`, `premium-metallics-coated`,
> `pastels-neons-*`, `color-bridge-*`) are checked in as empty arrays (`[]`)
> and must be replaced with licensed data before use.

## Node behavior

- **Libraries**: 10 catalogs (`solid-coated`, `solid-uncoated`, `fhi-tcx`,
  `fhi-tpg`, `metallics-coated`, `premium-metallics-coated`,
  `pastels-neons-coated`, `pastels-neons-uncoated`, `color-bridge-coated`,
  `color-bridge-uncoated`). Only `solid-coated` and `fhi-tcx` are required
  (`optional: false`); the rest fall back to `[]` on a 404.
- **Loading**: `loadPantoneColors()` fetches every catalog JSON, parses it
  (record vs. array schema per `format`), flattens, caches the result, and
  sorts by catalog order then code.
- **Query parsing**: `normalizePantoneQuery()` strips the `PANTONE` token and
  C/U/TCX/TPG/TPN suffixes, and extracts FHI codes (`dd-dddd` or `dddddd` →
  `dd-dddd`).
- **Matching**: `findPantoneColor()` does exact-code → exact-name → scored
  fuzzy search (`searchPantoneColors()`). Scoring uses token equality,
  prefix/substring, Levenshtein distance (with a length-based tolerance), and
  ordered-subsequence fallbacks, plus small boosts for explicit `c`/`u`/`tcx`/
  `tpg` catalog hints.
- **UI**: alias input, catalog-filter dropdown (per-catalog or "All"), a search
  box, a large swatch preview card (code / display name / catalog / HEX + RGB),
  a copy-HEX button, and an expandable "Matches" list of up to 5 suggestions.
- **Output**: emits a color reference via `OutputPort` and an `@alias` (default
  `pantone`) so downstream Generate/G2 nodes can resolve the swatch in prompts.
