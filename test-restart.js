// The status plate doubles as a restart. It must drop whatever Minecraft
// session is open and forget the conversation, without taking down the
// listener the app window is talking over.
process.env.AICHAT_NO_WINDOW = "1";
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");
const { PROVIDERS } = require("./src/providers");

const CONFIG_PATH = path.join(__dirname, "test-restart-config.json");
process.env.AICHAT_CONFIG = CONFIG_PATH;

PROVIDERS.mock = { label: "Mock", defaultModel: "mock-1", keyUrl: "", async chat() { return "hi"; } };

const PORT = 8251;
fs.writeFileSync(CONFIG_PATH, JSON.stringify({
  provider: "mock", apiKey: "x", port: PORT, encryption: "off", useGameContext: false,
}));

const results = [];
function check(name, ok, extra) {
  results.push(!!ok);
  console.log((ok ? "PASS  " : "FAIL  ") + name + (ok ? "" : "   -> " + extra));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const base = "http://127.0.0.1:" + PORT;

require("./src/server").start();

(async () => {
  await sleep(400);

  // the app window's stream, which must survive a restart
  const http = require("http");
  let streamAlive = false;
  const stream = http.get({ host: "127.0.0.1", port: PORT, path: "/events" }, (res) => {
    streamAlive = true;
    res.on("data", () => {});
    res.on("end", () => { streamAlive = false; });
  });
  await sleep(300);
  check("the app window is connected", streamAlive);

  // a Minecraft client
  const mc = new WebSocket("ws://127.0.0.1:" + PORT, ["com.microsoft.minecraft.wsencrypt"]);
  let closed = null;
  mc.on("close", (code) => { closed = code; });
  await new Promise((r) => mc.on("open", r));
  await sleep(400);
  check("Minecraft is connected", mc.readyState === WebSocket.OPEN);

  const body = await (await fetch(base + "/restart")).json();
  check("restart reports success", body.ok, JSON.stringify(body));
  check("restart says the link was dropped", /disconnect/i.test(body.message), body.message);

  await sleep(500);
  check("Minecraft was disconnected", closed !== null, "close code " + closed);
  check("the app window survived it", streamAlive, "stream ended");

  const after = await (await fetch(base + "/status")).json();
  check("the bridge is still serving", typeof after.port === "number", JSON.stringify(after));

  const idle = await (await fetch(base + "/restart")).json();
  check("restarting with nobody connected still works", idle.ok, JSON.stringify(idle));
  check("and says so plainly", !/disconnect/i.test(idle.message), idle.message);

  try { mc.terminate(); } catch (e) {}
  stream.destroy();
  fs.unlinkSync(CONFIG_PATH);
  console.log("=== summary ===");
  const failed = results.filter((r) => !r).length;
  console.log(results.length - failed + "/" + results.length + " passed");
  // let the sockets finish closing, or libuv trips over them on the way out
  setTimeout(() => process.exit(failed ? 1 : 0), 150);
})();
