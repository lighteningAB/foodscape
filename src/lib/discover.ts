import "server-only";
import { searchRestaurants, toWebContext } from "@/lib/tavily";
import { restaurantToSpec, type RestaurantSpec } from "@/lib/gemini";
import { geocode, realBuildingForm, type RealBuilding } from "@/lib/buildings";
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

export async function discoverDistrict(
  slug: string,
  maxResults = 8,
): Promise<DiscoverResult> {
  const district = getDistrict(slug);
  if (!district) {
    throw new Error(`Unknown district: ${slug}`);
  }

  const results = await searchRestaurants(district.name, Math.max(10, maxResults));
  const webContext = toWebContext(results);
  return specsFromWebContext(district, webContext, maxResults);
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
