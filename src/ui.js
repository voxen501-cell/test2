const { spawn } = require("child_process");
const installer = require("./install");
const fs = require("fs");
const path = require("path");

// pkg keeps these beside the snapshot, so the same read works from the exe.
const ASSETS = __dirname;
const PAGE = fs.readFileSync(path.join(ASSETS, "app.html"), "utf8");
const FONTS = {
  "/font/monocraft.ttf": path.join(ASSETS, "fonts", "Monocraft.ttf"),
  "/font/monocraft-bold.ttf": path.join(ASSETS, "fonts", "Monocraft-Bold.ttf"),
};

// The bridge already owns an http listener for the websocket upgrade, so the
// app window is served from that same port. One port, nothing to configure.

function createUi(cfg) {
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
    worlds: [],
    installMessage: "",
  };

  function refreshWorlds() {
    try {
      const root = installer.findMinecraft();
      state.minecraftFound = !!root;
      state.packVersion = installer.manifest().header.version.join(".");
      state.worlds = root ? installer.listWorlds(root).slice(0, 25) : [];
    } catch (err) {
      state.minecraftFound = false;
      state.worlds = [];
    }
  }

  const clients = new Set();

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

  function note(line) {
    state.log.push(line);
    if (state.log.length > 200) state.log.shift();
    push();
  }

  function handle(req, res) {
    const path = (req.url || "/").split("?")[0];

    if (FONTS[path]) {
      try {
        const font = fs.readFileSync(FONTS[path]);
        res.writeHead(200, { "Content-Type": "font/ttf", "Cache-Control": "max-age=86400" });
        return res.end(font);
      } catch (err) {
        res.writeHead(404);
        return res.end();
      }
    }

    if (path === "/worlds") {
      refreshWorlds();
      push();
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ worlds: state.worlds, found: state.minecraftFound }));
    }

    if (path === "/install") {
      const worldId = new URL(req.url, "http://x").searchParams.get("world") || "";
      let body;
      try {
        const done = installer.install(worldId);
        body = {
          ok: true,
          message: done.world
            ? "Pack " + done.version + " installed and turned on in " + done.world
            : "Pack " + done.version + " installed. Pick a world to turn it on.",
        };
      } catch (err) {
        body = { ok: false, message: err.message };
      }
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
      req.on("close", () => clients.delete(res));
      return;
    }

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(PAGE);
  }

  refreshWorlds();

  return { handle, set, note, state, refreshWorlds };
}

// Opens the page as its own window, so it reads as an app and not a browser
// tab. Edge is always present on Windows; the plain browser is the fallback.
function openWindow(url) {
  const attempts = [
    ["cmd", ["/c", "start", "", "msedge", "--app=" + url]],
    ["cmd", ["/c", "start", "", "chrome", "--app=" + url]],
    ["cmd", ["/c", "start", "", url]],
  ];
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
