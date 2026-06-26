# 🍣 Foodscape

### ▶ Live: **[foodscape-olive.vercel.app](https://foodscape-olive.vercel.app)**

> Open it, click the glowing blue orb (bottom-right), and say **"find me italian"** —
> the camera flies to the matches, rings them, and JARVIS answers out loud. No mic? A typed
> input appears. Drag to pan, scroll to zoom.

> **An [isometric.nyc](https://isometric.nyc/) for London — built out of food.**
> Every tile is the **real building** at that London spot (its actual massing, storeys,
> roofline, footprint) **re-skinned in the signature food** of the best restaurant there —
> a real Soho townhouse rebuilt out of sushi, a Victorian terrace re-skinned as spaghetti,
> a railway arch made of tacos. All rendered in one coherent **retro pixel-art isometric**
> style. And it's not a one-shot generator — it's an **autonomous agent** that keeps the
> food-city true to the real world.

---

## What it does

1. **Pick a London district** (Soho, Shoreditch, Camden, Mayfair, Brixton).
2. **Hybrid discovery** fills the district densely: **OpenStreetMap** Overpass returns ~50 real
   eateries (with real coordinates + footprints), and **Tavily** web search grounds the top
   named spots with their real signature dishes.
3. **Gemini** assigns each place a *tiling food material* for the re-skin (one batch call),
   and the real building's massing is taken straight from its OSM footprint.
4. **Nano Banana** (Gemini's image model) renders each building as a pixel-art isometric tile,
   keeping the real silhouette but re-skinning every surface in food — anchored to a single
   locked style reference so the whole city looks coherent.
5. Tiles composite onto an isometric grid in the browser → a living food-city.
6. **JARVIS**, a floating voice orb, lets you talk to the map ("take me to Soho", "find me
   ramen") and replies out loud via **ElevenLabs**.
7. **The autonomous agent** re-runs discovery on a schedule, diffs against what it already
   built, and regenerates only the tiles that changed — updating the map silently in place.

> **Live now:** Soho is built dense — **~50 real food buildings** on their real OSM footprints.
> The set updates itself whenever the agent re-runs (a new spot, a closure, a changed dish),
> and it does so **silently** — the user just sees a current city, never the agent working.

---

## 🏆 Sponsor technology

Foodscape is built on three sponsor platforms, each load-bearing:

### 1. Google DeepMind — Nano Banana + Gemini
The generative core. Used in **three** distinct ways via [`@google/genai`](https://www.npmjs.com/package/@google/genai):

| Use | Model | Where |
|---|---|---|
| **Tile image generation** (the whole visual) | `gemini-2.5-flash-image` (Nano Banana) | `lib/gemini.ts → generateImage()` |
| **Structured restaurant extraction** — turn messy web snippets into typed specs + pick a tiling food material | `gemini-2.5-flash` + `responseSchema` (structured output) | `lib/gemini.ts → restaurantToSpec()` |
| **Agent + JARVIS reasoning** — diff/refresh decisions and voice-intent parsing | `gemini-2.5-flash` | `lib/agent.ts`, `api/jarvis/route.ts` |

The **style + form lock** is the key trick: one style-anchor image (`public/style-anchor.png`)
is fed into *every* Nano Banana call alongside a real-building descriptor, so N independent
image-gen calls produce one coherent isometric world where each building stays recognizably real.

### 2. Tavily — live web grounding
[`@tavily/core`](https://www.npmjs.com/package/@tavily/core) provides the real-world signal.
`lib/tavily.ts → searchRestaurants(district)` runs an advanced web search per district and
**grounds the top named spots** with their real, current signature dishes — layered over the
OSM breadth (`lib/eateries.ts`) so the city is both **dense and real**. The autonomous agent
re-runs this to detect change (a new spot, a closure, a new dish).

### 3. ElevenLabs — the voice of JARVIS
[`@elevenlabs/elevenlabs-js`](https://www.npmjs.com/package/@elevenlabs/elevenlabs-js) gives the
orb its voice. `lib/elevenlabs.ts → synthesize()` calls `textToSpeech.convert()`
(`eleven_multilingual_v2`, MP3) and `api/narrate/route.ts` streams it back as `audio/mpeg` —
turning JARVIS replies and the agent's change feed into speech, making the orb both the
navigation UX and the agent's narrator. TTS failure degrades gracefully to text-only.

**JARVIS** (`components/JarvisOrb.tsx`) is a **click-to-talk particle orb** — a canvas swarm
that recolours and energises across its idle → listening → thinking → speaking states (no
emoji). Click → Web Speech API speech-to-text → the transcript hits `api/jarvis/route.ts`,
where Gemini parses it into a structured intent (`find_cuisine` / `move_to` / `describe` /
`refresh`). For **"find me italian"** it queries the Blob snapshot, flies the camera to the
matches and rings them on the map; then speaks the reply via ElevenLabs. No-mic browsers fall
back to a typed input.

> Persistence is **Vercel Blob** (private store `foodlondon`): district snapshots as JSON +
> tile PNGs served through a token-authenticated proxy route.

---

## How it works

### System architecture

```mermaid
flowchart TD
    User([User picks district]) --> Discover[/api/discover/]
    subgraph Discovery["Discovery pipeline (lib/discover.ts)"]
        Discover --> Tavily["Tavily web search<br/>(lib/tavily.ts)"]
        Tavily --> Gemini["Gemini structured output<br/>restaurantToSpec (lib/gemini.ts)"]
        Gemini --> OSM["OSM / Overpass + Nominatim<br/>realBuildingForm (lib/buildings.ts)"]
        OSM --> Grid["District grid mapping<br/>(lib/london.ts)"]
    end
    Grid --> Specs[("BuildingSpec[]<br/>real_form + food_material + grid cell")]

    Specs --> Generate[/api/generate/]
    subgraph Render["Tile generation"]
        Generate --> Nano["Nano Banana<br/>gemini-2.5-flash-image"]
        Anchor["style-anchor.png<br/>(style lock)"] --> Nano
        Nano --> Blob[("Vercel Blob<br/>store: foodlondon")]
    end

    Blob --> Proxy[/api/tile proxy/]
    Proxy --> Viewer["Isometric CityViewer<br/>(components/)"]

    Viewer <--> Jarvis["JARVIS orb"]
    Jarvis --> Intent["Gemini intent parse<br/>/api/jarvis/"]
    Intent --> EL["ElevenLabs TTS<br/>/api/narrate/"]
    EL --> Jarvis

    Cron([Vercel Cron]) --> Refresh[/api/refresh/]
    Refresh -.re-run + diff + regen.-> Discovery
    Refresh -.update.-> Blob
```

### Discover pipeline (district → specs)

```mermaid
sequenceDiagram
    participant U as User
    participant API as /api/discover
    participant T as Tavily
    participant G as Gemini (structured)
    participant O as OSM (Overpass/Nominatim)
    participant L as london.ts (grid)

    U->>API: GET ?district=soho
    API->>T: searchRestaurants("Soho, London")
    T-->>API: web snippets (name, dish, address)
    API->>G: restaurantToSpec(snippets)
    G-->>API: [{name, cuisine, signature_dish, address, food_material}]
    loop per restaurant
        API->>O: geocode(address) - lat/lng
        API->>O: realBuildingForm(lat,lng) - real_form
        API->>L: latLngToGrid + claimCell - grid_x, grid_y
    end
    API-->>U: BuildingSpec[] (real form + tiling food + grid)
```

### The autonomous agent loop

```mermaid
flowchart LR
    Trigger([Cron or voice command]) --> Fresh[Re-run discover<br/>Tavily + Gemini + OSM]
    Fresh --> Diff{Diff vs Blob snapshot}
    Diff -->|added / changed| Regen[Regenerate ONLY<br/>those tiles<br/>Nano Banana]
    Diff -->|removed| Drop[Remove tile]
    Diff -->|unchanged| Keep[Leave as-is]
    Regen --> Save[(Update Blob snapshot<br/>+ change log)]
    Drop --> Save
    Keep --> Save
    Save --> Narrate[JARVIS narrates the diff<br/>ElevenLabs]
    Narrate --> Map[Map mutates in place]
```

### JARVIS voice loop

```mermaid
sequenceDiagram
    participant U as User (voice)
    participant Orb as JARVIS orb
    participant STT as Speech-to-text
    participant G as Gemini (intent)
    participant Store as Blob snapshot
    participant EL as ElevenLabs

    U->>Orb: "find me ramen in Shoreditch"
    Orb->>STT: mic audio
    STT->>G: transcript
    G-->>Orb: { action:"find_cuisine", district, cuisine, reply_text }
    Orb->>Store: query matching grid cells
    Store-->>Orb: cells to highlight
    Orb->>EL: narrate(reply_text)
    EL-->>Orb: audio
    Orb-->>U: camera flies + highlights + speaks
```

---

## Tech stack

- **Framework:** Next.js 16 (App Router, `src/`, TypeScript, Tailwind, Turbopack)
- **Generative AI:** `@google/genai` — Nano Banana (`gemini-2.5-flash-image`) + Gemini (`gemini-2.5-flash`)
- **Web grounding:** `@tavily/core`
- **Voice:** `@elevenlabs/elevenlabs-js`
- **Real buildings:** OpenStreetMap Overpass + Nominatim (no API key)
- **Persistence:** Vercel Blob (private store)
- **Map:** MapLibre GL + custom isometric compositing
- **Deploy:** Vercel

## Project layout

```
src/
├── app/
│   ├── page.tsx                  # landing -> London food-city viewer
│   └── api/
│       ├── discover/route.ts     # Tavily -> restaurants -> Gemini specs   [done]
│       ├── generate/route.ts     # Nano Banana tile gen -> Blob            (Phase 3)
│       ├── tile/.../route.ts     # private-Blob tile proxy                 (Phase 3)
│       ├── refresh/route.ts      # autonomous agent: refresh + diff        [done]
│       ├── jarvis/route.ts       # voice intent -> action + snapshot query  [done]
│       └── narrate/route.ts      # ElevenLabs TTS -> audio/mpeg             [done]
├── lib/
│   ├── tavily.ts · gemini.ts · style-anchor.ts · buildings.ts            [done]
│   ├── discover.ts · london.ts · store.ts · agent.ts · foodbuilding.ts   [done]
│   └── cityscape.ts · massing.ts · bg-remove.ts · elevenlabs.ts          [done]
├── components/
│   └── CityViewer.tsx · Cityscape.tsx · JarvisOrb.tsx (voice orb)        [done]
└── public/style-anchor.png       # the locked pixel-art style reference   [done]
```

See [`PLAN.md`](./PLAN.md) for the full phased build plan.

## Getting started

```bash
npm install

# .env.local (gitignored) — server-side only:
#   GOOGLE_API_KEY=          # Google AI Studio
#   TAVILY_API_KEY=          # app.tavily.com
#   ELEVENLABS_API_KEY=      # elevenlabs.io  (ELEVENLABS_VOICE_ID optional)
#   BLOB_READ_WRITE_TOKEN=   # Vercel Blob store "foodlondon"
#   REFRESH_SECRET=          # guards /api/refresh (cron + manual); unset = open in local dev

npm run dev          # http://localhost:3000   (or use the live deploy above)

# Try the discover pipeline directly (no server needed):
node --conditions=react-server --env-file=.env.local --import tsx scripts/test-discover.ts soho

# Verify the autonomous refresh agent's diff + selective regen (stubbed, no Tavily/Nano Banana):
node --conditions=react-server --env-file=.env.local --import tsx scripts/test-refresh.ts

# Check JARVIS voice-intent parsing (stub transcripts -> asserted intent; live Gemini):
node --conditions=react-server --env-file=.env.local --import tsx scripts/test-jarvis.ts

# Trigger the agent manually (local: no secret needed):
curl "http://localhost:3000/api/refresh?district=soho"
```

> **Cron note:** `vercel.json` schedules a daily GET to `/api/refresh`. Vercel does **not**
> interpolate env vars into a cron `path` — before deploy, replace `$REFRESH_SECRET` in the
> path with the literal secret value and set `REFRESH_SECRET` in the Vercel project env.

> Scripts that import server libs need the `--conditions=react-server` flag — `lib/env.ts`
> imports `server-only`, which throws in a plain Node process; that flag resolves it to a no-op.
