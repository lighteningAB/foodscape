# 🎬 Foodscape — 3-minute demo script

**Live:** https://foodscape-olive.vercel.app · **Repo:** github.com/lighteningAB/foodscape

Format per beat: **[mm:ss] WHAT'S ON SCREEN** — *what you say.*
Total spoken ≈ 430 words (~3 min at a relaxed pace). Open the live site full-screen, sound on,
before you hit record.

---

## [0:00–0:20] — The hook

**Land on the city, full-screen. Slowly drag to pan across Soho.**

> "This is Soho, London — every grey building is the *real* building at that spot, pulled
> straight from OpenStreetMap: real footprints, real heights, real streets. But look closer —
> some of these buildings aren't grey. They're made of *food*. This one's a stack of
> sandwiches, that one's woven out of linguine. This is **Foodscape**."

## [0:20–0:50] — The core trick (Google DeepMind)

**Zoom into 2–3 food buildings. Click one → the popup card (dish, address, Google Maps link).**

> "Each food building is a real restaurant, rebuilt out of its signature dish. The pipeline:
> **Tavily** web search finds the best spots and their real dishes. **Gemini** — with
> structured output — turns those messy web snippets into typed specs and picks a *tiling food
> material*. Then **Nano Banana**, Gemini's image model, re-skins the real building's massing
> into pixel-art food — every call anchored to one locked style reference, so fifty independent
> generations still look like one coherent city."

## [0:50–1:40] — JARVIS, the voice orb (ElevenLabs)

**Click the glowing blue orb. Say it clearly:** *"Find me Italian."*
**Let it run: camera flies, matches ring green, the orb speaks back.**

> "But you don't pan around hunting — you just ask. This is **JARVIS**, the voice orb."

*(after it responds)*

> "Speech-to-text gives a transcript. **Gemini** parses the intent — find a cuisine, describe a
> spot, move the camera, or refresh the city. It queries the world model, flies the camera to
> the matches and rings them — and replies *out loud* through **ElevenLabs**."

**Click again. Say:** *"What's the best spot here?"* — **let it describe a place in voice.**

> "Same orb, different intent — now it's a guide."

## [1:40–2:30] — The autonomous agent (the real story)

**Pull back to the whole city (scroll out). Optional: open the inspector / mention the cron.**

> "Here's what makes it more than a generator: Foodscape is an **autonomous agent**. On a daily
> cron — or on a voice command — it re-runs discovery, **diffs** the fresh restaurants against
> the snapshot it already built, and regenerates *only* the tiles that changed: a new top spot,
> a closure, a different signature dish. Everything unchanged is left untouched — cheap and
> fast. The map keeps itself true to the real world, silently, with no human in the loop. And
> JARVIS can narrate the diff — *'Kiln overtook Bao on Brewer Street.'*"

## [2:30–3:00] — Close + sponsor recap

**Slow pan across the food-city. Orb glowing in the corner.**

> "So, end to end: **Tavily** finds what's real. **Gemini** reasons about it and **Nano Banana**
> builds it. The agent keeps it true. And **ElevenLabs** gives it a voice. One coherent,
> living, edible map of London — that talks back. That's Foodscape. Thanks for watching."

---

## Sponsor cheat-sheet (say at least one concrete use each)

| Sponsor | Concrete use to name on camera |
|---|---|
| **Google DeepMind** | Nano Banana (`gemini-2.5-flash-image`) tile gen + Gemini structured output for specs **and** JARVIS intent |
| **Tavily** | Live web search grounding the top named spots with real, current signature dishes |
| **ElevenLabs** | JARVIS's spoken replies + the agent narrating its diff (`/api/narrate` → MP3) |

## If something fails on camera (fallbacks)
- **Mic won't trigger / noisy room** → a typed input appears under the orb; type "find me italian".
- **No voice plays** (ElevenLabs rate-limit) → the caption bubble still shows the reply; carry on.
- **Don't run a live refresh on camera** — it regenerates tiles (slow + spends image quota).
  Talk over the architecture diagram in the README instead, or pre-trigger it before recording.
- Pre-load the site once before recording so 50 tiles are warm in the browser cache.
