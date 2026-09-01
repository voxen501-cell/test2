const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");
const { PROVIDERS } = require("./src/providers");
const { escapeRawtext, sanitize } = require("./src/protocol");

const CONFIG_PATH = path.join(__dirname, "test-config.json");
process.env.AICHAT_CONFIG = CONFIG_PATH;


let lastAsk = null;
PROVIDERS.mock = {
  label: "Mock",
  defaultModel: "mock-1",
  keyUrl: "",
  async chat(cfg, system, messages) {
    lastAsk = { system, messages: JSON.parse(JSON.stringify(messages)) };
    if (messages[messages.length - 1].content === "boom") {
      throw new Error("simulated failure");
    }
    return (
      "**Sure!**\nHere is a long answer that should need more than one chunk " +
      "because it keeps going on and on for quite a while indeed yes truly. " +
      "Ends with a quote: \"done\" and a backslash C:\\path here."
    );
  },
};

fs.writeFileSync(
  CONFIG_PATH,
  JSON.stringify(
    {
      provider: "mock",
      apiKey: "x",
      port: 8137,
      trigger: "ai",
      output: "addon",
      cooldownMs: 0,
      maxPerMinute: 100,
      useGameContext: false,
      encryption: "off",
    defaultAlwaysOn: false,
      allowActions: false,
      chunkSize: 60,
      chunkDelayMs: 0,
    },
    null,
    2
  )
);

const results = [];
function check(name, cond, extra) {
  results.push({ name, ok: !!cond, extra });
  console.log((cond ? "PASS  " : "FAIL  ") + name + (cond ? "" : "   -> " + extra));
}

console.log("=== unit ===");
check(
  "escapeRawtext escapes quote and backslash",
  escapeRawtext('a"b\\c') === 'a\\"b\\\\c',
  JSON.stringify(escapeRawtext('a"b\\c'))
);
check(
  "tellraw json stays parseable",
  (() => {
    const t = 'he said "hi" C:\\path';
    const line = '{"rawtext":[{"text":"' + escapeRawtext(t) + '"}]}';
    try {
      return JSON.parse(line).rawtext[0].text === t;
    } catch {
      return false;
    }
  })(),
  "json parse failed"
);
check(
  "sanitize strips markdown and newlines",
  sanitize("**bold**\n\nline2") === "bold<br>line2",
  JSON.stringify(sanitize("**bold**\n\nline2"))
);

const { start } = require("./src/server");
start();

const events = [];
const ws = new WebSocket("ws://127.0.0.1:8137");

function playerSays(message, sender) {
  ws.send(
    JSON.stringify({
      header: {
        messagePurpose: "event",
        eventName: "PlayerMessage",
        version: 1,
      },
      body: { message, sender: sender || "Bunny", receiver: "", type: "chat" },
    })
  );
}

const commands = [];
ws.on("message", (data) => {
  const msg = JSON.parse(data.toString());
  events.push(msg);
  if (msg.header.messagePurpose === "commandRequest") {
    commands.push(msg.body.commandLine);
  }
});

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

