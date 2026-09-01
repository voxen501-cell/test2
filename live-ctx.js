const WebSocket = require("ws");
const fs = require("fs");
const { spawn } = require("child_process");

const LIVE_CONFIG = "live-config.json";
const cfg = JSON.parse(fs.readFileSync("config.json", "utf8"));
if (!cfg.apiKey) {
  console.log("No apiKey in config.json. Put your key in first.");
  process.exit(1);
}
cfg.port = 8213;
fs.writeFileSync(LIVE_CONFIG, JSON.stringify(cfg));

const child = spawn(process.execPath, ["src/server.js"], {
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, AICHAT_CONFIG: LIVE_CONFIG },
});
child.on("exit", () => { try { fs.unlinkSync(LIVE_CONFIG); } catch (e) {} });
child.stdout.on("data", (d) => process.stdout.write("  server| " + d));

setTimeout(() => {
  const ws = new WebSocket("ws://127.0.0.1:8213");
  let got = [];
  ws.on("message", (data) => {
    const msg = JSON.parse(data.toString());
    const h = msg.header;
    if (h.messagePurpose !== "commandRequest") return;
    const line = msg.body.commandLine;
    if (line.startsWith("scriptevent voxai:reply")) { got.push(line); return; }
    if (!line.startsWith("scriptevent") && !line.startsWith("tellraw") &&
        !line.startsWith("querytarget") && !line.startsWith("time query") &&
        line !== "list" && line !== "scoreboard players list") {
      console.log("    >> MINECRAFT RUNS: " + line);
      return;
    }
    let body = null;
    if (line.startsWith("querytarget"))
      body = { statusCode: 0, details: JSON.stringify([{ dimension: 0, position: { x: 231.5, y: -47.0, z: -1044.2 } }]) };
    else if (line === "time query daytime") body = { statusCode: 0, statusMessage: "Time is 16400" };
    else if (line === "time query day") body = { statusCode: 0, statusMessage: "Day is 137" };
    else if (line === "list") body = { statusCode: 0, statusMessage: "There are 1 of 8 players online:\nBunny" };
    else if (line === "scoreboard players list")
      body = {
        statusCode: 0,
        statusMessage:
          "There are 6 tracked entity(s): standing_on=andesite, facing=north west, " +
          "health=14 of 20, held=iron pickaxe, wearing=iron helmet iron chestplate, biome=swamp",
      };
    if (body) ws.send(JSON.stringify({ header: { ...h, messagePurpose: "commandResponse" }, body }));
  });

  const fire = (eventName, body) =>
    ws.send(JSON.stringify({ header: { messagePurpose: "event", eventName, version: 1 }, body }));

  ws.on("open", async () => {
    for (const b of ["minecraft:deepslate", "minecraft:deepslate", "minecraft:deepslate_iron_ore", "minecraft:deepslate_redstone_ore"])
      fire("BlockBroken", { block: { id: b } });
    fire("MobKilled", { victim: { type: "minecraft:skeleton" } });
    fire("PlayerDied", {});
    await new Promise((r) => setTimeout(r, 300));

    const ask = async (q) => {
      got = [];
      console.log("\n>>> " + q);
      ws.send(JSON.stringify({
        header: { messagePurpose: "event", eventName: "PlayerMessage", version: 1 },
        body: { message: q, sender: "Bunny", type: "chat" },
      }));
      await new Promise((r) => setTimeout(r, 25000));
      console.log("    raw chunk lines: " + got.length);
      got.forEach((c) => console.log("      [" + c.slice(24, 60) + "]"));
      const text = got.map((c) => c.split("|").slice(4).join("|")).join("").replace(/<br>/g, " ");
      console.log("<<< " + text);
      return text;
    };

    await ask("ai mere aas paas ke ye ped aur patte hata do");
    await ask("ai mere around 10 block sab saaf kar do");
    await ask("ai yaha 0 60 0 se 5 65 5 tak stone bhar do");

    child.kill();
    try { fs.unlinkSync(LIVE_CONFIG); } catch (e) {}
    process.exit(0);
  });
}, 700);
