const fs = require("fs");
const path = require("path");
const { command, newRequestId, sendPayload } = require("./protocol");

const DIMENSIONS = { 0: "the Overworld", 1: "the Nether", 2: "the End" };

const FACT_LABELS = {
  standing_on: "The block directly under the player is",
  facing: "The player is facing",
  health: "Player health is",
  held: "The player is holding",
  wearing: "The player is wearing",
  xp_level: "Player experience level is",
  biome: "The biome is",
  weather: "The weather is",
};

function parseScoreboard(body) {
  if (!body) return [];
  const text = String(body.statusMessage || body.details || "");
  const found = [];
  const seen = new Set();
  const pattern = /([a-z_]+)=([A-Za-z0-9_. -]+)/g;
  let m;
  while ((m = pattern.exec(text)) !== null) {
    const key = m[1];
    if (!FACT_LABELS[key] || seen.has(key)) continue;
    seen.add(key);
    found.push({ key, value: m[2].trim() });
  }
  return found;
}

const PASSIVE_EVENTS = [
  "BlockBroken",
  "BlockPlaced",
  "MobKilled",
  "ItemAcquired",
  "ItemCrafted",
  "PlayerDied",
];

function prettyName(id) {
  if (!id) return null;
  return String(id)
    .replace(/^minecraft:/, "")
    .replace(/_/g, " ")
    .trim();
}

function timeOfDay(ticks) {
  const t = ((ticks % 24000) + 24000) % 24000;
  if (t < 1000) return "sunrise";
  if (t < 6000) return "morning";
  if (t < 8000) return "midday";
  if (t < 12000) return "afternoon";
  if (t < 13000) return "sunset";
  if (t < 18000) return "night";
  if (t < 23000) return "late night";
  return "just before dawn";
}

function topEntries(counter, limit) {
  return Object.entries(counter)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([k, v]) => (v > 1 ? k + " x" + v : k));
}

function findWorldName(root) {
  try {
    const dir = path.join(root, "minecraftWorlds");
    if (!fs.existsSync(dir)) return null;
    let best = null;
    for (const entry of fs.readdirSync(dir)) {
      const nameFile = path.join(dir, entry, "levelname.txt");
      if (!fs.existsSync(nameFile)) continue;
      const stat = fs.statSync(path.join(dir, entry));
      if (!best || stat.mtimeMs > best.mtime) {
        best = { mtime: stat.mtimeMs, name: fs.readFileSync(nameFile, "utf8").trim() };
      }
    }
    return best ? best.name : null;
  } catch (err) {
    return null;
  }
}

