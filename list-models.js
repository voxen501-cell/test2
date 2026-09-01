const cfg = require("./config.json");
const ENDPOINTS = {
  groq: "https://api.groq.com/openai/v1/models",
  openrouter: "https://openrouter.ai/api/v1/models",
};
const url = ENDPOINTS[cfg.provider];
if (!url) {
  console.log("Model listing is only supported for groq and openrouter.");
  process.exit(0);
}
fetch(url, { headers: { authorization: "Bearer " + cfg.apiKey } })
  .then((r) => r.json())
  .then((d) => {
    if (!d.data) {
      console.log("Error: " + JSON.stringify(d).slice(0, 300));
      return;
    }
    console.log("Models available to your key:\n");
    d.data
      .filter((m) => !/whisper|tts|guard|orpheus/i.test(m.id))
      .map((m) => m.id)
      .sort()
      .forEach((id) => console.log("  " + id));
    console.log("\nPut one of these in the model field of config.json.");
  })
  .catch((e) => console.log("Could not reach the provider: " + e.message));
