// Installing copies the whole world out first, so "restore my world" can put
// back exactly what was there. These tests build a throwaway world, install
// into it, change it, and check the original really comes back.
const fs = require("fs");
const os = require("os");
const path = require("path");

const results = [];
function check(label, ok, extra) {
  results.push(!!ok);
  console.log((ok ? "PASS  " : "FAIL  ") + label + (ok ? "" : "   -> " + extra));
}

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "voxen-"));
const root = path.join(sandbox, "com.mojang");
const worldId = "TestWorld";
const worldDir = path.join(root, "minecraftWorlds", worldId);
fs.mkdirSync(path.join(worldDir, "db"), { recursive: true });
fs.writeFileSync(path.join(worldDir, "levelname.txt"), "Backup Test");
fs.writeFileSync(path.join(worldDir, "level.dat"), Buffer.alloc(128));
fs.writeFileSync(path.join(worldDir, "db", "CURRENT"), "original chunk data");

// point both the game root and the backup store at the sandbox
process.env.BEDROCK_AI_ROOT = root;
process.env.BEDROCK_AI_BACKUPS = path.join(sandbox, "World Backups");

const backups = require("./src/backup");
const installer = require("./src/install");

const ORIGINAL = [{ pack_id: "11111111-1111-1111-1111-111111111111", version: [1, 0, 0] }];
const listFile = path.join(worldDir, "world_behavior_packs.json");
fs.writeFileSync(listFile, JSON.stringify(ORIGINAL, null, 2));

const packList = () => JSON.parse(fs.readFileSync(listFile, "utf8"));

try {
  const done = installer.enableInWorld(root, worldId);
  check("the world keeps the pack it already had", packList().length === 2, JSON.stringify(packList()));

  const stamp = JSON.parse(fs.readFileSync(path.join(worldDir, "voxen.json"), "utf8"));
  check("voxen.json is written into the world", !!stamp.id, JSON.stringify(stamp));
  check("install reports the same id", done.voxenId === stamp.id, done.voxenId + " vs " + stamp.id);

  const backupDir = backups.backupDir(stamp.id);
  check("the whole world was copied out", fs.existsSync(path.join(backupDir, "db", "CURRENT")));
  check("the copy carries the same voxen.json",
    JSON.parse(fs.readFileSync(path.join(backupDir, "voxen.json"), "utf8")).id === stamp.id);

  const meta = JSON.parse(fs.readFileSync(path.join(backupDir, "voxen-backup.json"), "utf8"));
  check("the backup records which world it is", meta.id === stamp.id && meta.name === "Backup Test",
    JSON.stringify(meta));
  check("the backup predates the install",
    JSON.parse(fs.readFileSync(path.join(backupDir, "world_behavior_packs.json"), "utf8")).length === 1);

  // installing again must not overwrite the pristine copy
  installer.enableInWorld(root, worldId);
  const meta2 = JSON.parse(fs.readFileSync(path.join(backupDir, "voxen-backup.json"), "utf8"));
  check("installing again keeps the first backup", meta2.savedAt === meta.savedAt);

  // now wreck the world the way playing with the AI would change it
  fs.writeFileSync(path.join(worldDir, "db", "CURRENT"), "chunks changed by playing");
  fs.writeFileSync(path.join(worldDir, "db", "NEW"), "a file that did not exist before");

  const back = installer.restoreWorld(0, worldId);
  check("restore reports the world", back.name === "Backup Test", JSON.stringify(back));
  check("the original chunk data is back",
    fs.readFileSync(path.join(worldDir, "db", "CURRENT"), "utf8") === "original chunk data");
  check("files added after the backup are gone", !fs.existsSync(path.join(worldDir, "db", "NEW")));
  check("the AI pack is gone from the list", packList().length === 1, JSON.stringify(packList()));
  check("nothing was left half-copied",
    !fs.existsSync(worldDir + ".restoring") && !fs.existsSync(worldDir + ".replaced"));

  const details = installer.worldDetails(0, worldId);
  check("details still find the world", details.name === "Backup Test", JSON.stringify(details.name));
  check("details report a size", details.bytes > 0, String(details.bytes));
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true });
}

console.log("=== summary ===");
const failed = results.filter((r) => !r).length;
console.log(results.length - failed + "/" + results.length + " passed");
process.exit(failed ? 1 : 0);
