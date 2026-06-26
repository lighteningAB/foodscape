import "server-only";
import {
  GoogleGenAI,
  Modality,
  Type,
  type Part,
  type Schema,
} from "@google/genai";
import { env } from "@/lib/env";

/** Nano Banana — image-capable Gemini model. */
export const IMAGE_MODEL = "gemini-2.5-flash-image";

/** Text model for structured extraction (restaurant specs). */
export const TEXT_MODEL = "gemini-2.5-flash";

let _client: GoogleGenAI | null = null;
function client(): GoogleGenAI {
  _client ??= new GoogleGenAI({ apiKey: env.google() });
  return _client;
}

export interface GeneratedImage {
  /** Raw PNG bytes. */
  bytes: Buffer;
  /** Base64-encoded PNG (no data: prefix). */
  base64: string;
  mimeType: string;
}

/**
 * Generate an image with Nano Banana.
 *
 * @param prompt        Text prompt.
 * @param anchorImageBase64  Optional base64 PNG (no data: prefix) fed in as a
 *   reference part so every building inherits the locked style anchor.
 */
export async function generateImage(
  prompt: string,
  anchorImageBase64?: string,
): Promise<GeneratedImage> {
  const parts: Part[] = [];
  if (anchorImageBase64) {
    parts.push({
      inlineData: { mimeType: "image/png", data: anchorImageBase64 },
    });
  }
  parts.push({ text: prompt });

  const response = await client().models.generateContent({
    model: IMAGE_MODEL,
    contents: [{ role: "user", parts }],
    config: {
      // Nano Banana must be allowed to return image (and may emit text too).
      responseModalities: [Modality.IMAGE, Modality.TEXT],
    },
  });

  const candidate = response.candidates?.[0];
  const imagePart = candidate?.content?.parts?.find((p) => p.inlineData?.data);
  const data = imagePart?.inlineData?.data;

  if (!data) {
    const finish = candidate?.finishReason;
    const block = response.promptFeedback?.blockReason;
    const text = response.text;
    throw new Error(
      `Nano Banana returned no image (finishReason=${finish ?? "?"}, ` +
        `blockReason=${block ?? "none"}${text ? `, text="${text}"` : ""}).`,
    );
  }

  return {
    bytes: Buffer.from(data, "base64"),
    base64: data,
    mimeType: imagePart?.inlineData?.mimeType ?? "image/png",
  };
}

/**
 * The LLM-derived part of a building spec, extracted from web-search snippets.
 * The form-lock fields (`real_form`, `grid_x`, `grid_y`, geo) are added later by
 * the discover pipeline from OSM + the district grid.
 */
export interface RestaurantSpec {
  name: string;
  cuisine: string;
  signature_dish: string;
  /** Full street address (incl. London + postcode if known) — for geocoding. */
  address: string;
  /**
   * TILING food phrasing for the re-skin (Phase 1 learning): the signature dish
   * worded so it can cover an ENTIRE building surface, e.g. "a packed wall of
   * sushi rolls", not a single garnish piece.
   */
  food_material: string;
}

const SPEC_SCHEMA: Schema = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      name: { type: Type.STRING, description: "Restaurant name" },
      cuisine: { type: Type.STRING, description: "Cuisine, e.g. Japanese, Italian" },
      signature_dish: {
        type: Type.STRING,
        description: "Its real signature / best-known dish",
      },
      address: {
        type: Type.STRING,
        description:
          "Full street address including the London district and postcode if known, for geocoding",
      },
      food_material: {
        type: Type.STRING,
        description:
          "A TILING, surface-filling phrasing of the signature dish that can be the WHOLE building material covering an entire wall/roof (e.g. 'a packed wall of nigiri sushi and nori', 'a facade of twirled spaghetti and meatballs'), NOT a single garnish item. Discrete foods must be massed/tiled.",
      },
    },
    required: ["name", "cuisine", "signature_dish", "address", "food_material"],
    propertyOrdering: ["name", "cuisine", "signature_dish", "address", "food_material"],
  },
};

/**
 * Turn web-search snippets about a district into structured restaurant specs.
 * Picks real, currently-operating London restaurants, dedupes, and assigns a
 * tiling `food_material` per the Phase 1 re-skin learning. Uses Gemini structured
 * output (responseSchema) so the result is guaranteed-shape JSON.
 */
export async function restaurantToSpec(
  districtName: string,
  webContext: string,
  maxResults = 8,
): Promise<RestaurantSpec[]> {
  const prompt = [
    `From the web-search snippets below, identify up to ${maxResults} real, currently-operating restaurants in ${districtName}, London.`,
    "Use only restaurants actually supported by the snippets — do not invent places. Dedupe. Prefer ones with a clear signature dish and a findable street address.",
    "For each, give its real signature dish, and a food_material: a tiling, surface-filling phrasing of that dish that could re-skin an ENTIRE building (every wall + roof), not a garnish.",
    "",
    "WEB SNIPPETS:",
    webContext,
  ].join("\n");

  const response = await client().models.generateContent({
    model: TEXT_MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: SPEC_SCHEMA,
      temperature: 0.4,
    },
  });

  const text = response.text;
  if (!text) {
    const block = response.promptFeedback?.blockReason;
    throw new Error(
      `restaurantToSpec returned no text (blockReason=${block ?? "none"}).`,
    );
  }
  return JSON.parse(text) as RestaurantSpec[];
}

