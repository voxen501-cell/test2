// Copies the bridge into the app's assets. The Android app runs the very same
// JavaScript the desktop app does, so there is one implementation rather than
// a phone-shaped copy of it that drifts.
const fs = require("fs");
const path = require("path");

const bridge = path.resolve(__dirname, "..");  // the desktop bridge, one level up
const assets = path.join(__dirname, "app", "src", "main", "assets");
const out = path.join(assets, "bridge");

const src = path.join(bridge, "src");
if (!fs.existsSync(path.join(src, "server.js"))) {
  console.error("cannot find the bridge next to this project at " + bridge);
  process.exit(1);
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

// src carries app.html and the fonts folder, which are read from disk at
// runtime, so the whole directory goes rather than a list of js files
fs.cpSync(src, path.join(out, "src"), { recursive: true });
fs.cpSync(path.join(bridge, "node_modules", "ws"),
          path.join(out, "node_modules", "ws"), { recursive: true });

fs.writeFileSync(path.join(out, "package.json"), JSON.stringify({
  name: "bedrock-ai-bridge",
  private: true,
  main: "src/server.js",
  type: "commonjs",
  dependencies: { ws: "^8.21.3" },
}, null, 2) + "\n");

// the add-on the app hands to Minecraft
const pack = path.join(bridge, "..", "AI_Companion_Release", "AI_Companion.mcpack");
if (fs.existsSync(pack)) {
  fs.copyFileSync(pack, path.join(assets, "BedrockAI.mcpack"));
} else {
  console.warn("no mcpack found at " + pack + " - the install button will fail");
}

let files = 0;
let bytes = 0;
for (const [dir] of [[out]]) {
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else { files++; bytes += fs.statSync(full).size; }
    }
  };
  walk(dir);
}
console.log("packed " + files + " files, " + (bytes / 1024).toFixed(1) + " KB");
