const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const PACK_FILES = require("./packfiles");

const GAME_MODES = ["Survival", "Creative", "Adventure", "Spectator"];

// Everything needed to put the behaviour pack into Minecraft without the
// player downloading anything. The pack itself is baked into the exe.

const PACK_FOLDER = "AI Companion - BP";

function manifest() {
  return JSON.parse(
    Buffer.from(PACK_FILES["manifest.json"].base64, "base64").toString("utf8")
  );
}

// Minecraft for Windows keeps its data under the UWP package folder. The
// Preview build is a separate package, so look for both.
function candidateRoots() {
  const local = process.env.LOCALAPPDATA;
  const roots = [];
  if (local) {
    const packages = path.join(local, "Packages");
    for (const pkg of [
      "Microsoft.MinecraftUWP_8wekyb3d8bbwe",
      "Microsoft.MinecraftWindowsBeta_8wekyb3d8bbwe",
    ]) {
      roots.push(path.join(packages, pkg, "LocalState", "games", "com.mojang"));
    }
  }
  // the launcher's "Minecraft Bedrock" data folder, used by some installs
  if (process.env.APPDATA) {
    roots.push(
      path.join(
        process.env.APPDATA,
        "Minecraft Bedrock",
        "Users",
        "Shared",
        "games",
        "com.mojang"
      )
    );
  }
  return roots;
}

function findMinecraft() {
  for (const root of candidateRoots()) {
    try {
      if (fs.existsSync(path.join(root, "minecraftWorlds"))) return root;
    } catch (err) {
      // an unreadable candidate is simply not the one
    }
  }
  return null;
}

function writePack(root) {
  const dest = path.join(root, "development_behavior_packs", PACK_FOLDER);
  for (const [rel, file] of Object.entries(PACK_FILES)) {
    const target = path.join(dest, rel.split("/").join(path.sep));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, Buffer.from(file.base64, "base64"));
  }
  return dest;
}

function readWorldName(dir) {
  try {
    return fs.readFileSync(path.join(dir, "levelname.txt"), "utf8").trim();
  } catch (err) {
    return path.basename(dir);
  }
}

// level.dat is uncompressed Bedrock NBT. Rather than parse the whole tree,
// find the GameType int tag by its name and read the value behind it.
function readGameMode(worldDir) {
  try {
    const buf = fs.readFileSync(path.join(worldDir, "level.dat"));
    const key = Buffer.from("GameType", "utf8");
    let at = buf.indexOf(key);
    while (at > 3) {
      if (buf[at - 3] === 0x03 && buf.readUInt16LE(at - 2) === key.length) {
        return GAME_MODES[buf.readInt32LE(at + key.length)] || null;
      }
      at = buf.indexOf(key, at + 1);
    }
  } catch (err) {
    // a world mid-save, or one we cannot read, simply has no label
  }
  return null;
}

function iconPath(root, worldId) {
  const file = path.join(root, "minecraftWorlds", worldId, "world_icon.jpeg");
  return fs.existsSync(file) ? file : null;
}

// Documented deep link: minecraft://?load=<local level id>, and the level id
// is the world folder name.
function launchWorld(worldId) {
  const uri = "minecraft://?load=" + encodeURIComponent(worldId);
  const child = spawn("cmd", ["/c", "start", "", uri], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  return uri;
}

function listWorlds(root) {
  const dir = path.join(root, "minecraftWorlds");
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    let stat;
    try {
      stat = fs.statSync(full);
    } catch (err) {
      continue;
    }
    if (!stat.isDirectory()) continue;
    out.push({
      id: entry,
      name: readWorldName(full),
      played: stat.mtimeMs,
      installed: hasPack(full),
      mode: readGameMode(full),
      icon: !!iconPath(root, entry),
    });
  }
  return out.sort((a, b) => b.played - a.played);
}

function packListPath(worldDir) {
  return path.join(worldDir, "world_behavior_packs.json");
}

function readPackList(worldDir) {
  try {
    const raw = fs.readFileSync(packListPath(worldDir), "utf8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (err) {
    return [];
  }
}

function hasPack(worldDir) {
  const id = manifest().header.uuid;
  return readPackList(worldDir).some((p) => p.pack_id === id);
}

// Adds the pack to a world's list so it is on the next time the world loads.
function enableInWorld(root, worldId) {
  const worldDir = path.join(root, "minecraftWorlds", worldId);
  if (!fs.existsSync(worldDir)) throw new Error("that world is not there any more");

  const head = manifest().header;
  const list = readPackList(worldDir).filter((p) => p.pack_id !== head.uuid);
  list.push({ pack_id: head.uuid, version: head.version });
  fs.writeFileSync(packListPath(worldDir), JSON.stringify(list, null, 2));
  return readWorldName(worldDir);
}

function install(worldId) {
  const root = findMinecraft();
  if (!root) {
    throw new Error(
      "Could not find Minecraft. Open Minecraft once, then try again."
    );
  }
  const dest = writePack(root);
  const result = { root, dest, version: manifest().header.version.join("."), world: null };
  if (worldId) result.world = enableInWorld(root, worldId);
  return result;
}

module.exports = {
  findMinecraft,
  listWorlds,
  install,
  enableInWorld,
  manifest,
  iconPath,
  launchWorld,
};