/** A parsed JARVIS voice command. `action` drives the map; `reply_text` is spoken. */
export interface JarvisIntent {
  action: "move_to" | "find_cuisine" | "describe" | "refresh";
  /** Target district slug for move_to / refresh (lowercased). */
  district?: string;
  /** Cuisine / food keyword to search for (find_cuisine). */
  cuisine?: string;
  /** Short, friendly spoken reply (one or two sentences). */
  reply_text: string;
}

const INTENT_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    action: {
      type: Type.STRING,
      enum: ["move_to", "find_cuisine", "describe", "refresh"],
      description:
        "move_to = fly the camera to a district; find_cuisine = find + highlight food of a cuisine/dish; describe = talk about the best spot; refresh = re-run the live agent to update the city",
    },
    district: {
      type: Type.STRING,
      description: "Lowercase district slug if one is named (e.g. soho, shoreditch). Omit if none.",
    },
    cuisine: {
      type: Type.STRING,
      description:
        "For find_cuisine: the cuisine or food keyword to search (e.g. italian, ramen, sushi, pizza). Omit otherwise.",
    },
    reply_text: {
      type: Type.STRING,
      description:
        "A short, warm spoken reply (<= 2 sentences) JARVIS says back, e.g. 'On it — flying you to the Italian spots in Soho.'",
    },
  },
  required: ["action", "reply_text"],
  propertyOrdering: ["action", "district", "cuisine", "reply_text"],
};

/**
 * Parse a JARVIS voice transcript into a structured intent (guaranteed-shape via
 * responseSchema). The route then acts on the intent (move camera / query the
 * snapshot / kick the agent) and speaks `reply_text` via ElevenLabs.
 */
export async function parseJarvisIntent(
  transcript: string,
  currentDistrict: string,
): Promise<JarvisIntent> {
  const prompt = [
    "You are JARVIS, the voice copilot of FOODSCAPE — an isometric food-city map of London where every restaurant is rendered as a building made of its signature dish.",
    `The user is currently looking at the "${currentDistrict}" district.`,
    "Parse their spoken command into one action:",
    "- move_to: they want to go to / look at a district (set district).",
    "- find_cuisine: they want to find a cuisine, dish, or food type (set cuisine to the keyword).",
    "- describe: they're asking what's good / best here, or about a place (no district/cuisine needed).",
    "- refresh: they want to update / refresh / re-scan the city for what changed.",
    "Always write a short, warm reply_text to speak back. If they name a cuisine, mention it.",
    "",
    `Command: "${transcript}"`,
  ].join("\n");

  const response = await client().models.generateContent({
    model: TEXT_MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: INTENT_SCHEMA,
      temperature: 0.3,
    },
  });

  const text = response.text;
  if (!text) {
    const block = response.promptFeedback?.blockReason;
    throw new Error(`parseJarvisIntent returned no text (blockReason=${block ?? "none"}).`);
  }
  return JSON.parse(text) as JarvisIntent;
}

/** Enrichment for one OSM eatery: a dish + tiling food material from its name. */
export interface EateryEnrichment {
  name: string;
  cuisine: string;
  signature_dish: string;
  food_material: string;
}

const ENRICH_SCHEMA: Schema = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      name: { type: Type.STRING, description: "The restaurant name, copied EXACTLY from the input" },
      cuisine: { type: Type.STRING, description: "Cuisine, refined from the name/tag, e.g. Japanese, Italian" },
      signature_dish: {
        type: Type.STRING,
        description: "A plausible signature / best-known dish for this kind of place",
      },
      food_material: {
        type: Type.STRING,
        description:
          "A TILING, surface-filling phrasing of the dish that can be the WHOLE building material covering every wall + roof (e.g. 'a packed wall of nigiri sushi and nori', 'a facade of twirled spaghetti and meatballs'), NOT a single garnish. Discrete foods must be massed/tiled.",
      },
    },
    required: ["name", "cuisine", "signature_dish", "food_material"],
    propertyOrdering: ["name", "cuisine", "signature_dish", "food_material"],
  },
};

/**
 * Batch-assign a cuisine, signature dish, and tiling food_material to a list of
 * real OSM eateries — ONE structured call for all of them (cheap, vs. one per
 * place). The model keeps each input name verbatim so the caller can match back.
 */
export async function enrichEateries(
  districtName: string,
  eateries: Array<{ name: string; cuisine: string | null }>,
): Promise<EateryEnrichment[]> {
  if (!eateries.length) return [];
  const list = eateries
    .map((e, i) => `${i + 1}. ${e.name}${e.cuisine ? ` (OSM cuisine: ${e.cuisine})` : ""}`)
    .join("\n");

  const prompt = [
    `These are real eateries in ${districtName}, London (from OpenStreetMap).`,
    "For EVERY entry, return an object with the name COPIED EXACTLY, its cuisine, a plausible signature dish, and a tiling food_material that could re-skin an ENTIRE building (every wall + roof), not a garnish.",
    "Return one object per input, same count, names matching the input exactly.",
    "",
    "EATERIES:",
    list,
  ].join("\n");

  const response = await client().models.generateContent({
    model: TEXT_MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: ENRICH_SCHEMA,
      temperature: 0.6,
    },
  });

  const text = response.text;
  if (!text) {
    const block = response.promptFeedback?.blockReason;
    throw new Error(`enrichEateries returned no text (blockReason=${block ?? "none"}).`);
  }
  return JSON.parse(text) as EateryEnrichment[];
}
