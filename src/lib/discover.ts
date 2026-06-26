import "server-only";
import { searchRestaurants, toWebContext } from "@/lib/tavily";
import {
  restaurantToSpec,
  enrichEateries,
  type RestaurantSpec,
  type EateryEnrichment,
} from "@/lib/gemini";
import { geocode, realBuildingForm, type RealBuilding } from "@/lib/buildings";
import { fetchEateries } from "@/lib/eateries";
import { getDistrict, latLngToGrid, claimCell, type District } from "@/lib/london";

/**
 * Phase 2 pipeline: district → Tavily restaurants → Gemini specs → OSM real
 * building form + grid cell. Returns full building specs ready for Phase 3 tile
 * generation. No image generation here.
 */

/** A complete building spec — LLM fields + real-form + grid + geo. */
export interface BuildingSpec {
  name: string;
  cuisine: string;
  signature_dish: string;
  food_material: string;
  real_form: string;
  grid_x: number;
  grid_y: number;
  lat: number;
  lng: number;
  address: string;
  /** OSM provenance for the real_form (null fields = generic fallback used). */
  building: Pick<
    RealBuilding,
    "storeys" | "heightM" | "buildingType" | "roof" | "footprint" | "matched" | "osmId"
  >;
}

export interface DiscoverResult {
  district: string;
  slug: string;
  count: number;
  specs: BuildingSpec[];
}

// Nominatim usage policy: <=1 request/second.
const GEOCODE_DELAY_MS = 1100;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Normalised restaurant-name key (matches lib/agent.ts so the diff lines up). */
const nameKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * HYBRID discovery (the dense food city):
 *   1. BREADTH — OSM Overpass returns ~50 real eateries with real coordinates.
 *   2. ENRICH  — Gemini assigns a dish + tiling food_material to all of them in
 *      one batch call.
 *   3. GROUND  — Tavily + Gemini surface the top ~10 *named* spots with real
 *      signature dishes; those override the guessed enrichment by name.
 * Coordinates come straight from OSM, so there's no per-restaurant geocode — and
 * the food building's massing comes from the cityscape footprint (lib/massing),
 * so `real_form` / per-restaurant Overpass are no longer needed here.
 */
export async function discoverDistrict(
  slug: string,
  maxResults = 50,
): Promise<DiscoverResult> {
  const district = getDistrict(slug);
  if (!district) {
    throw new Error(`Unknown district: ${slug}`);
  }

  // 1. Breadth from OSM.
  const eateries = await fetchEateries(district, maxResults);
  if (!eateries.length) {
    // Overpass empty/down — fall back to the Tavily-only path (a few spots).
    const results = await searchRestaurants(district.name, Math.max(10, maxResults));
    return specsFromWebContext(district, toWebContext(results), Math.min(maxResults, 12));
  }

  // 2. Batch enrichment (best-effort — a failure just means generic dishes).
  const enrich = new Map<string, EateryEnrichment>();
  try {
    for (const e of await enrichEateries(district.name, eateries)) {
      enrich.set(nameKey(e.name), e);
    }
  } catch {
    /* keep going with OSM cuisine + generic fallbacks */
  }

  // 3. Tavily grounding for the few named top spots (best-effort).
  const web = new Map<string, RestaurantSpec>();
  try {
    const results = await searchRestaurants(district.name, 10);
    for (const r of await restaurantToSpec(district.name, toWebContext(results), 10)) {
      web.set(nameKey(r.name), r);
    }
  } catch {
    /* skip web grounding */
  }

  const specs: BuildingSpec[] = [];
  const used = new Set<string>();
  for (const eat of eateries) {
    const k = nameKey(eat.name);
    const e = enrich.get(k);
    const w = web.get(k); // web-grounded real dish wins when Tavily covered it
    const want = latLngToGrid(district, eat.lat, eat.lng);
    const cell = claimCell(district, want, used);
    specs.push({
      name: eat.name,
      cuisine: w?.cuisine || e?.cuisine || eat.cuisine || "restaurant",
      signature_dish: w?.signature_dish || e?.signature_dish || "house special",
      food_material: w?.food_material || e?.food_material || fallbackMaterial(eat.cuisine),
      real_form: `a building in ${district.name}, London`,
      grid_x: cell.x,
      grid_y: cell.y,
      lat: eat.lat,
      lng: eat.lng,
      address: `${eat.name}, ${district.name}, London`,
      building: genericBuilding(),
    });
  }

  return { district: district.name, slug: district.slug, count: specs.length, specs };
}

/** Tiling food_material fallback when neither Gemini nor Tavily covered a spot. */
function fallbackMaterial(cuisine: string | null): string {
  const c = cuisine?.toLowerCase() ?? "";
  return c
    ? `a building-wide facade sculpted entirely from ${c} food, covering every wall and roof`
    : "a building-wide facade sculpted entirely from food, covering every wall and roof";
}

function genericBuilding(): BuildingSpec["building"] {
  return {
    storeys: null,
    heightM: null,
    buildingType: null,
    roof: null,
    footprint: null,
    matched: false,
    osmId: null,
  };
}

/**
 * Post-Tavily half of the pipeline: web context → Gemini specs → OSM real form +
 * grid. Split out so it can run without a Tavily key (e.g. offline dev / tests).
 */
export async function specsFromWebContext(
  district: District,
  webContext: string,
  maxResults = 8,
): Promise<DiscoverResult> {
  const restaurants = await restaurantToSpec(district.name, webContext, maxResults);

  const specs: BuildingSpec[] = [];
  const used = new Set<string>();

  // Serialised: Nominatim + Overpass are public/rate-limited.
  for (const r of restaurants) {
    const geo = await geocode(r.address);
    if (!geo) {
      await sleep(GEOCODE_DELAY_MS);
      continue;
    }
    const building = await realBuildingForm(geo.lat, geo.lng);
    const want = latLngToGrid(district, geo.lat, geo.lng);
    const cell = claimCell(district, want, used);

    specs.push(toSpec(r, geo, building, cell));
    await sleep(GEOCODE_DELAY_MS);
  }

  return {
    district: district.name,
    slug: district.slug,
    count: specs.length,
    specs,
  };
}

function toSpec(
  r: RestaurantSpec,
  geo: { lat: number; lng: number },
  b: RealBuilding,
  cell: { x: number; y: number },
): BuildingSpec {
  return {
    name: r.name,
    cuisine: r.cuisine,
    signature_dish: r.signature_dish,
    food_material: r.food_material,
    real_form: b.realForm,
    grid_x: cell.x,
    grid_y: cell.y,
    lat: geo.lat,
    lng: geo.lng,
    address: r.address,
    building: {
      storeys: b.storeys,
      heightM: b.heightM,
      buildingType: b.buildingType,
      roof: b.roof,
      footprint: b.footprint,
      matched: b.matched,
      osmId: b.osmId,
    },
  };
}

export type { District };
