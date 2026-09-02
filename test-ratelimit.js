// A free tier answers 429 the moment chat outruns its per-minute budget. These
// tests stand a fake API in front of the provider layer and check what happens.
const http = require("http");
const { PROVIDERS } = require("./src/providers");

const results = [];
function check(name, ok, extra) {
  results.push(!!ok);
  console.log((ok ? "PASS  " : "FAIL  ") + name + (ok ? "" : "   -> " + extra));
}

// a stand-in for Groq that can be told how to behave
let script = [];
let seen = [];
const api = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const sent = JSON.parse(body || "{}");
    seen.push({ model: sent.model, at: Date.now() });
    const next = script.shift() || { status: 200 };
    if (next.status === 429) {
      res.writeHead(429, { "content-type": "application/json", "retry-after": next.after || "0" });
      return res.end(JSON.stringify({ error: { message: "Rate limit reached for model" } }));
    }
    res.writeHead(next.status, { "content-type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: "hello from " + sent.model } }] }));
  });
});

const PORT = 8271;

// The provider hard-codes Groq's address, so the fake server is put in its
// place by pointing fetch at it rather than by changing the provider.
const GROQ = "https://api.groq.com/openai/v1/chat/completions";
const url = "http://127.0.0.1:" + PORT + "/v1/chat/completions";
const groq = PROVIDERS.groq;
const realFetch = global.fetch;
const sendTo = (where) => (target, options) =>
  realFetch(String(target) === GROQ ? where : target, options);
global.fetch = sendTo(url);

const cfg = {
  apiKey: "x", model: "openai/gpt-oss-120b", fallbackModel: "openai/gpt-oss-20b",
  maxTokens: 100, reasoningEffort: "",
};

(async () => {
  await new Promise((r) => api.listen(PORT, r));

  // 1. one 429 then success: the player never sees the limit
  script = [{ status: 429, after: "0" }, { status: 200 }];
  seen = [];
  let out = await groq.chat(cfg, "sys", [{ role: "user", content: "hi" }]);
  check("a passing limit is retried, not surfaced", out.includes("gpt-oss-120b"), out);
  check("it retried once", seen.length === 2, "calls=" + seen.length);

  // 2. limited throughout: the smaller model answers instead
  script = [
    { status: 429, after: "0" }, { status: 429, after: "0" }, { status: 429, after: "0" },
    { status: 200 },
  ];
  seen = [];
  out = await groq.chat(cfg, "sys", [{ role: "user", content: "hi" }]);
  check("it falls back to the smaller model", out.includes("gpt-oss-20b"), out);
  check("the fallback is a fresh attempt",
    seen.filter((s) => s.model === "openai/gpt-oss-20b").length === 1,
    JSON.stringify(seen.map((s) => s.model)));

  // 3. no fallback configured: the caller is told it was a rate limit
  script = [{ status: 429 }, { status: 429 }, { status: 429 }];
  let caught = null;
  try {
    await groq.chat({ ...cfg, fallbackModel: "" }, "sys", [{ role: "user", content: "hi" }]);
  } catch (e) { caught = e; }
  check("a real limit is reported as one", caught && caught.rateLimited === true,
    caught && caught.message);

  // 4. a plain error is not retried or dressed up
  const bad = http.createServer((req, res) => {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "Invalid API Key" } }));
  });
  await new Promise((r) => bad.listen(8272, r));
  global.fetch = sendTo("http://127.0.0.1:8272/");
  caught = null;
  try {
    await groq.chat(cfg, "sys", [{ role: "user", content: "hi" }]);
  } catch (e) { caught = e; }
  check("a bad key is not treated as a rate limit",
    caught && !caught.rateLimited && /401/.test(caught.message), caught && caught.message);
  bad.close();

  api.close();
  console.log("=== summary ===");
  const failed = results.filter((r) => !r).length;
  console.log(results.length - failed + "/" + results.length + " passed");
  setTimeout(() => process.exit(failed ? 1 : 0), 100);
})();
