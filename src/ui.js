const { spawn } = require("child_process");
const installer = require("./install");
const { PROVIDERS } = require("./providers");
const os = require("os");
const fs = require("fs");
const path = require("path");

// pkg keeps these beside the snapshot, so the same read works from the exe.
const ASSETS = __dirname;
const PAGE = fs.readFileSync(path.join(ASSETS, "app.html"), "utf8");
const UI_ASSETS = require("./uiassets");

// The bridge already owns an http listener for the websocket upgrade, so the
// app window is served from that same port. One port, nothing to configure.

// The app window is the app. When its page goes away the bridge has nothing
// left to serve, so it should stop rather than linger in the background.
// The page holds an event stream open; losing every stream is the signal.
// A short grace period lets a reload reconnect without killing anything, and
// the watch only arms once a window has actually shown up, so a browser that
// fails to open does not shut the bridge down on its own.
const IDLE_GRACE_MS = 6000;

// The bridge listens on every interface, so a phone on the same Wi-Fi can
// reach it. These are the addresses to hand that phone.
function lanAddresses() {
  const out = [];
  const nets = os.networkInterfaces();
  for (const [name, list] of Object.entries(nets)) {
    for (const net of list || []) {
      if (net.family !== "IPv4" || net.internal) continue;
      if (/^169\.254\./.test(net.address)) continue; // link-local, unreachable
      out.push({ name, address: net.address });
    }
  }
  // a Wi-Fi adapter is the one a phone will be on
  out.sort((a, b) => (/wi.?fi|wlan/i.test(b.name) ? 1 : 0) - (/wi.?fi|wlan/i.test(a.name) ? 1 : 0));
  return out;
}