function createContext(cfg, log) {
  const pending = new Map();
  const activity = {
    broken: {},
    placed: {},
    killed: {},
    acquired: {},
    crafted: {},
    deaths: 0,
  };
  let worldName = null;
  let worldNameChecked = false;
  const lastRaw = {};

  function handleResponse(msg) {
    const id = msg.header && msg.header.requestId;
    if (!id) return false;
    const entry = pending.get(id);
    if (!entry) return false;
    pending.delete(id);
    clearTimeout(entry.timer);
    lastRaw[entry.line] = msg.body || {};
    entry.resolve(msg.body || {});
    return true;
  }

  function run(ws, line, timeoutMs) {
    return new Promise((resolve) => {
      if (ws.readyState !== ws.OPEN) return resolve(null);
      const id = newRequestId();
      const timer = setTimeout(() => {
        pending.delete(id);
        lastRaw[line] = { _timedOut: true };
        resolve(null);
      }, timeoutMs || 1500);
      pending.set(id, { resolve, timer, line });
      sendPayload(ws, command(line, id));
    });
  }

  function note(eventName, body) {
    if (!body) return;
    const bump = (bucket, key) => {
      if (!key) return;
      bucket[key] = (bucket[key] || 0) + 1;
    };
    if (eventName === "BlockBroken") {
      bump(activity.broken, prettyName(body.block && body.block.id));
    } else if (eventName === "BlockPlaced") {
      bump(activity.placed, prettyName(body.block && body.block.id));
    } else if (eventName === "MobKilled") {
      const victim = body.victim || body.targetEntity || {};
      bump(activity.killed, prettyName(victim.type || victim.id));
    } else if (eventName === "ItemAcquired") {
      bump(activity.acquired, prettyName(body.item && body.item.id));
    } else if (eventName === "ItemCrafted") {
      bump(activity.crafted, prettyName(body.item && body.item.id));
    } else if (eventName === "PlayerDied") {
      activity.deaths++;
    }
  }

  function parseNumber(body) {
    if (!body) return null;
    const text = body.statusMessage || body.message || "";
    const m = String(text).match(/-?\d+/);
    return m ? Number(m[0]) : null;
  }

  function parseQueryTarget(body) {
    if (!body) return null;
    const raw = body.details || body.statusMessage;
    if (!raw) return null;
    try {
      const data = typeof raw === "string" ? JSON.parse(raw) : raw;
      const first = Array.isArray(data) ? data[0] : data;
      if (!first || !first.position) return null;
      return {
        x: Math.round(first.position.x),
        y: Math.round(first.position.y),
        z: Math.round(first.position.z),
        dimension: DIMENSIONS[first.dimension] || "an unknown dimension",
      };
    } catch (err) {
      return null;
    }
  }

  function unknownNote(known) {
    const missing = Object.keys(FACT_LABELS).filter((k) => !known.has(k));
    const readable = {
      standing_on: "the block they are standing on",
      facing: "which way they are facing",
      health: "their health",
      held: "what they are holding",
      wearing: "their armour",
      xp_level: "their experience level",
      biome: "the biome",
      weather: "the weather",
    };
    if (!missing.length) {
      return (
        "Everything above is measured from the live game, so state it as fact. " +
        "Anything not listed above you cannot see, so say so instead of guessing."
      );
    }
    return (
      "You cannot see " +
      missing.map((k) => readable[k]).join(", ") +
      ". If asked about any of those, say plainly that you cannot see it. " +
      "Never name a block or item as if you observed it, and never infer one from the coordinates."
    );
  }

  async function snapshot(ws, playerName) {
    if (!worldNameChecked) {
      worldNameChecked = true;
      worldName = findWorldName(cfg.gameRoot || path.join(__dirname, "..", ".."));
    }

    const selector = '@a[name="' + playerName.replace(/"/g, "") + '"]';
    const [target, daytime, day, list, board] = await Promise.all([
      run(ws, "querytarget " + selector),
      run(ws, "time query daytime"),
      run(ws, "time query day"),
      run(ws, "list"),
      run(ws, "scoreboard players list"),
    ]);

    const lines = [];
    lines.push(
      "You are talking to the player named " + playerName +
        ". Use their name naturally now and then, and remember that anything " +
        "they ask you to do is for them."
    );

    const now = new Date();
    lines.push(
      "Real world date and time right now: " +
        now.toLocaleDateString("en-US", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
        }) +
        ", " +
        now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) +
        ". This is authoritative, never guess the date."
    );

    if (worldName) lines.push("World name: " + worldName);

    const pos = parseQueryTarget(target);
    if (pos) {
      lines.push("Player is in " + pos.dimension + " at x " + pos.x + ", y " + pos.y + ", z " + pos.z + ".");
      if (pos.dimension === DIMENSIONS[0]) {
        if (pos.y < 0) lines.push("That depth is far below sea level.");
        else if (pos.y < 45) lines.push("That depth is below sea level.");
        else if (pos.y > 100) lines.push("That is high above sea level.");
      }
    }

    const ticks = parseNumber(daytime);
    if (ticks !== null) {
      lines.push("It is " + timeOfDay(ticks) + " in game.");
    }
    const dayNum = parseNumber(day);
    if (dayNum !== null) lines.push("The world is on day " + dayNum + ".");

    if (list && list.statusMessage) {
      const players = String(list.statusMessage).split("\n").pop().trim();
      if (players) lines.push("Players online: " + players);
    }

    const facts = parseScoreboard(board);
    for (const fact of facts) {
      lines.push(FACT_LABELS[fact.key] + " " + fact.value + ".");
    }
    const known = new Set(facts.map((f) => f.key));

    const recent = [];
    const broken = topEntries(activity.broken, 4);
    if (broken.length) recent.push("mined " + broken.join(", "));
    const killed = topEntries(activity.killed, 3);
    if (killed.length) recent.push("killed " + killed.join(", "));
    const crafted = topEntries(activity.crafted, 3);
    if (crafted.length) recent.push("crafted " + crafted.join(", "));
    const placed = topEntries(activity.placed, 3);
    if (placed.length) recent.push("placed " + placed.join(", "));
    if (activity.deaths) recent.push("died " + activity.deaths + " time(s)");
    if (recent.length) lines.push("Recently the player " + recent.join("; ") + ".");

    if (!lines.length) return "";
    lines.push(unknownNote(known));

    const NL = String.fromCharCode(10);
    return (
      "Here is what is happening in the world right now. Use it when it helps, " +
      "and do not read it out as a list unless asked." +
      NL +
      lines.join(NL)
    );
  }

  function rawReport() {
    const out = [];
    for (const [line, body] of Object.entries(lastRaw)) {
      if (body && body._timedOut) {
        out.push(line + " -> NO RESPONSE (timed out)");
      } else {
        const shown = body && (body.details || body.statusMessage);
        out.push(line + " -> " + (shown ? String(shown).slice(0, 220) : JSON.stringify(body).slice(0, 220)));
      }
    }
    if (!out.length) out.push("No commands have been run yet.");
    return out;
  }

  return { run, note, snapshot, handleResponse, rawReport, activity, PASSIVE_EVENTS };
}

module.exports = {
  createContext,
  PASSIVE_EVENTS,
  timeOfDay,
  prettyName,
  parseScoreboard,
};
