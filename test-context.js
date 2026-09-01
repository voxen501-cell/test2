const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");
const { PROVIDERS } = require("./src/providers");
const { timeOfDay, prettyName } = require("./src/context");

const CONFIG_PATH = path.join(__dirname, "test-config.json");
process.env.AICHAT_CONFIG = CONFIG_PATH;


let lastSystem = null;
PROVIDERS.mock = {
  label: "Mock",
  defaultModel: "mock-1",
  keyUrl: "",
  async chat(cfg, system) {
    lastSystem = system;
    return "Understood.";
  },
};

fs.writeFileSync(
  CONFIG_PATH,
  JSON.stringify({
    provider: "mock",
    apiKey: "x",
    port: 8161,
    trigger: "ai",
    output: "addon",
    cooldownMs: 0,
    maxPerMinute: 100,
    useGameContext: true,
    encryption: "off",
    defaultAlwaysOn: false,
    allowActions: false,
    chunkDelayMs: 0,
  })
);

const results = [];
function check(name, cond, extra) {
  results.push(!!cond);
  console.log((cond ? "PASS  " : "FAIL  ") + name + (cond ? "" : "   -> " + extra));
}

console.log("=== unit ===");
check("timeOfDay maps sunrise", timeOfDay(500) === "sunrise", timeOfDay(500));
check("timeOfDay maps midday", timeOfDay(6500) === "midday", timeOfDay(6500));
check("timeOfDay maps night", timeOfDay(15000) === "night", timeOfDay(15000));
check("timeOfDay treats 6000 ticks as midday", timeOfDay(6000) === "midday", timeOfDay(6000));
check("timeOfDay wraps past a full day", timeOfDay(27000) === "morning", timeOfDay(27000));
check("prettyName strips namespace", prettyName("minecraft:iron_ore") === "iron ore", prettyName("minecraft:iron_ore"));

const { start } = require("./src/server");
start();

const ws = new WebSocket("ws://127.0.0.1:8161");
const subscribed = [];
const scriptevents = [];

ws.on("message", (data) => {
  const msg = JSON.parse(data.toString());
  const h = msg.header;
  if (h.messagePurpose === "subscribe") {
    subscribed.push(msg.body.eventName);
    return;
  }
  if (h.messagePurpose !== "commandRequest") return;
  const line = msg.body.commandLine;
  if (line.startsWith("scriptevent")) scriptevents.push(line);

  let body = null;
  if (line.startsWith("querytarget")) {
    body = {
      statusCode: 0,
      details: JSON.stringify([
        { dimension: 1, position: { x: 128.5, y: -12.3, z: -64.7 }, yRot: 90 },
      ]),
    };
  } else if (line === "time query daytime") {
    body = { statusCode: 0, statusMessage: "Time is 15200" };
  } else if (line === "time query day") {
    body = { statusCode: 0, statusMessage: "Day is 42" };
  } else if (line === "scoreboard players list") {
    body = {
      statusCode: 0,
      statusMessage:
        "There are 3 tracked entity(s): standing_on=andesite, health=14 of 20, held=iron pickaxe",
    };
  } else if (line === "list") {
    body = { statusCode: 0, statusMessage: "There are 2 of 10 players online:\nBunny, Steve" };
  }
  if (!body) return;
  ws.send(
    JSON.stringify({
      header: { ...h, messagePurpose: "commandResponse" },
      body,
    })
  );
});

function fire(eventName, body) {
  ws.send(
    JSON.stringify({
      header: { messagePurpose: "event", eventName, version: 1 },
      body,
    })
  );
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

ws.on("open", async () => {
  console.log("\n=== world context ===");
  await wait(200);

  check(
    "subscribes to world events, not just chat",
    ["PlayerMessage", "BlockBroken", "MobKilled", "ItemCrafted"].every((e) =>
      subscribed.includes(e)
    ),
    JSON.stringify(subscribed)
  );

  fire("BlockBroken", { block: { id: "minecraft:iron_ore" } });
  fire("BlockBroken", { block: { id: "minecraft:iron_ore" } });
  fire("BlockBroken", { block: { id: "minecraft:stone" } });
  fire("MobKilled", { victim: { type: "minecraft:zombie" } });
  fire("ItemCrafted", { item: { id: "minecraft:iron_pickaxe" } });
  fire("PlayerDied", {});
  await wait(150);

  ws.send(
    JSON.stringify({
      header: { messagePurpose: "event", eventName: "PlayerMessage", version: 1 },
      body: { message: "ai where am I", sender: "Bunny", type: "chat" },
    })
  );
  await wait(2500);

  const sys = lastSystem || "";
  console.log("\n--- context block sent to the model ---");
  console.log(sys.split("\n").slice(1).map((l) => "  " + l).join("\n"));
  console.log("");

  check("position reaches the model", sys.includes("x 129") || sys.includes("x 128"), sys);
  check("dimension is named, not a number", sys.includes("the Nether"), sys);
  check(
    "depth wording is not applied to the Nether",
    !sys.includes("deepslate"),
    sys
  );
  check("time of day is words not ticks", sys.includes("night") && !sys.includes("15200"), sys);
  check("day number reaches the model", sys.includes("day 42"), sys);
  check("online players reach the model", sys.includes("Bunny, Steve"), sys);
  check("mining is counted and ranked", sys.includes("iron ore x2"), sys);
  check("kills reach the model", sys.includes("zombie"), sys);
  check("crafting reaches the model", sys.includes("iron pickaxe"), sys);
  check("deaths reach the model", sys.includes("died 1"), sys);
  check(
    "the original personality survives",
    sys.startsWith("You are a helpful companion"),
    sys.slice(0, 60)
  );
  check("the answer still gets delivered", scriptevents.some((c) => c.includes("voxai:reply")), JSON.stringify(scriptevents));

  check(
    "the exact block under the player reaches the model",
    sys.includes("under the player is andesite"),
    sys
  );
  check("health reaches the model", sys.includes("health is 14 of 20"), sys);
  check("held item reaches the model", sys.includes("holding iron pickaxe"), sys);
  check(
    "facts that were supplied are not listed as unknown",
    !/cannot see[^.]*standing on/i.test(sys) && !/cannot see[^.]*their health/i.test(sys),
    sys
  );
  check(
    "facts that were not supplied are still listed as unknown",
    /cannot see/i.test(sys) && /weather/i.test(sys),
    sys
  );
  check(
    "the model is told the real world date",
    /Real world date and time/.test(sys),
    sys
  );

  console.log("=== summary ===");
  const failed = results.filter((r) => !r).length;
  console.log(results.length - failed + "/" + results.length + " passed");
  fs.unlinkSync(CONFIG_PATH);
  process.exit(failed ? 1 : 0);
});
