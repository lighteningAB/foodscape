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

## Phase 3 — Tile gen + isometric grid + Blob store
- [ ] `lib/store.ts` — Vercel Blob client (store: **foodlondon**). A district snapshot
      = `{ slug, updated_at, specs: BuildingSpec[] (incl. tile_url) }` saved as JSON at
      `districts/<slug>.json`; tile PNGs at `tiles/<slug>/<grid_x>-<grid_y>.png`.
- [ ] `api/generate/route.ts` — fan-out Nano Banana: anchored to pixel style + conditioned
      on each spec's `real_form` (+ ref image if available); upload tile → Blob; write snapshot.
- [ ] `lib/isometric.ts` — grid cell → screen x/y + z-sort
- [ ] `components/IsometricGrid.tsx` + `BuildingTile.tsx` — stream tiles as they finish
- [ ] `components/CityViewer.tsx` + `app/page.tsx` — pan/zoom over London grid
- **Exit:** Pick a London district → watch the food-city build itself tile by tile, each
      tile recognizably the real building re-skinned in food; snapshot persisted to Blob.

## Phase 4 — AUTONOMOUS refresh agent (the agent pillar)
- [ ] `lib/agent.ts` — `refreshDistrict(slug)`: re-run Phase 2 discover → diff fresh specs
      vs the Blob snapshot (key on restaurant name + grid cell). Classify each cell:
      `added | removed | changed (dish/food_material) | unchanged`.
- [ ] Act on the diff: regen ONLY added/changed tiles (Nano Banana), drop removed,
      keep unchanged. Write new snapshot + a `changes[]` log to Blob.
- [ ] `api/refresh/route.ts` — POST `{ district }` runs `refreshDistrict`; returns the diff.
      Protect with a shared secret header (cron + manual trigger only).
- [ ] `vercel.json` cron → hit `/api/refresh` per district on a schedule (autonomy).
- [ ] Viewer: subscribe to snapshot; tiles mutate in place when the agent updates them;
      surface a "what changed" feed. (Analytics: cuisine heatmap derived from snapshots.)
- **Exit:** Trigger refresh (or wait for cron) → agent re-searches, only changed buildings
      regenerate, map updates itself, change feed shows the diff. No human in the loop.

## Phase 5 — JARVIS orb (ElevenLabs + nav brain)
- [ ] `components/JarvisOrb.tsx` — floating glowing orb, idle pulse, mic button,
      listening/thinking/speaking states (canvas/WebGL or CSS glow)
- [ ] Voice in: Web Speech API STT (or ElevenLabs STT) → text
- [ ] `api/jarvis/route.ts` — Gemini intent parse → action:
      `{ action: "move_to"|"find_cuisine"|"describe"|"refresh", district?, cuisine?, reply_text }`
      `find_cuisine` queries the Blob snapshot → returns matching grid cells;
      `refresh` triggers the autonomous agent for the current district on voice command.
- [ ] Wire actions: move map camera / highlight buildings / kick a refresh
- [ ] `api/narrate/route.ts` — ElevenLabs TTS of `reply_text` → orb "speaks"
      (agent also narrates its change feed: "Kiln overtook Bao on Brewer Street").
- **Exit:** Say "find me ramen in Shoreditch" → orb replies in voice, camera flies + highlights.

## Phase 6 — Polish & deploy
- [ ] Landing copy, sponsor badges, loading/empty states
- [ ] Deploy to Vercel; env vars set; live URL
- [ ] Rehearse 2-min demo
- **Exit:** Public URL, demo runs end-to-end.

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