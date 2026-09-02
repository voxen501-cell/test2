// The live facts (health, inventory, biome, held item) only reach the model if
// the behaviour pack's scoreboard channel is alive. These tests pin down the
// verdict the bridge reports for each way that channel can look.
const assert = require("assert");
const { createContext, parseScoreboard } = require("./src/context");

const results = [];
function check(label, ok, extra) {
  results.push(ok);
  console.log((ok ? "PASS  " : "FAIL  ") + label);
  if (!ok && extra) console.log("      " + String(extra).slice(0, 400));
}

// A websocket stand-in that answers each command with whatever the plan says.
function fakeWs(plan) {
  const ws = {
    OPEN: 1,
    readyState: 1,
    sent: [],
    send(raw) {
      const msg = JSON.parse(raw);
      const line = msg.body.commandLine;
      ws.sent.push(line);
      const reply = plan[line];
      if (reply === undefined) return; // let it time out
      setImmediate(() =>
        ws.onReply({
          header: { requestId: msg.header.requestId },
          body: reply,
        })
      );
    },
  };
  return ws;
}

const FULL_BOARD = {
  statusMessage:
    "Showing 16 tracked objective(s) for voxai_data: " +
    [
      "standing_on=andesite",
      "facing=north",
      "health=14 of 20",
      "held=iron_pickaxe",
      "wearing=iron_helmet",
      "xp_level=30",
      "biome=plains",
      "weather=Clear",
      "position=10 64 -20",
      "game_mode=survival",
      "looking_at=stone at 10 63 -21",
      "nearby_mobs=2 zombie cow",
      "spawn_point=0 64 0",
      "last_death=5 12 8 in overworld",
      "inventory=64 cobblestone 12 torch",
      "free_slots=21",
    ].join(", "),
};

async function run(plan) {
  const ctx = createContext({ gameRoot: __dirname }, () => {});
  const ws = fakeWs(plan);
  ws.onReply = (msg) => ctx.handleResponse(msg);
  await ctx.snapshot(ws, "Bunny");
  return ctx.channelReport();
}

(async () => {
  const good = await run({ "scoreboard players list": FULL_BOARD });
  check("a full board is reported as working", good.ok === true, JSON.stringify(good));
  check("every fact is counted", good.facts === 16, JSON.stringify(good));
  check("nothing is listed as missing", good.missing.length === 0, JSON.stringify(good));

  const empty = await run({
    "scoreboard players list": { statusMessage: "There are no tracked objectives" },
  });
  check("an empty board is reported as broken", empty.ok === false, JSON.stringify(empty));
  check(
    "the empty board blames the behaviour pack",
    /behaviour pack/.test(empty.reason),
    empty.reason
  );

  const silent = await run({}); // no command answers at all
  check("a silent game is reported as broken", silent.ok === false, JSON.stringify(silent));
  check(
    "the silent case blames the missing reply, not the pack",
    /no reply/.test(silent.reason),
    silent.reason
  );

  const partial = await run({
    "scoreboard players list": {
      statusMessage: "voxai_data: health=20 of 20, biome=plains",
    },
  });
  check("a partial board still counts as working", partial.ok === true, JSON.stringify(partial));
  check(
    "the facts the pack never sent are named",
    partial.missing.includes("inventory") && !partial.missing.includes("health"),
    JSON.stringify(partial.missing)
  );

  check(
    "a value with spaces survives parsing",
    parseScoreboard(FULL_BOARD).find((f) => f.key === "health").value === "14 of 20",
    JSON.stringify(parseScoreboard(FULL_BOARD).slice(0, 3))
  );

  console.log("=== summary ===");
  const failed = results.filter((r) => !r).length;
  console.log(results.length - failed + "/" + results.length + " passed");
  process.exit(failed ? 1 : 0);
})();
