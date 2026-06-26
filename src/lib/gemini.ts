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
