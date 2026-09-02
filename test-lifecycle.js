// The app window is the app: when its page goes away the bridge should stop,
// but a reload must not kill it, and a window that never opened must not
// either.
process.env.AICHAT_NO_WINDOW = "1";
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const results = [];
function check(label, ok, extra) {
  results.push(ok);
  console.log((ok ? "PASS  " : "FAIL  ") + label + (ok ? "" : "   -> " + extra));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startBridge(port) {
  const cfg = path.join(__dirname, "life-config-" + port + ".json");
  fs.writeFileSync(cfg, JSON.stringify({
    provider: "groq", apiKey: "dummy", port, useGameContext: false,
  }));
  const child = spawn(process.execPath, [path.join(__dirname, "src", "server.js")], {
    env: { ...process.env, AICHAT_CONFIG: cfg },
    stdio: "ignore",
  });
  child.cfg = cfg;
  return child;
}

function openStream(port) {
  const http = require("http");
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port, path: "/events" }, (res) => {
      res.on("data", () => {});
      resolve(req);
    });
    req.on("error", () => resolve(null));
  });
}

(async () => {
  // 1. no window ever opens: the bridge must keep running
  const a = startBridge(8241);
  await sleep(1200);
  check("a bridge nobody opened stays up", a.exitCode === null, "exited " + a.exitCode);
  a.kill();
  fs.unlinkSync(a.cfg);

  // 2. window opens, then closes: the bridge follows it down
  const b = startBridge(8242);
  await sleep(900);
  const s1 = await openStream(8242);
  check("the page connects", !!s1);
  await sleep(300);
  s1.destroy();                       // the window closed
  await sleep(3000);
  check("still up during the grace period", b.exitCode === null, "exited " + b.exitCode);
  await sleep(5000);
  check("stops once the window is gone", b.exitCode === 0, "exitCode " + b.exitCode);
  fs.unlinkSync(b.cfg);

  // 3. a reload drops the stream and makes a new one: nothing should die
  const c = startBridge(8243);
  await sleep(900);
  const s2 = await openStream(8243);
  await sleep(200);
  s2.destroy();
  await sleep(1200);                  // well inside the grace period
  const s3 = await openStream(8243);
  check("the reload reconnects", !!s3);
  await sleep(7000);
  check("a reload does not stop the bridge", c.exitCode === null, "exited " + c.exitCode);
  if (s3) s3.destroy();
  c.kill();
  fs.unlinkSync(c.cfg);

  console.log("=== summary ===");
  const failed = results.filter((r) => !r).length;
  console.log(results.length - failed + "/" + results.length + " passed");
  process.exit(failed ? 1 : 0);
})();
