# FOODSCAPE — Phased Build Plan

> A version of [isometric.nyc](https://isometric.nyc/) where each block is the **real
> building** at that spot — its actual massing, silhouette, floor count, roofline — but
> **re-skinned in the signature food** of the best restaurant there: a real Soho townhouse
> rebuilt out of sushi, a real terrace re-skinned as spaghetti, a real arch made of tacos.
> Rendered in one coherent **retro pixel-art isometric** style — the isometric.nyc look:
> crisp pixel grid, dithered shading, limited palette, hard pixel edges (NOT smooth 3D/clay).
> **City: London.**
>
> Sponsors: **Google DeepMind** (Nano Banana + Gemini agent) · **Tavily** (live web) · **ElevenLabs** (voice).
> Stack: Next.js (App Router, src dir, TS, Tailwind) on Vercel. Persistence: **Vercel Blob**.
>
> **Framing: an AUTONOMOUS AGENT.** Foodscape is not a one-shot generator — it's a
> standing agent that keeps the food-city current: on a loop it re-runs Tavily web
> search for each district's best restaurants, diffs against what it already built,
> and regenerates only the tiles that changed (new top spot, closed restaurant,
> new signature dish). The map is a living view of the agent's latest world model.

---

## The three pillars

**1. Real buildings, food-skinned, one pixel style (the core trick).**
Two locks, applied to every tile:
- **Form lock = the real building.** Each tile reproduces the ACTUAL building at that
  London coordinate — its real massing, height/floor count, roofline, footprint shape. We
  derive that form from a real-world reference (OSM building footprint + height, and/or a
  map/street reference image of the actual structure) and feed it into Nano Banana so the
  silhouette stays true. The building is recognizably *that* building.
- **Style lock = retro pixel-art isometric.** Gen one **style anchor** tile that locks the
  isometric.nyc look: fixed 2:1 isometric angle, pixel grid, dithered shading, limited
  retro palette, hard pixel edges, transparent bg — explicitly NOT smooth 3D / clay /
  soft-render. Feed that anchor image into EVERY call.

So each Nano Banana call varies only: `{real_building_reference}` (the form to preserve) +
`{food_material}` (what to re-skin it as). Style + camera stay locked by the anchor.
Composite transparent tiles onto an isometric grid in-browser. → N real buildings, one
food-pixel world.

**2. JARVIS — the floating light orb (Clippy reborn).**
A glowing orb in the corner you talk to. Voice in → intent out. It can:
- "Take me to Soho" → moves the London map / camera to that district.
- "Find me ramen" → queries ClickHouse for ramen buildings, flies camera to them, highlights.
- "What's the best spot here?" → reads the building blurb aloud (ElevenLabs).
It is the ElevenLabs sponsor surface AND the navigation UX. Pipeline:
`mic → STT → intent (Gemini) → action (move map / query the Blob store) → ElevenLabs TTS reply`.

**3. THE AUTONOMOUS REFRESH AGENT (what makes it an agent, not a generator).**
A Gemini-driven loop that keeps the city true to the real world without a human:
- On a schedule (Vercel Cron) or on demand, the agent re-runs **Tavily** web search
  for the best restaurants in each district (Phase 2 pipeline).
- It **diffs** the fresh specs against the last persisted snapshot in **Blob**:
  new top spot, a restaurant that dropped off, a changed signature dish.
- For each changed cell it **regenerates only that tile** (Nano Banana) and updates
  the snapshot — the map mutates in place. Unchanged tiles are left alone (cost + speed).
- JARVIS narrates what changed ("Kiln overtook Bao on Brewer Street") via ElevenLabs.
Loop: `cron/trigger → Tavily refresh → diff vs Blob snapshot → regen changed tiles → update Blob → notify`.

---

## Pipeline (data flow)

```
area pick (London district) → TAVILY restaurants (name, cuisine, signature dish, address)
  → REAL BUILDING ref per address (OSM footprint + height, and/or map/street ref image)
  → GEMINI building specs (food_material + real-form descriptor + grid cell)
  → NANO BANANA tile gen (anchored to pixel style + conditioned on real building form)
  → isometric grid composite → BLOB store (snapshot per district: specs + tile URLs)
AGENT loop (cron/trigger): TAVILY refresh → diff vs Blob snapshot → regen changed tiles → update Blob → notify
JARVIS loop: voice → Gemini intent → Blob query / map move → ElevenLabs voice reply
```

> **Real-form source (decide in Phase 2):** OSM / Overpass building footprint + `height`
> tag (clean geometry, no API key) is the baseline; optionally a static map or street
> reference image fed to Nano Banana for richer silhouettes. The food re-skin must keep the
> real building's massing recognizable.

---

## File layout (target)

```
src/
├── app/
│   ├── page.tsx                  # landing → London food-city viewer
│   ├── api/
│   │   ├── discover/route.ts     # Tavily → restaurants → Gemini specs
│   │   ├── generate/route.ts     # Nano Banana tile gen → Blob
│   │   ├── refresh/route.ts      # AUTONOMOUS agent: Tavily refresh → diff → regen → Blob (cron target)
│   │   ├── jarvis/route.ts       # voice intent → action plan + Blob query
│   │   ├── narrate/route.ts      # ElevenLabs TTS
│   │   └── analytics/route.ts    # cuisine heatmap from Blob snapshots
├── lib/
│   ├── tavily.ts · gemini.ts · style-anchor.ts · buildings.ts · discover.ts
│   ├── elevenlabs.ts · store.ts (Vercel Blob) · agent.ts (refresh+diff) · isometric.ts
│   └── london.ts                 # London districts + bounds + grid mapping
├── components/
│   ├── CityViewer.tsx · IsometricGrid.tsx · BuildingTile.tsx
│   └── JarvisOrb.tsx             # the floating light orb + mic + voice loop
└── public/style-anchor.png
```

---

# PHASES

Walk through in order. Each phase = a demoable slice. `[ ]` = todo.

## Phase 0 — Scaffold & config  ✅ (done)
- [x] Next.js + TS + Tailwind + App Router + src dir
- [x] Install SDKs: `@google/genai`, `@tavily/core`, `@elevenlabs/elevenlabs-js`,
      `@clickhouse/client`, `@vercel/blob`, `maplibre-gl`
- [x] `.env.local` with all keys (see §Secrets) + confirm `.env.local` gitignored
- [x] `src/lib/env.ts` — typed env accessor, server-only guard
- [x] **Exit:** `npm run build` compiles clean.

## Phase 1 — Style anchor (HIGHEST RISK — do first)  ✅ (done)
Goal: prove (a) **retro pixel-art isometric** style coherence AND (b) that a tile can keep a
**real building's form** while being re-skinned in food.
- [x] `lib/gemini.ts` — `generateImage(prompt, anchorImage?)` via `gemini-2.5-flash-image`
- [x] `lib/style-anchor.ts` — `buildBuildingPrompt(realForm, foodMaterial)` + pixel-art invariants
- [x] **Restyled anchor → retro pixel-art isometric** (isometric.nyc look). v1 clay/soft-3D
      archived in `.style-test/v1-clay/`.
- [x] `buildBuildingPrompt` takes a **real-building form descriptor** + `food_material`, so the
      silhouette tracks a real structure.
- [x] Gen `public/style-anchor.png` — neutral real London brick townhouse, pixel style locked.
- [x] Throwaway script: rendered 3 real London buildings re-skinned (Soho townhouse→sushi,
      Victorian terrace→spaghetti, railway arch→tacos).
- **Exit:** ✅ All tiles share ONE pixel-iso style; each keeps its real building's form.
      Full food re-skin confirmed on spaghetti + taco. **Learning:** the re-skin prompt must
      say food replaces ALL material (not garnish) — see clause in `style-anchor.ts`. Discrete
      foods (sushi) resist becoming a whole wall and read as trim; for those, Phase 2 should
      pick a tiling `food_material` phrasing (e.g. "packed wall of sushi rolls").
      Run: `node --conditions=react-server --env-file=.env.local --import tsx scripts/test-anchor.ts`

## Phase 2 — Tavily → real building → specs  ✅ (done)
- [x] `lib/tavily.ts` — `searchRestaurants(district)` (London; raw web snippets +
      `toWebContext`). Restaurant structuring done by Gemini, not Tavily.
- [x] `lib/london.ts` — district list (Soho, Shoreditch, Camden, Mayfair, Brixton) +
      bounds + `latLngToGrid` + `claimCell` (collision-free grid).
- [x] `lib/buildings.ts` — `geocode()` (Nominatim) + `realBuildingForm(lat,lng)`
      (Overpass `way(around:35)["building"]` → storeys/footprint/roof descriptor).
      No API key. Generic fallback when no polygon within range.
- [x] `lib/gemini.ts` — `restaurantToSpec()` → Gemini structured output
      (responseSchema) `{ name, cuisine, signature_dish, address, food_material }`;
      `real_form` + `grid_x/y` + geo added by `lib/discover.ts`.
- [x] `lib/discover.ts` — orchestration (`discoverDistrict` / `specsFromWebContext`),
      shared by the route + test script.
- [x] `api/discover/route.ts` — `GET ?district=<slug>&max=N` → specs out.
- **Exit:** ✅ Ran Soho → real restaurants (Kiln, Koya, Bocca di Lupo…) + real OSM
      building forms + tiling `food_material`. Run:
      `node --conditions=react-server --env-file=.env.local --import tsx scripts/test-discover.ts soho`
      **Learnings:** (1) Tavily returns web pages, not structured restaurants — Gemini
      structured output does the extraction from snippets. (2) Tavily key required for
      live run; script has a STUB Soho context so the Gemini+OSM half runs key-free.
      (3) Many OSM ways lack `building:levels`/`height` → `real_form` storeys can be
      null (footprint still resolves); widen radius or estimate if Phase 3 needs storeys.

## Phase 3 — Tile gen + isometric grid + Blob store  ✅ (done)
- [x] `lib/store.ts` — Vercel Blob client, store **foodlondon**, `access:"private"`.
      Snapshot JSON at `districts/<slug>.json` (`DistrictSnapshot { slug, updated_at,
      specs: SnapshotSpec[] (BuildingSpec + tile_url), changes[] }`); tiles at
      `tiles/<slug>/<x>-<y>.png` (`allowOverwrite` so regen replaces in place).
      `putTile / putSnapshot / getSnapshot / getTile / tileProxyUrl`. tile_url in the
      snapshot is the PROXY path, not the private blob URL.
- [x] `api/tile/[slug]/[cell]/route.ts` — PRIVATE-store proxy. `get(path,{access:"private",
      token})` → streams the PNG (content-type + `max-age=300`; regen replaces). The URL
      `<img>` tags use; blob never publicly fetchable.
- [x] `api/generate/route.ts` — POST `{ district, max?, specs? }`. Bounded fan-out (3) of
      Nano Banana, anchored to `public/style-anchor.png` + each spec's `real_form` +
      `food_material`; uploads each tile → Blob, writes snapshot. Streams NDJSON
      (`start / tile / error / done`) so the viewer places tiles as they finish. Pass
      `specs` to skip re-discovery (viewer does this).
- [x] `lib/isometric.ts` — `gridToScreen` (2:1 dimetric) + `zIndex` (painter's order) +
      `gridExtent`.
- [x] `components/IsometricGrid.tsx` + `BuildingTile.tsx` — back-to-front diamonds,
      placeholder per cell, building img fades in on load (`imageRendering:pixelated`).
- [x] `components/CityViewer.tsx` + `app/page.tsx` — district picker, Build (discover →
      stream generate), pan (pointer-drag) / zoom (wheel + buttons).
- [x] `lib/bg-remove.ts` — gemini-2.5-flash-image bakes an OPAQUE light checkerboard instead
      of real alpha. `removeBackground()` (sharp) magic-wand flood-fills from the borders
      (light+desaturated predicate, 4-connected) → true alpha. Connectivity preserves light
      pixels INSIDE the building. Wired into `api/generate` before upload. ~57% of each tile
      knocked out.
- [x] `api/snapshot/route.ts` — GET `?district=<slug>` → stored `DistrictSnapshot` so the
      viewer shows an already-built city instantly (no re-gen). Phase 4 reads the same.
- **Exit:** ✅ Verified END-TO-END IN BROWSER (Soho, 5 tiles): real buildings re-skinned in
      food (lobster linguine, champagne sauce, khao soi, lamb kababs, smoked eel), one
      pixel-iso style, transparent tiles composited on the iso grid with correct z-overlap,
      loaded from the Blob snapshot. Data path also checked via `scripts/test-store.ts`
      (byte-exact round-trip). Build + lint clean (0 errors).
      **Eyeball caught + fixed two real bugs:**
      (1) **Height-chain collapse** — `h-full` on the viewer resolved to 0 (no definite
      ancestor height) so `flex-1` map was 0px and the grid centered off-screen; fixed with
      `h-screen`.
      (2) **Opaque tiles** — see `bg-remove.ts` above; tile proxy `Cache-Control` changed to
      `no-store` (agent regenerates in place, so a stale cache hid updates).
      **Known perf debt (Phase 6):** live `/api/discover` is slow (~106s for 6 — Tavily
      `searchDepth:advanced` + serial Nominatim/Overpass). Added 8s/12s `AbortSignal.timeout`
      to `buildings.ts` so a hung Overpass falls back to the generic form instead of stalling
      forever, but discover still exceeds the route's `maxDuration=60` — parallelize/cache or
      raise the limit before deploy.
      Re-key tiles built before bg-remove: `scripts/reprocess-bg.ts <slug>`.

### Phase 3.5 — City-map redesign (it looked like floating toys)

Studied isometric.nyc's writeup. Their map reads as a city via: real geometry rendered
orthographically as model conditioning (Google Maps 3D Tiles), a CONTINUOUS surface of
512px quadrants (not one-building-per-tile), and SEAMLESS edges via neighbour-conditioned
infill — which required a FINE-TUNED Qwen/Image-Edit (base models ~50% consistent).

Two risk probes against base gemini-2.5-flash-image (we can't fine-tune in a hackathon):
- Neighbour-conditioned seamless strip → tiles didn't line up (the post's exact finding).
- Independent full-bleed tiles with half-road edges → model ignored the format ~8/9 times.

**Decision:** stop asking the model for tileable edges. Draw the GROUND + ROADS
deterministically in-app (seamless by construction); the model only does what it's reliable
at — individual transparent iso food buildings. Every cell filled (dense), restaurant cells
= the real building re-skinned, other cells = generic filler food buildings.
- `style-anchor.ts` — `buildFillerBuildingPrompt(seed)` (generic food building, transparent).
- `components/CityGrid.tsx` — replaces IsometricGrid/BuildingTile (deleted). Tessellating
  diamond parcels (food pavement) over the dark page so seams read as a street grid; building
  sprites painted back-to-front on each parcel.
- `api/generate/route.ts` — now fills EVERY grid cell (restaurant hero or filler), streams
  per-cell. Body `gridCols/gridRows` shrink the built region for testing.
- `store.ts` `DistrictSnapshot` v2 — added `cols`, `rows`, `tiles: TileCell[]` (full render
  manifest; `specs` still restaurant-only for Phase 4 diff).
- **Verified in browser** (Soho 4×4 = 16 tiles): dense iso food-city on a continuous
  ground/road grid — no more floating toys. Full district = 8×8 = 64 tiles.

### Phase 3.6 — Real OSM street map (the synthetic grid still looked soulless)

The 8×8 grid still read as a lattice, not a city. A city reads as a city because of its
STREET NETWORK + irregular blocks, not its buildings. So we replaced the synthetic grid
with the REAL district geometry (isometric.nyc's "structural truth", drawn deterministically
from OSM instead of via a model).
- `lib/cityscape-geom.ts` (client-safe) — types + lat/lng → 2:1-iso projection (`projector`,
  `projectInto`). Split out so the client renderer doesn't pull `server-only`.
- `lib/cityscape.ts` (server) — `buildCityscape(district)`: Overpass fetch of all
  `highway` + `building` ways in the bbox (mirror-fallback + UA + 60s timeout), projected to
  iso screen space; roads carry width by class (street hierarchy). Soho ≈ 2.4k roads + 1.7k
  footprints.
- `store.ts` — `putCityscape`/`getCityscape` (Blob cache `cityscape/<slug>.json`; geometry is
  ~static, fetched once).
- `api/cityscape/route.ts` — GET `?district=` → cached-or-fetch geometry.
- `components/Cityscape.tsx` — SVG ground (real footprints + streets) + food-building hero
  sprites placed at their REAL projected lat/lng. Replaces CityGrid/BuildingTile/isometric.ts
  (deleted).
- **Verified in browser:** Soho renders as its real street map (irregular blocks, bent
  streets); Marjorie's food building lands on its real footprint. Probe: `scripts/proto-osm-city.ts`.
### Phase 3.7 — Extruded regular buildings + clickable food landmarks

Direction (locked): regular buildings = plain extruded OSM massing; food buildings ONLY at
restaurants; click a food building → popup with details + Google Maps link.
- `cityscape.ts` — each footprint now carries `h` (iso px from OSM `building:levels`/`height`,
  fallback 4 storeys) + `tone` (stable per-building lightness jitter). The "public buildings
  dataset" is OSM itself.
- `Cityscape.tsx` — extrudes every footprint into iso massing: front-facing walls (shaded
  SE/SW by face normal) + roof, painted back-to-front; warm-grey palette. Food sprites placed
  only on restaurant footprints, `onClick` → select.
- `CityViewer.tsx` — `selected` restaurant popup card (name, cuisine, signature dish, address,
  "Open in Google Maps" deep link `maps/search/?api=1&query=<name+address>`).
- `store.ts` — cityscape blob path VERSIONED (`cityscape/<slug>-v2.json`): Vercel Blob serves
  a stale copy after an overwrite, so a schema change needs a new key. Route sends `no-store`.
- **Fixed** a crash: pan `onPointerMove` read `drag.current!` inside the async `setView`
  updater after it could go null — captured into a local first.
- **Verified in browser:** Soho renders as a real 3D extruded city; Marjorie's food building
  stands out and its popup opens with the Google Maps link. Build clean.
### Phase 3.8 — Shape-conditioned food buildings (real massing → Nano Banana edit)

Goal: food buildings should match the REAL building's 3D shape so they plop into the city
naturally. Probes:
- Feeding a whitebox as a from-scratch REFERENCE → model ignores shape (generic tower).
- Imagen `editImage` masked INPAINT exists in `@google/genai` but is **Vertex-only** — 403 on
  our AI-Studio key ("only supported by the Gemini Enterprise Agent Platform").
- **Nano Banana EDIT mode works:** feed the building's actual rendered massing + "repaint,
  keep the exact silhouette" → it edits the pixels and PRESERVES the real shape. (Art style
  drifts from the pixel anchor — acceptable per product call.)

Wired as the food-building generator:
- `lib/massing.ts` — `matchFootprint(scape, x, y)` (point-in-poly → nearest) + `renderMassing(fp)`
  → grey extruded whitebox PNG + `Place` (footprint's iso bbox in cityscape coords).
- `api/generate` — now FOOTPRINT-BASED, restaurants only (no synthetic filler): match each
  restaurant → real footprint → render massing → `generateImage(editPrompt, whitebox)` (edit)
  → `removeBackground` → `putTile`; snapshot spec carries `place`.
- `Cityscape.tsx` — draws each food sprite over its exact footprint box (`place`) and SKIPS
  that footprint's grey extrusion (food replaces it). Regular buildings stay extruded grey.
- `store.ts` — `DistrictSnapshot` slimmed to `{slug, updated_at, specs, changes}` (cityscape
  drives the regular city); `SnapshotSpec` gains `place`.
- **Verified in browser:** real 3D grey Soho + 5 food buildings on their exact real footprints
  at correct scale (Quo Vadis = stacked-sandwich massing, Berenjak, etc.); click → popup +
  Google Maps link. Build + lint clean.
- **NEXT:** a full `Build city` re-discovers + places all ~5–8 restaurants (cheap now — only
  restaurants generate). Then Phase 4 (refresh agent).

### Phase 3.9 — Pretty food landmarks (loose edit) + normal grey city

Tried food ZONES (Voronoi texture every building) — flat tiled texture on prisms looked
ugly. Reverted. Final direction: restaurants = detailed pretty food buildings; everything
else = the clean grey extruded "normal" city (which already looked good).
- Key change: the Nano Banana EDIT prompt is a freedom slider. Tight "keep exact silhouette"
  = rigid blocky repaint. **LOOSE** "use the massing as a rough size/position guide, free to
  embellish the silhouette, add roof/windows/awnings of the food" → charming detailed
  buildings (sandwich-house, linguine-house) that still fit their plot. Imagen masked inpaint
  would lock shape harder but is Vertex-only.
- `api/generate` — per restaurant: match footprint → `renderMassing` whitebox →
  `generateImage(loosePrompt, whitebox)` → `removeBackground` → place on footprint. Restaurants
  only (cheap). `SnapshotSpec` = spec + `tile_url` + `place`.
- `Cityscape.tsx` — grey extruded city; food sprites placed on their footprints (with vertical
  headroom for taller loose-edit buildings, `objectFit:contain bottom`); matched footprint's
  grey extrusion skipped; clickable → popup (dish/address + Google Maps).
- **Verified in browser:** clean grey Soho + detailed food-building landmarks on real
  footprints (Pastaio linguine-house, Quo Vadis sandwich-house). Build + lint clean.

## Phase 4 — AUTONOMOUS refresh agent (the agent pillar)  ✅ (done)
- [x] `lib/env.ts` — `refreshSecret()` (optional `REFRESH_SECRET`).
- [x] `lib/agent.ts` — `refreshDistrict(slug, deps?)`: `discoverDistrict` fresh specs vs the
      Blob snapshot, diff keyed on **normalised restaurant name** (case/whitespace-insensitive).
      Classify each: `added` (in fresh not old) · `changed` (same name, different
      `signature_dish` or `food_material`) · `unchanged` (same name+dish+material) ·
      `removed` (in old not fresh). Loads (or builds+caches) the cityscape once.
      For added+changed → `buildFoodTile` (THE canonical builder, reused). For unchanged →
      reuse the old `SnapshotSpec` verbatim (keep its `tile_url`/`place` — no regen). Drop
      removed. New `snapshot.specs = unchanged + changed + added`; one `ChangeLogEntry`
      (`cell=[grid_x,grid_y]`, kind, name) per added/removed/changed. `putSnapshot`. Returns
      `RefreshDiff { added, removed, changed, unchanged (names), changes }`.
      `deps?: { discover?, build? }` = injectable seams (production passes nothing; the test
      stubs them — see VERIFY).
- [x] `api/refresh/route.ts` — `force-dynamic`, `maxDuration 300`. **POST** `{ district }`
      AND **GET** `?district=` (Vercel Cron sends GET). Secret guard: reads header
      `x-refresh-secret` or `?secret=`, compares to `REFRESH_SECRET`; if a secret is
      configured and it mismatches → 401; if unset (local dev) → allow. Returns the diff JSON.
- [x] `vercel.json` — `crons: [{ path: "/api/refresh?district=soho&secret=$REFRESH_SECRET",
      schedule: "0 6 * * *" }]`. ⚠️ **Cron `path` is LITERAL — Vercel does NOT interpolate
      env vars in it.** Before deploy, replace `$REFRESH_SECRET` in the path with the actual
      secret value, and set `REFRESH_SECRET` in Vercel env (the route reads it to validate).
- [x] Viewer (`CityViewer.tsx`) — reads `snapshot.changes` on load; if non-empty shows a
      small floating, dismissible **"⟳ Agent · what changed"** feed (＋added / ↻changed /
      －removed, colour-coded). Tiles already reflect the latest snapshot on load.
- **Exit:** ✅ VERIFIED. `scripts/test-refresh.ts` seeds a snapshot (Alpha/Bravo/Charlie),
      runs `refreshDistrict` with stubbed discover (alpha unchanged, Bravo dish-changed, Delta
      new, Charlie gone) + a tile-build recorder — asserts (13 checks) the classification, the
      `changes[]` log, that ONLY Bravo+Delta regenerated (Alpha reused its old `tile_url`,
      Charlie dropped), and the persisted snapshot. Backs up/restores the real soho snapshot
      in a `finally`. Run:
      `node --conditions=react-server --env-file=.env.local --import tsx scripts/test-refresh.ts`
      Then exercised `POST /api/refresh` (no secret set → allowed) on the live server and
      confirmed the change feed renders in the browser.
      **Learnings:** (1) The documented Blob read-after-overwrite lag bites in a tight
      seed→read script loop — the test polls `getSnapshot` until the seed/result is visible
      before asserting. (2) Unchanged restaurants reuse the OLD `SnapshotSpec` verbatim, so a
      persisted name keeps the snapshot's casing even if the fresh search returned a different
      case — name MATCHING is normalised, but the stored spec is not rewritten.

### Phase 4.1 — Dense city (hybrid discovery) + silent agent

Product calls after Phase 4: (a) the city needs to be DENSE (~50 food buildings, not the
~6 Tavily surfaces) and (b) the agent should update the map silently — **no user-visible
change feed**.

- **Hybrid discovery** (`lib/discover.ts` `discoverDistrict`, default `maxResults=50`):
  1. **Breadth** — `lib/eateries.ts` `fetchEateries(district, limit)`: Overpass
     `nwr["amenity"~restaurant|cafe|fast_food|pub|bar]["name"]` in the district bbox →
     ~50–200 real eateries WITH real coordinates (so no per-restaurant Nominatim geocode),
     deduped by name. Mirror fallback + UA + 20s timeout. **`spreadSelect`** then bins them
     into the district grid and round-robins one-per-cell, so the picks are spread district-
     wide (not clustered in dense central Soho) with ~one building per cell — no overlap
     (verified: 50 selected → 50 distinct cells, 0 collisions).
  2. **Enrich** — `lib/gemini.ts` `enrichEateries()`: ONE batch structured-output call
     assigns `{cuisine, signature_dish, food_material}` to all of them (names copied verbatim
     for match-back). Tiling-material rule from Phase 1 reused.
  3. **Ground** — Tavily + `restaurantToSpec` surface the top ~10 NAMED spots with real
     signature dishes; those override the guessed enrichment by normalised name.
  - `real_form` is now a generic string (the food building's massing comes from the cityscape
    footprint via `lib/massing`, so per-restaurant `realBuildingForm` is no longer needed).
    `specsFromWebContext` (the old Tavily-only path) is kept as the Overpass-down fallback.
- `api/generate` — `max` default raised 8→**50** (cap 80). Concurrency stays 3 (Nano Banana
  rate-limit safety) → a full 50-tile build is ~minutes; refresh still regens only changes.
- **Change feed REMOVED** from `CityViewer.tsx` (product decision: the agent updates the map
  silently). `DistrictSnapshot.changes[]` is still written by the agent (kept for Phase 5
  JARVIS voice narration), just not surfaced in the UI.
- Same diff/refresh logic — `refreshDistrict` keys on normalised name, so a denser fresh set
  diffs correctly against the denser snapshot.

## Phase 5 — JARVIS orb (ElevenLabs + nav brain)  ✅ (done)
- [x] `lib/elevenlabs.ts` — `synthesize(text): Promise<Buffer>` via the SDK
      (`@elevenlabs/elevenlabs-js` v2.54): `client.textToSpeech.convert(voiceId,
      { text, modelId: "eleven_multilingual_v2", outputFormat: "mp3_44100_128" })`
      returns a `ReadableStream<Uint8Array>`, drained to a Buffer. voiceId =
      `env.elevenlabsVoiceId()` else the stock "Rachel" voice (`21m00Tcm4TlvDq8ikWAM`)
      so it works key-only. Throws on API failure → caller degrades to text-only.
- [x] `api/narrate/route.ts` — POST `{ text }` → `audio/mpeg` MP3 bytes
      (`Cache-Control: no-store`). `force-dynamic`. TTS failure → 502 (orb stays
      text-only). Verified: 200 + `content-type: audio/mpeg`, ~21KB for a short line.
- [x] `lib/gemini.ts` `parseJarvisIntent(transcript, currentDistrict)` — reuses the
      structured-output pattern (`responseSchema` + `Type`/`Schema`) → guaranteed-shape
      `JarvisIntent { action: "move_to"|"find_cuisine"|"describe"|"refresh", district?,
      cuisine?, reply_text }`.
- [x] `api/jarvis/route.ts` — POST `{ transcript, district? }`. Parses intent, then:
      `find_cuisine` → `getSnapshot(slug)` + fuzzy filter (substring across
      cuisine + food_material + signature_dish + name) → `matches[{name,lat,lng}]` +
      a spoken `reply_text` (count-aware: real count, or "couldn't find any …").
      `refresh` → `refreshDistrict(slug)` (Phase 4 agent) and narrates the diff
      ("Refreshed Soho: 2 new, 1 updated"). `describe` → returns a representative
      spot. `move_to` → resolves a target district; a not-yet-built district is
      acknowledged and the camera reframes the current one. `force-dynamic`,
      `maxDuration 300`.
- [x] `components/JarvisOrb.tsx` — **canvas particle orb** (NOT an emoji): a 48-dot
      swarm + radial core glow on a `<canvas>`, recoloured + energised per state
      (idle amber → listening emerald → thinking blue → speaking bright amber →
      error red), eased frame-to-frame. **Click-activated** (not always-listening):
      click → Web Speech API STT (`webkitSpeechRecognition`, `en-GB`) → transcript.
      No-STT browser or denied mic → a typed `<input>` fallback. Pipeline: transcript
      → POST `/api/jarvis` → drive the map → POST `/api/narrate` → play the MP3
      (Blob URL `<audio>`); a caption bubble shows the spoken line. Dev hook
      `window.__jarvis(transcript)` runs the whole pipeline headlessly (resolves to
      the /api/jarvis JSON; also on `window.__jarvisLast`).
- [x] Wired into `CityViewer.tsx` — exposes `focus(lat,lng,zoom)` (mirrors the
      content transform: `(tx,ty) = -scale·(projectInto(meta,lat,lng) − meta-centre)`
      so the point centres), `highlight(names)` (a `Set` passed to `Cityscape`), and
      `triggerRefresh()` (POST `/api/refresh` → reload heroes). `Cityscape.tsx` rings
      highlighted food sprites with a pulsing emerald ellipse (SMIL animate).
      find_cuisine flies to the matches' centroid and rings every match.
- **Exit:** ✅ VERIFIED IN BROWSER (Soho, 50 heroes). `window.__jarvis("find me
      italian food")` → `/api/jarvis` 200 → `{action:"find_cuisine", cuisine:"italian",
      3 matches}` → camera flew (`scale 1.3`, translated to the centroid) → 3 emerald
      rings rendered → `/api/narrate` 200 `audio/mpeg` → audio Blob played (206) →
      caption "Found 3 italian spots in Soho. Flying you there." Orb renders as the
      golden particle swarm, no emoji. Intent parse checked headless:
      `node --conditions=react-server --env-file=.env.local --import tsx scripts/test-jarvis.ts`
      → 6/6 (find_cuisine×3 with right cuisine, move_to, describe, refresh). Build +
      lint clean (0 errors).
      **Notes:** (1) STT is browser-only so it lives in the orb, not a route; guarded
      for unsupported browsers + denied mic (typed fallback). (2) Single-district
      reality (PLAN gotcha): only Soho is built, so `move_to <other>` reframes Soho
      and says so rather than silently no-opping. (3) The voice `refresh` path calls
      the Phase-4 agent (regenerates only changed tiles) — wiring verified via the
      existing `/api/refresh` (Phase 4); not re-run live here to avoid spending Nano
      Banana quota. (4) ElevenLabs key may be rate-limited (PLAN §Secrets) — narrate
      degrades to text-only on failure, orb still works.

## Phase 6 — Polish & deploy
- [x] Deploy to Vercel; env vars set; live URL.
      **Live: https://foodscape-olive.vercel.app** (prod alias; deployment
      `foodscape-7rfel22jj…`). Pushed GOOGLE/TAVILY/ELEVENLABS/BLOB_READ_WRITE_TOKEN
      to Production env (ELEVENLABS_VOICE_ID optional → SDK Rachel fallback). REFRESH_SECRET
      left unset (cron runs unguarded); dropped the dead `&secret=$REFRESH_SECRET` from the
      `vercel.json` cron path. Smoke-tested prod: `/` 200, `/api/snapshot?district=soho` →
      50 specs, `POST /api/jarvis "find me italian"` → 3 matches, `POST /api/narrate` →
      200 `audio/mpeg`.
- [ ] Landing copy, sponsor badges, loading/empty states
- [x] Demo script — see `DEMO.md` (3-min hackathon walkthrough).
- **Exit:** Public URL ✅, demo runs end-to-end ✅.

## Phase 7 — STRETCH
- [ ] Twilio: SMS your London food-city postcard (4th sponsor)
- [ ] Shareable city permalinks; day/night lighting toggle

---

## Secrets & env

**Rotate the keys pasted in chat — Google, Tavily, ElevenLabs are all compromised.
Use fresh ones before/after the hackathon. `.env.local` is gitignored; mirror into
Vercel env vars.**

```bash
# .env.local  (gitignored; mirror into Vercel env vars). Server-side only.
GOOGLE_API_KEY=...            # rotate (was pasted in chat)
TAVILY_API_KEY=...            # rotate (was pasted in chat)
ELEVENLABS_API_KEY=...        # rotate (was pasted in chat)
ELEVENLABS_VOICE_ID=...       # optional; SDK has a default voice
BLOB_READ_WRITE_TOKEN=...     # auto by Vercel Blob (store: foodlondon) — `vercel env pull`
REFRESH_SECRET=...            # shared secret guarding POST /api/refresh (cron + manual)
```

ClickHouse dropped — persistence is **Vercel Blob** (no separate DB to run).

## Blob store shape (store: `foodlondon`)

```
districts/<slug>.json        # snapshot: { slug, updated_at, specs: BuildingSpec[] (with tile_url),
                             #             changes: ChangeLogEntry[] (last refresh diff) }
tiles/<slug>/<x>-<y>.png     # rendered isometric food tile per grid cell
```

```ts
// BuildingSpec (lib/discover.ts) + tile_url; the snapshot is the whole world model.
interface DistrictSnapshot {
  slug: string;
  updated_at: string;                 // ISO; set when written (no Date in scripts)
  specs: Array<BuildingSpec & { tile_url: string }>;
  changes: Array<{ cell: [number, number]; kind: "added" | "removed" | "changed"; name: string }>;
}
```
Analytics (cuisine heatmap / hot districts) = aggregate over the snapshots — no DB query.

## Demo script (~2 min)

1. Land on London. Pick Shoreditch → tiles stream in, all one style.
2. Talk to the orb: "Take me to Soho." Camera flies.
3. "Find me ramen." Orb queries the Blob snapshot → highlights ramen towers, replies in voice.
4. **The agent moment:** trigger a refresh (or it fires on cron) → Tavily re-searches,
   only changed buildings regenerate, map mutates itself, orb narrates the diff.
5. Close: "Tavily finds it, Nano Banana builds it, the agent keeps it true, ElevenLabs speaks it."
```