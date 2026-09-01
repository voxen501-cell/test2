const ID = /^[a-z][a-z0-9_]{0,39}$/;
const TIME_WORDS = ["day", "night", "noon", "midnight", "sunrise", "sunset"];
const WEATHER = ["clear", "rain", "thunder"];
const MODES = ["survival", "creative", "adventure", "spectator"];
const DIFFICULTY = ["peaceful", "easy", "normal", "hard"];

const BLOCKED_MOBS = ["ender_dragon"];

const SOUND = /^[a-z0-9_.]{1,60}$/;
const NAMESPACED = /^(?:[a-z_]+:)?[a-z0-9_.]{1,60}$/;
const TEXT = /^[A-Za-z0-9 ,.!?'()_-]{1,120}$/;

const GAMERULES = [
  "dodaylightcycle", "domobspawning", "dofiretick", "keepinventory",
  "mobgriefing", "doweathercycle", "falldamage", "firedamage",
  "drowningdamage", "pvp", "showcoordinates", "doimmediaterespawn",
  "naturalregeneration", "tntexplodes", "doentitydrops", "dotiledrops",
  "showdeathmessages", "randomtickspeed", "sendcommandfeedback",
];

const ENCHANTS = /^[a-z_]{1,30}$/;

function quote(name) {
  return '"' + String(name).replace(/["\\]/g, "") + '"';
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function coord(text) {
  if (text === "~") return "~";
  const m = String(text).match(/^~?(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const rel = String(text).startsWith("~");
  const value = clamp(Number(m[1]), -30000000, 30000000);
  if (!Number.isFinite(value)) return null;
  return rel ? "~" + value : String(Math.round(value));
}

const ACTIONS = {
  give: {
    usage: "give <item> <count>",
    describe: "give the player an item, count 1 to 64",
    build(args, player) {
      const item = String(args[0] || "").toLowerCase().replace(/^minecraft:/, "");
      if (!ID.test(item)) return null;
      const count = clamp(parseInt(args[1], 10) || 1, 1, 64);
      return {
        command: "give " + quote(player) + " minecraft:" + item + " " + count,
        say: "Gave you " + count + " " + item.replace(/_/g, " ") + ".",
      };
    },
  },

  time: {
    usage: "time <day|night|noon|midnight|sunrise|sunset|0-24000>",
    describe: "set the time of day",
    build(args) {
      const value = String(args[0] || "").toLowerCase();
      if (TIME_WORDS.includes(value)) {
        return { command: "time set " + value, say: "Set the time to " + value + "." };
      }
      const ticks = parseInt(value, 10);
      if (!Number.isFinite(ticks)) return null;
      const safe = clamp(ticks, 0, 24000);
      return { command: "time set " + safe, say: "Set the time to " + safe + "." };
    },
  },

  weather: {
    usage: "weather <clear|rain|thunder>",
    describe: "change the weather",
    build(args) {
      const value = String(args[0] || "").toLowerCase();
      if (!WEATHER.includes(value)) return null;
      return { command: "weather " + value, say: "Weather set to " + value + "." };
    },
  },

  tp: {
    usage: "tp <x> <y> <z>  or  tp <playername>",
    describe: "teleport the player to coordinates or to another player",
    build(args, player) {
      if (args.length === 1) {
        const target = String(args[0]);
        if (!/^[A-Za-z0-9_ ]{1,20}$/.test(target)) return null;
        return {
          command: "tp " + quote(player) + " " + quote(target),
          say: "Teleported you to " + target + ".",
        };
      }
      const x = coord(args[0]);
      const y = coord(args[1]);
      const z = coord(args[2]);
      if (x === null || y === null || z === null) return null;
      return {
        command: "tp " + quote(player) + " " + x + " " + y + " " + z,
        say: "Teleported you to " + x + " " + y + " " + z + ".",
      };
    },
  },

  gamemode: {
    usage: "gamemode <survival|creative|adventure|spectator>",
    describe: "change the player's game mode",
    build(args, player) {
      const mode = String(args[0] || "").toLowerCase();
      if (!MODES.includes(mode)) return null;
      return {
        command: "gamemode " + mode + " " + quote(player),
        say: "Switched you to " + mode + " mode.",
      };
    },
  },

  effect: {
    usage: "effect <name> <seconds> <level>",
    describe: "give the player a status effect",
    build(args, player) {
      const name = String(args[0] || "").toLowerCase().replace(/^minecraft:/, "");
      if (!ID.test(name)) return null;
      const seconds = clamp(parseInt(args[1], 10) || 30, 1, 3600);
      const level = clamp(parseInt(args[2], 10) || 0, 0, 4);
      return {
        command: "effect " + quote(player) + " " + name + " " + seconds + " " + level,
        say: "Gave you " + name.replace(/_/g, " ") + " for " + seconds + " seconds.",
      };
    },
  },

  heal: {
    usage: "heal",
    describe: "restore the player's health",
    build(args, player) {
      return {
        command: "effect " + quote(player) + " instant_health 1 10",
        say: "Healed you up.",
      };
    },
  },

  difficulty: {
    usage: "difficulty <peaceful|easy|normal|hard>",
    describe: "change the world difficulty",
    build(args) {
      const value = String(args[0] || "").toLowerCase();
      if (!DIFFICULTY.includes(value)) return null;
      return { command: "difficulty " + value, say: "Difficulty set to " + value + "." };
    },
  },

  summon: {
    usage: "summon <mob> [count] [baby|spawnevent]",
    describe:
      "spawn mobs near the player. count up to 10. add baby for a baby, or a spawn event such as minecraft:spawn_farmer",
    build(args) {
      const mob = String(args[0] || "").toLowerCase().replace(/^minecraft:/, "");
      if (!ID.test(mob) || BLOCKED_MOBS.includes(mob)) return null;

      let count = 1;
      let variant = null;
      for (const arg of args.slice(1)) {
        const asNumber = parseInt(arg, 10);
        if (Number.isFinite(asNumber) && String(asNumber) === String(arg)) {
          count = clamp(asNumber, 1, 10);
        } else if (arg) {
          variant = String(arg).toLowerCase();
        }
      }

      let event = null;
      let label = "";
      if (variant === "baby" || variant === "child") {
        event = "minecraft:entity_born";
        label = "baby ";
      } else if (variant) {
        const cleaned = variant.includes(":") ? variant : "minecraft:" + variant;
        if (!NAMESPACED.test(cleaned)) return null;
        event = cleaned;
      }

      const tail = " ~ ~ ~2" + (event ? " " + event : "");
      const commands = [];
      for (let i = 0; i < count; i++) {
        commands.push("summon minecraft:" + mob + tail);
      }
      return {
        commands,
        say:
          "Spawned " + count + " " + label + mob.replace(/_/g, " ") +
          (count > 1 ? "s" : "") + " near you.",
      };
    },
  },



  clear: {
    usage: "clear <radius> [block]",
    describe:
      "clear blocks around the player, radius up to 12. name a block to remove only that kind, for example clear 8 leaves",
    build(args) {
      const radius = clamp(parseInt(args[0], 10) || 4, 1, 12);
      const only = args[1]
        ? String(args[1]).toLowerCase().replace(/^minecraft:/, "")
        : null;
      if (only && !ID.test(only)) return null;
      const lo = "~-" + radius + " ~-" + radius + " ~-" + radius;
      const hi = "~" + radius + " ~" + radius + " ~" + radius;
      if (only) {
        return {
          command: "fill " + lo + " " + hi + " air 0 replace " + only,
          say: "Cleared the " + only.replace(/_/g, " ") + " around you.",
        };
      }
      return {
        command: "fill " + lo + " " + hi + " air",
        say: "Cleared everything within " + radius + " blocks of you.",
      };
    },
  },

  fill: {
    usage: "fill <x1> <y1> <z1> <x2> <y2> <z2> <block>",
    describe: "fill a box with a block, at most 30 blocks along any side",
    build(args) {
      const nums = args.slice(0, 6).map(coord);
      if (nums.some((n) => n === null)) return null;
      const block = String(args[6] || "").toLowerCase().replace(/^minecraft:/, "");
      if (!ID.test(block)) return null;

      const relative = nums.map((n) => String(n).startsWith("~"));
      for (let axis = 0; axis < 3; axis++) {
        if (relative[axis] !== relative[axis + 3]) return null;
        const a = parseFloat(String(nums[axis]).replace("~", "") || "0");
        const b = parseFloat(String(nums[axis + 3]).replace("~", "") || "0");
        if (Math.abs(b - a) + 1 > 30) return null;
      }
      return {
        command: "fill " + nums.join(" ") + " minecraft:" + block,
        say: "Filled that area with " + block.replace(/_/g, " ") + ".",
      };
    },
  },

  wait: {
    usage: "wait <seconds>",
    describe: "pause before the next action, 1 to 10 seconds",
    build(args) {
      const secs = clamp(parseFloat(args[0]) || 1, 0.2, 10);
      return { delay: Math.round(secs * 1000), say: "" };
    },
  },

  playsound: {
    usage: "playsound <sound>",
    describe: "play a sound at the player, for example mob.cow.say",
    build(args, player) {
      const sound = String(args[0] || "").toLowerCase();
      if (!SOUND.test(sound)) return null;
      return {
        command: "playsound " + sound + " " + quote(player),
        say: "Played " + sound + ".",
      };
    },
  },

  stopsound: {
    usage: "stopsound",
    describe: "stop all sounds playing for the player",
    build(args, player) {
      return { command: "stopsound " + quote(player), say: "Stopped the sounds." };
    },
  },

  particle: {
    usage: "particle <name>",
    describe: "show a particle effect at the player",
    build(args) {
      const name = String(args[0] || "").toLowerCase();
      if (!NAMESPACED.test(name)) return null;
      const full = name.includes(":") ? name : "minecraft:" + name;
      return { command: "particle " + full + " ~ ~1 ~", say: "" };
    },
  },

  title: {
    usage: "title <text>",
    describe: "show big text on the player's screen",
    build(args, player) {
      const text = args.join(" ");
      if (!TEXT.test(text)) return null;
      return {
        command: "title " + quote(player) + " title " + text,
        say: "",
      };
    },
  },

  actionbar: {
    usage: "actionbar <text>",
    describe: "show a small line of text above the hotbar",
    build(args, player) {
      const text = args.join(" ");
      if (!TEXT.test(text)) return null;
      return { command: "title " + quote(player) + " actionbar " + text, say: "" };
    },
  },

  setblock: {
    usage: "setblock <x> <y> <z> <block>",
    describe: "place one block at those coordinates",
    build(args) {
      const x = coord(args[0]);
      const y = coord(args[1]);
      const z = coord(args[2]);
      const block = String(args[3] || "").toLowerCase().replace(/^minecraft:/, "");
      if (x === null || y === null || z === null || !ID.test(block)) return null;
      return {
        command: "setblock " + x + " " + y + " " + z + " minecraft:" + block,
        say: "Placed " + block.replace(/_/g, " ") + ".",
      };
    },
  },

  enchant: {
    usage: "enchant <enchantment> <level>",
    describe: "enchant the item the player is holding",
    build(args, player) {
      const name = String(args[0] || "").toLowerCase().replace(/^minecraft:/, "");
      if (!ENCHANTS.test(name)) return null;
      const level = clamp(parseInt(args[1], 10) || 1, 1, 5);
      return {
        command: "enchant " + quote(player) + " " + name + " " + level,
        say: "Enchanted your item with " + name.replace(/_/g, " ") + " " + level + ".",
      };
    },
  },

  killmob: {
    usage: "killmob <mob>",
    describe: "remove nearby mobs of one type, never players",
    build(args) {
      const mob = String(args[0] || "").toLowerCase().replace(/^minecraft:/, "");
      if (!ID.test(mob) || mob === "player") return null;
      return {
        command: "kill @e[type=minecraft:" + mob + ",r=40]",
        say: "Cleared nearby " + mob.replace(/_/g, " ") + "s.",
      };
    },
  },

  spawnpoint: {
    usage: "spawnpoint",
    describe: "set the player's respawn point where they stand",
    build(args, player) {
      return { command: "spawnpoint " + quote(player), say: "Set your spawn point here." };
    },
  },

  gamerule: {
    usage: "gamerule <rule> <value>",
    describe: "change a game rule such as keepinventory or domobspawning",
    build(args) {
      const rule = String(args[0] || "").toLowerCase();
      if (!GAMERULES.includes(rule)) return null;
      let value = String(args[1] || "").toLowerCase();
      if (rule === "randomtickspeed") {
        value = String(clamp(parseInt(value, 10) || 1, 0, 100));
      } else if (value === "true" || value === "on" || value === "yes") {
        value = "true";
      } else if (value === "false" || value === "off" || value === "no") {
        value = "false";
      } else {
        return null;
      }
      return { command: "gamerule " + rule + " " + value, say: "Set " + rule + " to " + value + "." };
    },
  },

  camerashake: {
    usage: "camerashake <seconds>",
    describe: "shake the player's camera",
    build(args, player) {
      const secs = clamp(parseFloat(args[0]) || 1, 0.1, 10);
      return {
        command: "camerashake add " + quote(player) + " 1 " + secs + " positional",
        say: "",
      };
    },
  },

  damage: {
    usage: "damage <amount>",
    describe: "hurt the player by a number of half hearts",
    build(args, player) {
      const amount = clamp(parseInt(args[0], 10) || 1, 1, 20);
      return {
        command: "damage " + quote(player) + " " + amount,
        say: "That hurt for " + amount + ".",
      };
    },
  },

  fog: {
    usage: "fog <fogid>",
    describe: "apply a fog setting to the player",
    build(args, player) {
      const id = String(args[0] || "").toLowerCase();
      if (!NAMESPACED.test(id)) return null;
      const full = id.includes(":") ? id : "minecraft:fog_" + id;
      return {
        command: "fog " + quote(player) + " push " + full + " voxai_fog",
        say: "",
      };
    },
  },

  xp: {
    usage: "xp <amount>",
    describe: "give experience points, up to 5000 at a time",
    build(args, player) {
      const amount = clamp(parseInt(args[0], 10) || 0, 1, 5000);
      return {
        command: "xp " + amount + " " + quote(player),
        say: "Gave you " + amount + " experience.",
      };
    },
  },
};

function actionList(enabled) {
  const names = enabled && enabled.length ? enabled : Object.keys(ACTIONS);
  return names
    .filter((n) => ACTIONS[n])
    .map((n) => "  ACTION " + ACTIONS[n].usage + "   - " + ACTIONS[n].describe);
}

function promptSection(enabled) {
  const list = actionList(enabled);
  if (!list.length) return "";
  const NL = String.fromCharCode(10);
  return (
    "You can actually do things in the world, not just talk about them." + NL +
    "When the player asks you to do one of these, put each on its own line at the " +
    "very end of your reply, exactly in this form, with no punctuation around it:" + NL +
    list.join(NL) + NL +
    "They run in the order you write them, so to do something several times just " +
    "write the line several times, and put ACTION wait 1 between them if they " +
    "should be spaced out. You may write up to twenty lines. " +
    "Only use actions the player actually asked for. " +
    "Say what you did in normal words as well, but never write the word ACTION " +
    "anywhere except on those lines. If the player asks for something not in " +
    "that list, tell them you cannot do it."
  );
}

function extract(text, player, enabled, maxActions) {
  const allowed = enabled && enabled.length ? enabled : Object.keys(ACTIONS);
  const cap = Number.isFinite(maxActions) ? maxActions : 20;
  const lines = String(text).split(/\r?\n/);
  const kept = [];
  const actions = [];
  const rejected = [];

  for (const line of lines) {
    const m = line.trim().match(/^ACTION[:\s]+(.+)$/i);
    if (!m) {
      kept.push(line);
      continue;
    }
    const parts = m[1].trim().split(/\s+/);
    const name = parts.shift().toLowerCase();
    const spec = ACTIONS[name];
    if (!spec || !allowed.includes(name)) {
      rejected.push(name);
      continue;
    }
    if (actions.length >= cap) {
      rejected.push(name);
      continue;
    }
    const built = spec.build(parts, player);
    if (!built) {
      rejected.push(name);
      continue;
    }
    if (built.commands) {
      for (const command of built.commands) {
        if (actions.length >= cap) break;
        actions.push({ name, command, say: "" });
      }
      if (built.say) actions[actions.length - 1].say = built.say;
    } else {
      actions.push({ name, ...built });
    }
  }

  return { text: kept.join("\n").trim(), actions, rejected };
}

module.exports = { ACTIONS, extract, promptSection, actionList };