function createUi(cfg, onIdle, onRestart) {
  const state = {
    port: cfg.port,
    provider: "",
    model: "",
    apiKeyMissing: false,
    minecraft: false,
    player: "",
    facts: null, // { ok, count, total, missing }
    log: [],
    minecraftFound: false,
    packVersion: "",
    worldCount: 0,
    installMessage: "",
    job: null,
    lanAddresses: lanAddresses(),
  };

  // The world list runs to hundreds of entries. It is fetched on demand rather
  // than pushed, so a log line does not resend it to every open page.
  let worlds = [];

  // What was actually said, as opposed to the log. Kept short: this is the
  // recent conversation, not a transcript to keep forever.
  const CHAT_KEPT = 60;
  const chat = [];

  function refreshWorlds() {
    try {
      state.minecraftFound = installer.findRoots().length > 0;
      state.packVersion = installer.manifest().header.version.join(".");
      worlds = state.minecraftFound ? installer.listWorlds() : [];
      state.worldCount = worlds.length;
    } catch (err) {
      state.minecraftFound = false;
      worlds = [];
      state.worldCount = 0;
    }
  }

  const clients = new Set();
  let everConnected = false;
  let idleTimer = null;

  function armIdle() {
    if (!onIdle || !everConnected || clients.size) return;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (!clients.size) onIdle();
    }, IDLE_GRACE_MS);
  }

  function push() {
    const payload = "data: " + JSON.stringify(state) + "\n\n";
    for (const res of clients) {
      try {
        res.write(payload);
      } catch (err) {
        clients.delete(res);
      }
    }
  }

  function set(patch) {
    Object.assign(state, patch);
    push();
  }

  function said(who, text) {
    chat.push({ who, text: String(text), at: Date.now() });
    while (chat.length > CHAT_KEPT) chat.shift();
  }

  function note(line) {
    state.log.push(line);
    if (state.log.length > 200) state.log.shift();
    push();
  }

  function handle(req, res) {
    const path = (req.url || "/").split("?")[0];

    if (path.startsWith("/ui/")) {
      const asset = UI_ASSETS[path.slice(4)];
      if (!asset) {
        res.writeHead(404);
        return res.end();
      }
      res.writeHead(200, { "Content-Type": asset.type, "Cache-Control": "max-age=86400" });
      return res.end(Buffer.from(asset.base64, "base64"));
    }

    if (path === "/world-icon") {
      const q = new URL(req.url, "http://x").searchParams;
      const id = q.get("id") || "";
      const rootIndex = parseInt(q.get("root"), 10) || 0;
      const file = id ? installer.iconPath(rootIndex, id) : null;
      if (!file) {
        res.writeHead(404);
        return res.end();
      }
      res.writeHead(200, { "Content-Type": "image/jpeg", "Cache-Control": "max-age=60" });
      return res.end(fs.readFileSync(file));
    }

    if (path === "/launch") {
      const id = new URL(req.url, "http://x").searchParams.get("world") || "";
      let body;
      try {
        if (!id) throw new Error("no world given");
        installer.launchWorld(id);
        body = { ok: true, message: "Opening the world in Minecraft…" };
      } catch (err) {
        body = { ok: false, message: err.message };
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(body));
    }

    if (path === "/restart") {
      let body;
      try {
        const dropped = onRestart ? onRestart() : 0;
        body = {
          ok: true,
          message: dropped
            ? "Bridge restarted, Minecraft disconnected. Run /connect again."
            : "Bridge restarted. Run /connect in Minecraft.",
        };
      } catch (err) {
        body = { ok: false, message: err.message };
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(body));
    }

    // Which services can be used, and where each one's key comes from. A key
    // only works with the service that issued it, so the app has to say which
    // is which rather than asking for "an API key".
    if (path === "/providers") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({
        current: cfg.provider,
        providers: Object.entries(PROVIDERS).map(([id, p]) => ({
          id,
          label: p.label,
          model: p.defaultModel,
          keyUrl: p.keyUrl,
          needsKey: id !== "ollama",
        })),
      }));
    }

    if (path === "/chat") {
      const since = Number(new URL(req.url, "http://x").searchParams.get("since")) || 0;
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({
        chat: since ? chat.filter((m) => m.at > since) : chat,
        now: Date.now(),
      }));
    }

    if (path === "/roots") {
      let list = [];
      try {
        list = installer.listRoots().sort((a, b) => b.newest - a.newest);
      } catch (err) {
        list = [];
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ roots: list }));
    }

    if (path === "/worlds") {
      refreshWorlds();
      push();
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(
        JSON.stringify({ worlds: worlds, found: state.minecraftFound })
      );
    }

    if (path === "/world") {
      const q = new URL(req.url, "http://x").searchParams;
      let body;
      try {
        body = { ok: true, world: installer.worldDetails(parseInt(q.get("root"), 10) || 0, q.get("id") || "") };
      } catch (err) {
        body = { ok: false, message: err.message };
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(body));
    }

    if (path === "/restore-world") {
      const q = new URL(req.url, "http://x").searchParams;
      let body;
      try {
        const done = installer.restoreWorld(
          parseInt(q.get("root"), 10) || 0,
          q.get("world") || "",
          (bytes, total) => set({ job: { kind: "restore", bytes, total } })
        );
        body = { ok: true, message: done.name + " restored from your backup." };
      } catch (err) {
        body = { ok: false, message: err.message };
      }
      set({ job: null });
      refreshWorlds();
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(body));
    }

    if (path === "/install") {
      const q = new URL(req.url, "http://x").searchParams;
      const worldId = q.get("world") || "";
      const rootIndex = parseInt(q.get("root"), 10) || 0;
      let body;
      try {
        const done = installer.install(worldId, rootIndex, cfg.port,
          (bytes, total) => set({ job: { kind: "backup", bytes, total } }));
        body = {
          ok: true,
          world: done.world,
          backup: done.backup || null,
          message: done.world
            ? "AI installed in " + done.world
            : "Pack " + done.version + " installed. Pick a world to turn it on.",
        };
      } catch (err) {
        body = { ok: false, message: err.message };
      }
      set({ job: null });
      refreshWorlds();
      set({ installMessage: body.message });
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(body));
    }

    if (path === "/status") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(state));
    }

    if (path === "/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write("data: " + JSON.stringify(state) + "\n\n");
      clients.add(res);
      everConnected = true;
      clearTimeout(idleTimer);
      req.on("close", () => {
        clients.delete(res);
        armIdle();
      });
      return;
    }

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(PAGE);
  }

  refreshWorlds();

  return { handle, set, note, said, state, refreshWorlds, windowSeen: () => everConnected };
}

// Opens the page as its own window, so it reads as an app and not a browser
// tab. Edge is always present on Windows; the plain browser is the fallback.
function openWindow(url) {
  const attempts = process.platform === "win32"
    ? [
        ["cmd", ["/c", "start", "", "msedge", "--app=" + url]],
        ["cmd", ["/c", "start", "", "chrome", "--app=" + url]],
        ["cmd", ["/c", "start", "", url]],
      ]
    : process.platform === "darwin"
      ? [["open", [url]]]
      // Termux on a phone, then a desktop Linux, then nothing
      : [["termux-open-url", [url]], ["xdg-open", [url]]];
  let i = 0;
  const tryNext = () => {
    if (i >= attempts.length) return;
    const [cmd, args] = attempts[i++];
    try {
      const child = spawn(cmd, args, {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      child.on("error", tryNext);
      child.unref();
    } catch (err) {
      tryNext();
    }
  };
  tryNext();
}


module.exports = { createUi, openWindow };
