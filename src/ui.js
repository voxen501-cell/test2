const { spawn } = require("child_process");
const installer = require("./install");
const fs = require("fs");
const path = require("path");

// pkg keeps these beside the snapshot, so the same read works from the exe.
const ASSETS = __dirname;
const PAGE = fs.readFileSync(path.join(ASSETS, "app.html"), "utf8");
const UI_ASSETS = require("./uiassets");
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
    worldCount: 0,
    installMessage: "",
  };

  // The world list runs to hundreds of entries. It is fetched on demand rather
  // than pushed, so a log line does not resend it to every open page.
  let worlds = [];

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

    if (path === "/install") {
      const q = new URL(req.url, "http://x").searchParams;
      const worldId = q.get("world") || "";
      const rootIndex = parseInt(q.get("root"), 10) || 0;
      let body;
      try {
        const done = installer.install(worldId, rootIndex);
        body = {
          ok: true,
          world: done.world,
          message: done.world
            ? "AI installed in " + done.world
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
