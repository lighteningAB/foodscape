/**
 * Client-safe cityscape types + projection math (no server-only deps). Shared by
 * the Overpass fetcher (lib/cityscape.ts, server) and the renderer
 * (components/Cityscape.tsx, client).
 */

export const M_PER_DEG_LAT = 111_320;
/** 2:1 isometric pixels per metre along a world axis. */
export const SCALE = 1.4;

export interface CityRoad {
  pts: Array<[number, number]>;
  /** Stroke width in px (street hierarchy). */
  w: number;
}
export interface CityFootprint {
  pts: Array<[number, number]>;
  /** Extrusion height in iso px (from OSM levels/height; fallback default). */
  h: number;
  /** 0..1 stable per-building jitter so regular buildings aren't uniform. */
  tone: number;
}

/** Everything needed to re-project a lat/lng into the rendered screen space. */
export interface CityscapeMeta {
  centerLat: number;
  centerLng: number;
  scale: number;
  originX: number;
  originY: number;
  width: number;
  height: number;
}

export interface Cityscape {
  slug: string;
  meta: CityscapeMeta;
  roads: CityRoad[];
  buildings: CityFootprint[];
}

/**
 * Where + how big to draw a food-building sprite so it exactly overlays the real
 * footprint it was generated from. All in cityscape screen coords. `cx,cy` =
 * matched footprint centroid (so the client can skip that footprint's grey
 * extrusion); `x,y,w,h` = the extruded bounding box the sprite fills.
 */
export interface Place {
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
}

/** Project a lat/lng to raw iso coords (pre-origin-shift) for a district centre. */
export function projector(centerLat: number, centerLng: number) {
  const mLng = M_PER_DEG_LAT * Math.cos((centerLat * Math.PI) / 180);
  return (lat: number, lng: number): [number, number] => {
    const wx = (lng - centerLng) * mLng;
    const wy = -(lat - centerLat) * M_PER_DEG_LAT; // south = +y (screen down)
    return [(wx - wy) * SCALE, (wx + wy) * SCALE * 0.5];
  };
}

/** Re-project a lat/lng into a rendered cityscape's screen space. */
export function projectInto(meta: CityscapeMeta, lat: number, lng: number): [number, number] {
  const mLng = M_PER_DEG_LAT * Math.cos((meta.centerLat * Math.PI) / 180);
  const wx = (lng - meta.centerLng) * mLng;
  const wy = -(lat - meta.centerLat) * M_PER_DEG_LAT;
  return [
    (wx - wy) * meta.scale - meta.originX,
    (wx + wy) * meta.scale * 0.5 - meta.originY,
  ];
}
