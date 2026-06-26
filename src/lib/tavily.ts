import "server-only";
import { tavily, type TavilySearchResponse } from "@tavily/core";
import { env } from "@/lib/env";

/** One web result (not exported by @tavily/core; derive from the response). */
export type TavilySearchResult = TavilySearchResponse["results"][number];

let _client: ReturnType<typeof tavily> | null = null;
function client() {
  _client ??= tavily({ apiKey: env.tavily() });
  return _client;
}

/**
 * Web-search real restaurants in a London district. Returns raw Tavily results
 * (title + content snippets + url); structuring into restaurant specs is done by
 * `restaurantToSpec` in lib/gemini.ts, which reads these snippets.
 */
export async function searchRestaurants(
  districtName: string,
  maxResults = 10,
): Promise<TavilySearchResult[]> {
  const res = await client().search(
    `best restaurants in ${districtName}, London — name, cuisine, signature dish, street address`,
    {
      searchDepth: "advanced",
      topic: "general",
      maxResults,
      includeAnswer: false,
      includeRawContent: "text",
      country: "united kingdom",
    },
  );
  return res.results;
}

/** Flatten Tavily results into a single text block for the LLM extractor. */
export function toWebContext(results: TavilySearchResult[]): string {
  return results
    .map((r) => `SOURCE: ${r.title}\nURL: ${r.url}\n${r.rawContent ?? r.content}`)
    .join("\n\n---\n\n");
}
