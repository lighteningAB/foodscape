/**
 * THE STYLE LOCK + FORM LOCK.
 *
 * Foodscape's whole trick: one coherent isometric world built from N independent
 * image-gen calls, where each tile is the REAL building at that spot re-skinned in
 * food. Two locks make that hold:
 *
 *   FORM LOCK  — each tile preserves a real building's massing/silhouette
 *                (passed in as `realForm`, optionally with a reference image).
 *   STYLE LOCK — every tile shares ONE retro pixel-art isometric look
 *                (the isometric.nyc aesthetic), via the locked anchor image +
 *                repeated invariant clauses.
 *
 * We achieve both by:
 *   1. Rendering `public/style-anchor.png` once from ANCHOR_PROMPT (pixel style).
 *   2. Feeding that anchor image back into every building call AND repeating the
 *      style invariants, varying ONLY {real_form} + {food_material}.
 *
 * Touch these strings carefully — drift here = drift across the whole city.
 */

/**
 * Invariant style clauses — the retro pixel-art isometric look (NOT smooth 3D).
 * Think isometric.nyc / classic isometric pixel games (SimCity 2000, Habbo).
 * Repeated in every prompt so the text and the anchor image agree.
 */
export const STYLE_INVARIANTS = [
  "retro pixel-art, isometric 2:1 dimetric projection (true isometric tile angle, no perspective convergence)",
  "crisp visible pixel grid, hard aliased pixel edges, blocky stair-stepped diagonals — NOT smooth, NOT anti-aliased, NOT 3D render, NOT clay",
  "dithered shading for gradients and shadows (ordered/checkerboard dithering), flat limited retro palette (16–32 colors)",
  "consistent light from the top-left, simple two-tone face shading (lit face lighter, side face darker)",
  "single building centered on one square isometric ground tile, small pixel base plot",
  "fully transparent background (alpha), object only — no scenery, no sky, no text, no UI, no border",
  "consistent scale: the building fits within one city tile footprint",
].join("; ");

/**
 * The locked anchor tile, rendered ONCE to public/style-anchor.png and reused as
 * the visual reference for every building. Subject is a neutral REAL London
 * building so it teaches the pixel style + the "real building" framing without
 * biasing food or form choices.
 */
export const ANCHOR_PROMPT = [
  "A single building tile for a stylized isometric food-city map of London, in retro pixel-art.",
  `STYLE (locked): ${STYLE_INVARIANTS}.`,
  "SUBJECT: a typical real London terraced townhouse — three/four storeys, brick facade, sash windows, a simple parapet roof, a front door with steps. Ordinary, realistic massing.",
  "This image defines the canonical PIXEL-ART style, isometric camera, palette, and scale for an entire city of real-building tiles.",
  "Render it as the definitive reference. Transparent background.",
].join("\n");

/**
 * Build a per-building prompt. Conditioned on the anchor IMAGE (passed separately
 * to generateImage as the style reference). This text restates the style
 * invariants and varies the two free parameters: the real building's form, and
 * the food it is re-skinned in.
 *
 * @param realForm      Descriptor of the ACTUAL building at this spot — its
 *                      massing, storeys, roofline, footprint (e.g. "a 4-storey
 *                      Georgian terraced townhouse with a pitched roof and 3
 *                      window bays"). Derived from OSM/ref image in Phase 2.
 * @param foodMaterial  What to RE-SKIN that building as — the material it is
 *                      built from (e.g. "stacked nigiri sushi and nori",
 *                      "twirled spaghetti and meatballs", "folded tacos").
 */
export function buildBuildingPrompt(
  realForm: string,
  foodMaterial: string,
): string {
  return [
    "Use the provided reference image as the EXACT style anchor.",
    "Match its retro pixel-art rendering, isometric 2:1 projection, pixel grid, dithering, palette feel, light direction, and scale PRECISELY. Same pixel resolution, same hard edges — NOT a smooth 3D render.",
    "",
    `REAL BUILDING (keep this form recognizable): ${realForm}.`,
    "Preserve that building's massing, storey count, roofline, and footprint silhouette so it reads as that real structure.",
    `RE-SKIN IT ENTIRELY IN FOOD: every surface — walls, facade, roof, window frames, door — is made of ${foodMaterial}.`,
    "CRITICAL: the food IS the entire building material, not a decoration or garnish. Do NOT keep brick, plaster, stone, or any original material; replace ALL of it with the food. The whole structure looks sculpted out of that food, yet keeps the real building's shape.",
    "",
    `STYLE (must match reference): ${STYLE_INVARIANTS}.`,
    "Single building centered on its tile. Fully transparent background. No text, no labels, no extra scenery.",
  ].join("\n");
}
