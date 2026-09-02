// pkg has no icon option, and stamping the finished exe corrupts it: pkg
// appends its payload after the PE, and rewriting resources moves the overlay
// out from under it, so the exe dies with a SyntaxError on launch.
//
// The icon goes onto the base binary instead, and pkg appends the payload to an
// already-branded shell. pkg normally refuses a modified base ("Binary hash
// does NOT match"), but PKG_NODE_PATH both points it at a specific base and
// skips that check - build-exe.js sets it to what this writes.
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const OUT_DIR = path.join(__dirname, ".pkg-base");
const OUT = path.join(OUT_DIR, "base-win-x64.exe");
const icon = path.join(__dirname, "icon.ico");
const version = require("./package.json").version + ".0";

function findFetchedBase() {
  const root = path.join(os.homedir(), ".pkg-cache");
  if (!fs.existsSync(root)) return null;
  for (const dir of fs.readdirSync(root)) {
    const full = path.join(root, dir);
    if (!fs.statSync(full).isDirectory()) continue;
    for (const file of fs.readdirSync(full)) {
      if (file.startsWith("fetched-") && file.endsWith("win-x64")) {
        return path.join(full, file);
      }
    }
  }
  return null;
}

const source = findFetchedBase();
if (!source) {
  console.error("No pkg base binary cached yet. Run the build once so pkg fetches one.");
  process.exit(1);
}

// rebuild the branded base whenever pkg has fetched a newer one
const fresh = fs.statSync(source).mtimeMs;
if (fs.existsSync(OUT) && fs.statSync(OUT).mtimeMs > fresh) {
  console.log("branded base is current");
  process.exit(0);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const tmp = OUT + ".tmp";
execFileSync(process.execPath, [
  path.join(__dirname, "node_modules", "resedit-cli", "dist", "cli.js"),
  "--in", source,
  "--out", tmp,
  "--icon", "1," + icon,
  "--product-name", "Bedrock AI",
  "--product-version", version,
  "--file-description", "Bedrock AI - talk to a real AI inside Minecraft",
  "--file-version", version,
  "--company-name", "VoxenMC",
  "--original-filename", "Bedrock AI.exe",
], { stdio: "inherit" });

fs.renameSync(tmp, OUT);
console.log("branded base binary -> " + path.relative(__dirname, OUT));
