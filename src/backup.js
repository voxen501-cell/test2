const fs = require("fs");
const path = require("path");

// A copy of the whole world folder, kept outside Minecraft so the game cannot
// touch it. One backup per world: it is written on the first install and left
// alone after that, so "restore" always means the world as it was before the
// AI ever went near it.
//
// Backups are filed under the id in the world's voxen.json rather than its
// folder name, because a folder name changes when a world is exported and
// brought back, and the id does not. The same file sits in the backup, so a
// backup folder can always be traced to the world it came from.
//
// Restoring never edits the live world in place. The copy lands beside it and
// is swapped in at the end, so a copy that fails halfway leaves the world it
// found still standing.

const FOLDER = "World Backups";
const META_NAME = "voxen-backup.json";

function backupsRoot() {
  if (process.env.BEDROCK_AI_BACKUPS) return process.env.BEDROCK_AI_BACKUPS;
  // beside the exe when packaged, beside the project when run from source
  const base = process.pkg ? path.dirname(process.execPath) : path.join(__dirname, "..");
  return path.join(base, FOLDER);
}

function backupDir(voxenId) {
  return path.join(backupsRoot(), safeName(voxenId));
}

// world ids are base64ish and can hold / and +, neither of which is a filename
function safeName(id) {
  return String(id).replace(/[^A-Za-z0-9_.-]/g, "_");
}

function metaPath(voxenId) {
  return path.join(backupDir(voxenId), META_NAME);
}

function readMeta(voxenId) {
  try {
    return JSON.parse(fs.readFileSync(metaPath(voxenId), "utf8"));
  } catch (err) {
    return null;
  }
}

function measure(dir) {
  let bytes = 0;
  let files = 0;
  const walk = (d) => {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch (err) {
      return;
    }
    for (const entry of entries) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        try {
          bytes += fs.statSync(full).size;
          files++;
        } catch (err) {
          // a file the game is rewriting right now; it is still copied later
        }
      }
    }
  };
  walk(dir);
  return { bytes, files };
}

function copyTree(from, to, onFile) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) {
      copyTree(src, dst, onFile);
    } else if (entry.isFile()) {
      fs.copyFileSync(src, dst);
      if (onFile) onFile(fs.statSync(dst).size);
    }
  }
}

function exists(voxenId) {
  return !!voxenId && fs.existsSync(path.join(backupDir(voxenId), "level.dat"));
}

function info(voxenId) {
  if (!exists(voxenId)) return null;
  const meta = readMeta(voxenId) || {};
  return {
    id: voxenId,
    savedAt: meta.savedAt || null,
    bytes: meta.bytes || 0,
    files: meta.files || 0,
    name: meta.name || null,
    folder: backupDir(voxenId),
  };
}

// Copies the world out. Already having one is success, not an error: the whole
// point is that the first copy is the pristine one.
function save(worldDir, voxenId, worldName, onProgress) {
  if (exists(voxenId)) return { kept: true, ...info(voxenId) };

  const total = measure(worldDir);
  const dest = backupDir(voxenId);
  const staging = dest + ".partial";
  fs.rmSync(staging, { recursive: true, force: true });

  let done = 0;
  copyTree(worldDir, staging, (size) => {
    done += size;
    if (onProgress) onProgress(done, total.bytes);
  });

  fs.writeFileSync(
    path.join(staging, META_NAME),
    JSON.stringify({
      savedAt: Date.now(),
      id: voxenId,
      name: worldName,
      bytes: total.bytes,
      files: total.files,
    }, null, 2)
  );

  fs.rmSync(dest, { recursive: true, force: true });
  fs.renameSync(staging, dest);
  return { kept: false, ...info(voxenId) };
}

// Puts the saved copy back. The world is only removed once the replacement is
// fully written, so an interrupted restore cannot lose both.
function restore(worldDir, voxenId, onProgress) {
  if (!exists(voxenId)) throw new Error("There is no backup for this world.");

  const source = backupDir(voxenId);
  const total = measure(source);
  const staging = worldDir + ".restoring";
  fs.rmSync(staging, { recursive: true, force: true });

  let done = 0;
  copyTree(source, staging, (size) => {
    done += size;
    if (onProgress) onProgress(done, total.bytes);
  });

  // the backup's own record stays with the backup; voxen.json travels with the
  // world, so the restored copy keeps its identity
  fs.rmSync(path.join(staging, META_NAME), { force: true });

  const retired = worldDir + ".replaced";
  fs.rmSync(retired, { recursive: true, force: true });
  if (fs.existsSync(worldDir)) fs.renameSync(worldDir, retired);
  fs.renameSync(staging, worldDir);
  fs.rmSync(retired, { recursive: true, force: true });

  return { bytes: total.bytes, files: total.files };
}

function forget(voxenId) {
  fs.rmSync(backupDir(voxenId), { recursive: true, force: true });
}

module.exports = { backupsRoot, backupDir, measure, exists, info, save, restore, forget };
