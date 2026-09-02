// Behind Cloudflare, Railway or Render a websocket that goes quiet is hung up
// after a minute or two, and a player who stands still sends nothing at all.
// The bridge pings to keep the link alive; these tests pin that down.
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");
const { PROVIDERS } = require("./src/providers");

const CONFIG_PATH = path.join(__dirname, "test-keepalive-config.json");
process.env.AICHAT_CONFIG = CONFIG_PATH;

PROVIDERS.mock = {
  label: "Mock",
  defaultModel: "mock-1",
  keyUrl: "",
  async chat() {
    return "hi";
  },
};

const PORT = 8261;
fs.writeFileSync(
  CONFIG_PATH,
  JSON.stringify({
    provider: "mock",
    apiKey: "x",
    port: PORT,
    encryption: "off",
    useGameContext: false,
    keepAliveMs: 1000, // a real deploy uses 30s; the floor in the code is 1s
  })
);

const results = [];
function check(name, cond, extra) {
  results.push(!!cond);
  console.log((cond ? "PASS  " : "FAIL  ") + name + (cond ? "" : "   -> " + extra));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

require("./src/server").start();

(async () => {
  await sleep(300);

  // 1. a socket that says nothing still gets pinged
  const quiet = new WebSocket("ws://localhost:" + PORT);
  let pings = 0;
  quiet.on("ping", () => pings++);
  await new Promise((r) => quiet.on("open", r));
  await sleep(2500);
  check("a silent client is pinged", pings >= 2, "pings=" + pings);
  check("the socket is still open after the quiet spell", quiet.readyState === WebSocket.OPEN, String(quiet.readyState));

  // 2. closing the socket stops the timer, so it cannot leak or throw
  const before = pings;
  quiet.close();
  await sleep(1600);
  check("pings stop once the client leaves", pings === before, "pings=" + pings + " before=" + before);

  console.log("=== summary ===");
  const failed = results.filter((r) => !r).length;
  console.log(results.length - failed + "/" + results.length + " passed");
  fs.unlinkSync(CONFIG_PATH);
  process.exit(failed ? 1 : 0);
})();
