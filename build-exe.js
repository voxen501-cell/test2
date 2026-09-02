// Builds against the branded base from brand-exe.js. PKG_NODE_PATH names the
// base to use and makes pkg skip its hash check, which a branded base fails.
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const base = path.join(__dirname, ".pkg-base", "base-win-x64.exe");
if (!fs.existsSync(base)) {
  console.error("run brand-exe.js first");
  process.exit(1);
}

execFileSync(process.execPath, [
  path.join(__dirname, "node_modules", "@yao-pkg", "pkg", "lib-es5", "bin.js"),
  ".",
  "--output", path.join("dist", "Bedrock AI.exe"),
], {
  stdio: "inherit",
  cwd: __dirname,
  env: { ...process.env, PKG_NODE_PATH: base },
});