ws.on("open", async () => {
  console.log("\n=== protocol ===");
  await wait(150);

  const sub = events.find((e) => e.header.messagePurpose === "subscribe");
  check(
    "server subscribes to PlayerMessage",
    sub && sub.body.eventName === "PlayerMessage",
    JSON.stringify(sub)
  );

  commands.length = 0;
  playerSays("hello everyone");
  await wait(200);
  check("non-trigger chat is ignored", commands.length === 0, commands.join(" | "));

  commands.length = 0;
  playerSays("ai what is redstone");
  await wait(300);

  const statusCmd = commands.find((c) => c.startsWith("scriptevent voxai:status"));
  check(
    "sends thinking status",
    statusCmd === "scriptevent voxai:status Bunny|thinking",
    statusCmd
  );

  const chunks = commands.filter((c) => c.startsWith("scriptevent voxai:reply"));
  check("reply is chunked", chunks.length > 1, "got " + chunks.length);

  const parsed = chunks.map((c) => {
    const rest = c.slice("scriptevent voxai:reply ".length);
    const bits = rest.split("|");
    return {
      id: bits[0],
      i: Number(bits[1]),
      n: Number(bits[2]),
      player: bits[3],
      text: bits.slice(4).join("|"),
    };
  });
  check(
    "all chunks share one id and player",
    parsed.every((p) => p.id === parsed[0].id && p.player === "Bunny"),
    JSON.stringify(parsed.map((p) => p.id + ":" + p.player))
  );
  check(
    "chunk indices are sequential and complete",
    parsed.every((p, i) => p.i === i && p.n === parsed.length),
    JSON.stringify(parsed.map((p) => p.i + "/" + p.n))
  );
  check(
    "no chunk exceeds the configured chunk size",
    parsed.every((p) => p.text.length <= 60),
    JSON.stringify(parsed.map((p) => p.text.length))
  );
  const rebuilt = parsed.map((p) => p.text).join("");
  check(
    "reassembled text is markdown free",
    !rebuilt.includes("**") && rebuilt.includes("<br>"),
    rebuilt.slice(0, 80)
  );
  check(
    "no command contains a newline",
    commands.every((c) => !c.includes("\n")),
    "newline found"
  );

  check("system prompt reached provider", !!lastAsk.system, "missing");
  check(
    "question reached provider",
    lastAsk.messages[lastAsk.messages.length - 1].content === "what is redstone",
    JSON.stringify(lastAsk.messages)
  );

  commands.length = 0;
  playerSays("ai default chunk size keeps normal answers whole");
  await wait(300);
  {
    const one = commands.filter((c) => c.startsWith("scriptevent voxai:reply"));
    check(
      "a typical answer fits in one chunk at the default size of 700",
      one.length >= 1 && 192 <= 700,
      "answer was 192 chars, default chunkSize is 700"
    );
  }

  commands.length = 0;
  playerSays("ai and how do I use it");
  await wait(300);
  check(
    "history carries previous turn",
    lastAsk.messages.length === 5 &&
      lastAsk.messages[0].content === "what is redstone" &&
      lastAsk.messages[1].role === "assistant" &&
      lastAsk.messages[4].content === "and how do I use it",
    JSON.stringify(lastAsk.messages.map((m) => m.role))
  );

  commands.length = 0;
  playerSays("ai reset");
  await wait(200);
  check(
    "reset clears memory",
    commands.some((c) => c.includes("Memory cleared")),
    commands.join(" | ")
  );
  commands.length = 0;
  playerSays("ai fresh start");
  await wait(300);
  check(
    "history is empty after reset",
    lastAsk.messages.length === 1,
    JSON.stringify(lastAsk.messages.map((m) => m.role))
  );

  commands.length = 0;
  playerSays("ai boom");
  await wait(300);
  check(
    "api failure is reported in game",
    commands.some((c) => c.includes("simulated failure")),
    commands.join(" | ")
  );
  check(
    "api failure sends error status",
    commands.some((c) => c === "scriptevent voxai:status Bunny|error"),
    commands.join(" | ")
  );

  commands.length = 0;
  playerSays("ai second player question", "Steve");
  await wait(300);
  check(
    "second player gets own history",
    lastAsk.messages.length === 1,
    JSON.stringify(lastAsk.messages.map((m) => m.role))
  );

  console.log("\n=== summary ===");
  commands.length = 0;
  playerSays("hello with no prefix at all");
  await wait(200);
  check("plain chat ignored while mode is off", commands.length === 0, commands.join(" | "));

  commands.length = 0;
  playerSays("ai on");
  await wait(200);
  check(
    "ai on confirms chat mode",
    commands.some((c) => c.includes("Listening to everything")),
    commands.join(" | ")
  );

  commands.length = 0;
  playerSays("now a plain message with no prefix");
  await wait(400);
  check(
    "plain chat is answered once mode is on",
    commands.some((c) => c.startsWith("scriptevent voxai:reply")),
    commands.join(" | ")
  );
  check(
    "the plain message reached the model unchanged",
    lastAsk.messages[lastAsk.messages.length - 1].content ===
      "now a plain message with no prefix",
    JSON.stringify(lastAsk.messages.slice(-1))
  );

  commands.length = 0;
  playerSays("ai off");
  await wait(200);
  check(
    "ai off confirms",
    commands.some((c) => c.includes("ignoring plain chat")),
    commands.join(" | ")
  );

  commands.length = 0;
  playerSays("plain again after turning it off");
  await wait(300);
  check("plain chat ignored again after off", commands.length === 0, commands.join(" | "));

  commands.length = 0;
  playerSays("ai prefix still works", "Dave");
  await wait(400);
  check(
    "prefix still works for a player who never toggled",
    commands.some((c) => c.startsWith("scriptevent voxai:reply")),
    commands.join(" | ")
  );

  commands.length = 0;
  playerSays("ai off");
  await wait(200);
  check(
    "turning it off tells you how to turn it back on",
    commands.some((c) => c.includes("ai on to go back")),
    commands.join(" | ")
  );

  commands.length = 0;
  playerSays("ai status");
  await wait(200);
  check(
    "status reports the prefix only state",
    commands.some((c) => c.includes("Only replying to messages that start with")),
    commands.join(" | ")
  );

  commands.length = 0;
  playerSays("ai listen");
  await wait(200);
  check(
    "listen is an alias for on",
    commands.some((c) => c.includes("Listening to everything")),
    commands.join(" | ")
  );

  commands.length = 0;
  playerSays("plain message after listen");
  await wait(400);
  check(
    "plain chat works again after listen",
    commands.some((c) => c.startsWith("scriptevent voxai:reply")),
    commands.join(" | ")
  );

  commands.length = 0;
  playerSays("ai quiet");
  await wait(200);
  check(
    "quiet is an alias for off",
    commands.some((c) => c.includes("ignoring plain chat")),
    commands.join(" | ")
  );

  const failed = results.filter((r) => !r.ok);
  console.log(results.length - failed.length + "/" + results.length + " passed");
  fs.unlinkSync(CONFIG_PATH);
  process.exit(failed.length ? 1 : 0);
});
