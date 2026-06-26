/**
 * Phase 5 — JARVIS intent-parse check.
 *
 * Drives `parseJarvisIntent` (the Gemini structured-output brain) over a set of
 * stub transcripts and asserts the parsed { action, cuisine } for each. Proves
 * the responseSchema gives a guaranteed-shape intent the /api/jarvis route can
 * act on. Needs GOOGLE_API_KEY (live Gemini call).
 *
 * Run:
 *   node --conditions=react-server --env-file=.env.local --import tsx scripts/test-jarvis.ts
 */
import { parseJarvisIntent, type JarvisIntent } from "@/lib/gemini";

interface Case {
  transcript: string;
  action: JarvisIntent["action"];
  /** substring the cuisine field should contain (lowercased), if any */
  cuisine?: string;
}

const CASES: Case[] = [
  { transcript: "find me some ramen", action: "find_cuisine", cuisine: "ramen" },
  { transcript: "show me italian food", action: "find_cuisine", cuisine: "italian" },
  { transcript: "where can I get sushi", action: "find_cuisine", cuisine: "sushi" },
  { transcript: "take me to Soho", action: "move_to" },
  { transcript: "what's the best spot around here?", action: "describe" },
  { transcript: "refresh the city, find what's changed", action: "refresh" },
];

let pass = 0;
let fail = 0;

function check(label: string, ok: boolean, detail?: string) {
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (ok) pass++;
  else fail++;
}

async function main() {
  for (const c of CASES) {
    let intent: JarvisIntent;
    try {
      intent = await parseJarvisIntent(c.transcript, "Soho");
    } catch (err) {
      check(`"${c.transcript}"`, false, `threw: ${err instanceof Error ? err.message : err}`);
      continue;
    }
    const actionOk = intent.action === c.action;
    const cuisineOk =
      !c.cuisine || (intent.cuisine ?? "").toLowerCase().includes(c.cuisine);
    const replyOk = typeof intent.reply_text === "string" && intent.reply_text.length > 0;
    check(
      `"${c.transcript}"`,
      actionOk && cuisineOk && replyOk,
      `action=${intent.action}${intent.cuisine ? ` cuisine=${intent.cuisine}` : ""}` +
        (actionOk ? "" : ` (want ${c.action})`) +
        (cuisineOk ? "" : ` (want cuisine~${c.cuisine})`) +
        (replyOk ? "" : " (empty reply_text)"),
    );
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

main();
