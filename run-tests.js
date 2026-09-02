// Runs the suite with the app window suppressed, so tests never spawn browsers.
const { spawnSync } = require("child_process");

const FILES = [
  "test.js",
  "test-context.js",
  "test-channel.js",
  "test-keepalive.js",
  "test-lifecycle.js",
  "test-actions.js",
  "test-sequence.js",
  "test-encryption.js",
];

let failed = 0;
for (const file of FILES) {
  const r = spawnSync(process.execPath, [file], {
    stdio: "inherit",
    env: { ...process.env, AICHAT_NO_WINDOW: "1" },
  });
  if (r.status !== 0) {
    console.log("FAILED: " + file);
    failed++;
  }
}
console.log(failed ? "\n" + failed + " test file(s) failed" : "\nall test files passed");
process.exit(failed ? 1 : 0);
