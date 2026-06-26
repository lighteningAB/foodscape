import "server-only";
import { generateImage } from "@/lib/gemini";
import { removeBackground } from "@/lib/bg-remove";
import { projectInto, type Cityscape } from "@/lib/cityscape-geom";
import { matchFootprint, renderMassing } from "@/lib/massing";
import { putTile, tileProxyUrl, type SnapshotSpec } from "@/lib/store";
import type { BuildingSpec } from "@/lib/discover";

/**
 * Turn one restaurant spec into a food building placed on its real OSM footprint.
 * Shared by the initial generate route and the Phase 4 refresh agent so both
 * produce identical tiles. Matches the restaurant to its smallest containing
 * footprint, renders that building's massing, and re-skins it in food via Nano
 * Banana edit mode (loose-but-shape-keeping prompt).
 */

function editPrompt(food: string): string {
  return [
    "The grey shape is a real building's massing in 2:1 isometric view — its exact footprint outline, height and roof.",
    `Re-skin THIS building in ${food} — the food IS the building material (walls, roof, windows, door), not a garnish.`,
    "KEEP THE SAME SHAPE: match the grey footprint outline, height and roof slope closely so it slots back into the city next to its neighbours. Do NOT turn it into a freestanding cottage, do NOT add a big pitched/gabled roof unless the grey already has one, do NOT change the proportions.",
    "Add nice detail WITHIN that shape: windows, a door, ledges and food texture sculpted from the food. Pixel-art, hard edges, limited retro palette, dithered shading, light from top-left.",
    "A single building, fully transparent background, no ground plate, no text.",
  ].join("\n");
}

export async function buildFoodTile(
  slug: string,
  scape: Cityscape,
  spec: BuildingSpec,
): Promise<SnapshotSpec> {
  const [px, py] = projectInto(scape.meta, spec.lat, spec.lng);
  const idx = matchFootprint(scape, px, py);
  const fp = scape.buildings[idx];
  const { png: whitebox, place } = await renderMassing(fp);

  const img = await generateImage(editPrompt(spec.food_material), whitebox.toString("base64"));
  const cut = await removeBackground(img.bytes);
  await putTile(slug, spec.grid_x, spec.grid_y, cut);

  const cx = fp.pts.reduce((s, p) => s + p[0], 0) / fp.pts.length;
  const cy = fp.pts.reduce((s, p) => s + p[1], 0) / fp.pts.length;
  return {
    ...spec,
    tile_url: tileProxyUrl(slug, spec.grid_x, spec.grid_y),
    place: { ...place, cx, cy },
  };
}
