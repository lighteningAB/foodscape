import "server-only";

/** Server-only env accessor. Throws if a required key is missing at call time. */
function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function opt(name: string): string | undefined {
  return process.env[name] || undefined;
}

export const env = {
  google: () => req("GOOGLE_API_KEY"),
  tavily: () => req("TAVILY_API_KEY"),
  elevenlabs: () => req("ELEVENLABS_API_KEY"),
  elevenlabsVoiceId: () => opt("ELEVENLABS_VOICE_ID"),
  clickhouse: () => ({
    url: req("CLICKHOUSE_URL"),
    username: process.env.CLICKHOUSE_USER || "default",
    password: req("CLICKHOUSE_PASSWORD"),
  }),
  blobToken: () => opt("BLOB_READ_WRITE_TOKEN"),
};
