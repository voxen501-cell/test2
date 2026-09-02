// libnode.so is about 60 MB per architecture, so it is fetched rather than
// committed. Run this once after cloning, before the first build.
//
// The headers come along too: nothing here includes them today, but a JNI
// wrapper that grows past calling node::Start will want them.
const fs = require("fs");
const https = require("https");
const path = require("path");
const { execFileSync } = require("child_process");

const VERSION = "v18.20.4";
const URL = "https://github.com/nodejs-mobile/nodejs-mobile/releases/download/" +
  VERSION + "/nodejs-mobile-" + VERSION + "-android.zip";

const root = __dirname;
const jniLibs = path.join(root, "app", "src", "main", "jniLibs");
const zip = path.join(root, "nodejs-mobile.zip");

if (fs.existsSync(path.join(jniLibs, "arm64-v8a", "libnode.so"))) {
  console.log("libnode is already here, nothing to do");
  process.exit(0);
}

function download(url, to) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        res.resume();
        return download(res.headers.location, to).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error("HTTP " + res.statusCode + " for " + url));
      }
      const total = Number(res.headers["content-length"] || 0);
      let done = 0;
      let lastShown = 0;
      const file = fs.createWriteStream(to);
      res.on("data", (chunk) => {
        done += chunk.length;
        const pct = total ? Math.floor((done / total) * 100) : 0;
        if (pct >= lastShown + 10) {
          lastShown = pct;
          process.stdout.write("  " + pct + "%\n");
        }
      });
      res.pipe(file);
      file.on("finish", () => file.close(resolve));
    }).on("error", reject);
  });
}

(async () => {
  console.log("fetching nodejs-mobile " + VERSION);
  await download(URL, zip);

  // no unzip dependency: powershell is already here on the only platform that
  // builds this, and tar handles zip everywhere else
  console.log("unpacking");
  const staging = path.join(root, ".nodejs-mobile");
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  if (process.platform === "win32") {
    execFileSync("powershell", ["-NoProfile", "-Command",
      "Expand-Archive -Force -LiteralPath '" + zip + "' -DestinationPath '" + staging + "'"],
      { stdio: "inherit" });
  } else {
    execFileSync("unzip", ["-q", zip, "-d", staging], { stdio: "inherit" });
  }

  for (const abi of ["arm64-v8a", "armeabi-v7a", "x86_64"]) {
    const from = path.join(staging, "bin", abi, "libnode.so");
    const to = path.join(jniLibs, abi, "libnode.so");
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    console.log("  " + abi + "  " + (fs.statSync(to).size / 1048576).toFixed(1) + " MB");
  }

  const headers = path.join(root, "app", "src", "main", "cpp", "include");
  fs.rmSync(headers, { recursive: true, force: true });
  fs.cpSync(path.join(staging, "include"), headers, { recursive: true });

  fs.rmSync(staging, { recursive: true, force: true });
  fs.rmSync(zip, { force: true });
  console.log("ready - now build with gradle");
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
