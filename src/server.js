const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");
const { PROVIDERS } = require("./providers");
const { createContext, PASSIVE_EVENTS } = require("./context");
const { extract, promptSection } = require("./actions");
const {
  createHandshake,
  extractClientKey,
  SUBPROTOCOL,
} = require("./encryption");
const {
  subscribe,
  command,
  chunkText,
  sanitize,
  escapeRawtext,
  sendPayload,
} = require("./protocol");

const CONFIG_PATH =
  process.env.AICHAT_CONFIG || path.join(__dirname, "..", "config.json");

const DEFAULT_CONFIG = {
  provider: "groq",
  apiKey: "",
  model: "",
  maxTokens: 600,
  reasoningEffort: "low",
  port: 8080,
  trigger: "ai",
  output: "addon",
  historyTurns: 8,
  cooldownMs: 1500,
  maxPerMinute: 15,
  chunkSize: 700,
  chunkDelayMs: 120,
  encryption: "auto",
  encryptionWaitMs: 2500,
  postHandshakeMs: 500,
  subscribeGapMs: 80,
  useGameContext: true,
  allowActions: true,
  defaultAlwaysOn: true,
  maxActions: 20,
  actionGapMs: 150,
  actionsAllowed: [],
  gameRoot: "",
  ollamaHost: "http://127.0.0.1:11434",
  systemPrompt:
    "You are a helpful companion living inside a Minecraft world. Answer in plain text, no markdown, no lists, no asterisks. Keep every answer under 60 words unless the player asks for more. Speak naturally and stay in character as a friendly guide who knows Minecraft well.",
};

function envOverrides() {
  const out = {};
  const e = process.env;
  if (e.PORT) out.port = parseInt(e.PORT, 10);
  if (e.AI_API_KEY) out.apiKey = e.AI_API_KEY;
  if (e.AI_PROVIDER) out.provider = e.AI_PROVIDER;
  if (e.AI_MODEL) out.model = e.AI_MODEL;
  if (e.AI_TRIGGER !== undefined) out.trigger = e.AI_TRIGGER;
  if (e.AI_ENCRYPTION) out.encryption = e.AI_ENCRYPTION;
  if (e.AI_SYSTEM_PROMPT) out.systemPrompt = e.AI_SYSTEM_PROMPT;
  if (e.AI_ALLOW_ACTIONS) out.allowActions = e.AI_ALLOW_ACTIONS !== "false";
  if (e.AI_MAX_PER_MINUTE) out.maxPerMinute = parseInt(e.AI_MAX_PER_MINUTE, 10);
  if (e.AI_USE_GAME_CONTEXT) out.useGameContext = e.AI_USE_GAME_CONTEXT !== "false";
  return out;
}

function loadConfig() {
  const env = envOverrides();
  const hosted = !fs.existsSync(CONFIG_PATH);

  if (hosted && !env.apiKey && !process.env.AI_PROVIDER) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2));
    log("Created config.json. Open it and put your API key in, then run again.");
    process.exit(0);
  }

  const raw = hosted ? {} : JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  const cfg = { ...DEFAULT_CONFIG, ...raw, ...env };
  if (hosted) log("No config.json found, running from environment variables");
  const provider = PROVIDERS[cfg.provider];
  if (!provider) {
    fail(
      "Unknown provider '" +
        cfg.provider +
        "'. Valid: " +
        Object.keys(PROVIDERS).join(", ")
    );
  }
  if (!cfg.model) cfg.model = provider.defaultModel;
  if (!cfg.apiKey && cfg.provider !== "ollama") {
    fail(
      "No apiKey in config.json. Get a free key: " + provider.keyUrl
    );
  }
  return cfg;
}

function log(...args) {
  const t = new Date().toTimeString().slice(0, 8);
  console.log("[" + t + "]", ...args);
}

function fail(msg) {
  log("ERROR " + msg);
  process.exit(1);
}

const sessions = new Map();

function getSession(name, cfg) {
  if (!sessions.has(name)) {
    sessions.set(name, {
      history: [],
      stamps: [],
      busy: false,
      always: cfg ? cfg.defaultAlwaysOn !== false : false,
    });
  }
  return sessions.get(name);
}

function rateLimited(session, cfg) {
  const now = Date.now();
  session.stamps = session.stamps.filter((t) => now - t < 60000);
  if (session.stamps.length >= cfg.maxPerMinute) return "minute";
  const last = session.stamps[session.stamps.length - 1];
  if (last && now - last < cfg.cooldownMs) return "cooldown";
  return null;
}

function sendRaw(ws, payload) {
  sendPayload(ws, payload);
}

function send(ws, line) {
  sendRaw(ws, command(line));
}

function tell(ws, target, text) {
  const body = escapeRawtext(text.replace(/<br>/g, " "));
  send(ws, 'tellraw ' + target + ' {"rawtext":[{"text":"' + body + '"}]}');
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function deliver(ws, cfg, player, text) {
  if (cfg.output !== "addon") {
    for (const part of chunkText(text.replace(/<br>/g, " "), 220)) {
      tell(ws, "@a", part);
      await sleep(cfg.chunkDelayMs);
    }
    return;
  }
  const id = Math.random().toString(36).slice(2, 8);
  const parts = chunkText(text, cfg.chunkSize);
  for (let i = 0; i < parts.length; i++) {
    send(
      ws,
      "scriptevent voxai:reply " +
        id +
        "|" +
        i +
        "|" +
        parts.length +
        "|" +
        player +
        "|" +
        parts[i]
    );
    if (i < parts.length - 1) await sleep(cfg.chunkDelayMs);
  }
  if (parts.length > 1) log("sent " + parts.length + " chunks");
}

function status(ws, cfg, player, state) {
  if (cfg.output !== "addon") return;
  send(ws, "scriptevent voxai:status " + player + "|" + state);
}

async function ask(cfg, session, question, contextBlock, remember) {
  const provider = PROVIDERS[cfg.provider];
  const messages = [...session.history, { role: "user", content: question }];
  const GAP = String.fromCharCode(10) + String.fromCharCode(10);
  const pieces = [cfg.systemPrompt];
  if (contextBlock) pieces.push(contextBlock);
  if (cfg.allowActions) {
    const section = promptSection(cfg.actionsAllowed);
    if (section) pieces.push(section);
  }
  const system = pieces.join(GAP);
  const answer = await provider.chat(cfg, system, messages);
  session.history.push({ role: "user", content: question });
  return answer;
}

function parseMessage(cfg, body, session) {
  if (body.type !== "chat") return null;
  const sender = body.sender || "Player";
  const raw = String(body.message || "").trim();
  if (!raw) return null;
  const prefix = (cfg.trigger || "").toLowerCase();
  const lower = raw.toLowerCase();

  if (prefix) {
    if (lower === prefix) return { sender, text: "" };
    if (lower.startsWith(prefix + " ")) {
      return { sender, text: raw.slice(prefix.length + 1).trim() };
    }
  }
  if (!prefix) return { sender, text: raw };
  if (session && session.always) return { sender, text: raw };
  return null;
}

async function handleChat(ws, cfg, body, ctx) {
  const preSession = body.sender ? getSession(body.sender, cfg) : null;
  const parsed = parseMessage(cfg, body, preSession);
  if (!parsed) return;
  const { sender, text } = parsed;
  const session = getSession(sender, cfg);
  const lower = text.toLowerCase();

  if (lower === "on" || lower === "listen") {
    session.always = true;
    tell(ws, "@a", "Listening to everything. Just type normally, no " + cfg.trigger + " needed.");
    log(sender + " turned always on");
    return;
  }
  if (lower === "off" || lower === "quiet") {
    session.always = false;
    tell(
      ws,
      "@a",
      "Now ignoring plain chat. Start a message with " +
        cfg.trigger +
        " to ask something. Say " +
        cfg.trigger +
        " on to go back to normal typing."
    );
    log(sender + " turned always off");
    return;
  }
  if (lower === "status") {
    tell(
      ws,
      "@a",
      session.always
        ? "Listening to every message. Say " + cfg.trigger + " off to require the prefix."
        : "Only replying to messages that start with " + cfg.trigger + ". Say " + cfg.trigger + " on to type normally."
    );
    return;
  }
  if (lower === "debug") {
    tell(ws, "@a", "--- what the AI is told ---");
    const block = ctx ? await ctx.snapshot(ws, sender) : "";
    if (!block) tell(ws, "@a", "No world context could be gathered.");
    else for (const line of block.split(String.fromCharCode(10)).slice(1)) tell(ws, "@a", line);
    tell(ws, "@a", "--- raw command replies ---");
    if (ctx) for (const line of ctx.rawReport()) tell(ws, "@a", line);
    log("debug dump sent to " + sender);
    return;
  }

  if (!text) {
    tell(ws, "@a", "Usage: " + cfg.trigger + " <your question>");
    return;
  }
  if (text.toLowerCase() === "reset") {
    session.history = [];
    tell(ws, "@a", "Memory cleared.");
    log(sender, "reset memory");
    return;
  }
  if (session.busy) {
    tell(ws, "@a", "Still thinking about your last question.");
    return;
  }
  const limit = rateLimited(session, cfg);
  if (limit === "minute") {
    tell(ws, "@a", "Too many questions. Wait a minute.");
    return;
  }
  if (limit === "cooldown") {
    tell(ws, "@a", "Slow down a moment.");
    return;
  }

  session.busy = true;
  session.stamps.push(Date.now());
  status(ws, cfg, sender, "thinking");
  log(sender + " asked: " + text.slice(0, 120));

  try {
    let contextBlock = "";
    if (cfg.useGameContext && ctx) {
      contextBlock = await ctx.snapshot(ws, sender);
      if (contextBlock) log("context: " + contextBlock.split("\n").length + " facts");
    }
    const raw = await ask(cfg, session, text, contextBlock);

    let spoken = raw;
    if (cfg.allowActions) {
      const found = extract(raw, sender, cfg.actionsAllowed, cfg.maxActions);
      spoken = found.text;
      for (const action of found.actions) {
        if (action.delay) {
          log("ACTION wait " + action.delay + "ms");
          await sleep(action.delay);
          continue;
        }
        log("ACTION " + action.name + " -> " + action.command);
        send(ws, action.command);
        await sleep(cfg.actionGapMs);
      }
      if (found.rejected.length) {
        log("rejected actions: " + found.rejected.join(", "));
      }
      if (!spoken && found.actions.length) {
        spoken = found.actions.map((a) => a.say).join(" ");
      }
    }

    const answer = sanitize(spoken) || "I could not think of an answer.";
    session.history.push({
      role: "assistant",
      content: spoken.trim() || "Done.",
    });
    const keep = cfg.historyTurns * 2;
    if (session.history.length > keep) {
      session.history = session.history.slice(-keep);
    }
    log("replied " + answer.length + " chars");
    await deliver(ws, cfg, sender, answer);
  } catch (err) {
    const last = session.history[session.history.length - 1];
    if (last && last.role === "user") session.history.pop();
    log("API error: " + err.message);
    status(ws, cfg, sender, "error");
    tell(ws, "@a", "AI error: " + err.message.slice(0, 150));
  } finally {
    session.busy = false;
  }
}

function start() {
  const cfg = loadConfig();
  const provider = PROVIDERS[cfg.provider];
  const wss = new WebSocketServer({
    port: cfg.port,
    host: "0.0.0.0",
    skipUTF8Validation: true,
    perMessageDeflate: false,
    handleProtocols: (protocols) => {
      const offered = Array.from(protocols || []);
      if (offered.length) log("Client offered subprotocols: " + offered.join(", "));
      if (offered.includes(SUBPROTOCOL)) return SUBPROTOCOL;
      return false;
    },
  });

  log("Provider: " + provider.label + "  Model: " + cfg.model);
  log("Output mode: " + cfg.output);
  log("Listening on port " + cfg.port);
  log("In Minecraft run:  /connect localhost:" + cfg.port);
  if (cfg.defaultAlwaysOn !== false) {
    log("Chat mode is ON by default, just type normally. Say " + cfg.trigger + " off to need the prefix again.");
  } else {
    log("Then type in chat:  " + (cfg.trigger ? cfg.trigger + " hello" : "hello"));
  }

  const ctx = createContext(cfg, log);

  async function beginSession(ws, how) {
    if (ws.voxaiStarted) return;
    ws.voxaiStarted = true;
    log("Session ready (" + how + ")");

    if (ws.voxaiCipher && cfg.postHandshakeMs > 0) {
      await sleep(cfg.postHandshakeMs);
      if (ws.readyState !== ws.OPEN) {
        log("Client left during the settling delay");
        return;
      }
    }

    sendRaw(ws, subscribe("PlayerMessage"));
    if (cfg.useGameContext) {
      for (const name of PASSIVE_EVENTS) {
        await sleep(cfg.subscribeGapMs);
        if (ws.readyState !== ws.OPEN) {
          log("Client left while subscribing");
          return;
        }
        sendRaw(ws, subscribe(name));
      }
      log("Watching the world: " + PASSIVE_EVENTS.join(", "));
    }
    await sleep(cfg.subscribeGapMs);
    if (ws.readyState !== ws.OPEN) return;
    tell(ws, "@a", "AI companion connected.");
    log("Greeting sent, session fully open");
  }

  wss.on("connection", (ws, req) => {
    log("Minecraft connected from " + (req.socket.remoteAddress || "unknown"));

    if (cfg.encryption === "off") {
      beginSession(ws, "no encryption");
    } else {
      ws.voxaiHandshake = createHandshake();
      ws.send(command(ws.voxaiHandshake.command()));
      log("Asked the client to enable encryption");
      if (cfg.encryption === "auto") {
        ws.voxaiFallback = setTimeout(() => {
          if (!ws.voxaiStarted) {
            log("No encryption reply, falling back to plain text");
            ws.voxaiHandshake = null;
            beginSession(ws, "plain fallback");
          }
        }, cfg.encryptionWaitMs);
      }
    }

    ws.on("message", async (data) => {
      let text;
      if (ws.voxaiCipher) {
        try {
          text = ws.voxaiCipher.decrypt(data);
        } catch (err) {
          log("Could not decrypt a message: " + err.message);
          return;
        }
      } else {
        text = data.toString();
      }

      let msg;
      try {
        msg = JSON.parse(text);
      } catch {
        return;
      }

      if (ws.voxaiHandshake && !ws.voxaiStarted) {
        const key = extractClientKey(msg.body);
        if (key) {
          try {
            ws.voxaiCipher = ws.voxaiHandshake.complete(key);
            ws.voxaiHandshake = null;
            clearTimeout(ws.voxaiFallback);
            beginSession(ws, "encrypted");
          } catch (err) {
            log("Encryption handshake failed: " + err.message);
            ws.voxaiHandshake = null;
            clearTimeout(ws.voxaiFallback);
            beginSession(ws, "plain after failed handshake");
          }
          return;
        }
      }
      const purpose = msg.header?.messagePurpose;
      if (purpose === "commandResponse" && ctx.handleResponse(msg)) return;
      if (purpose === "event" && msg.header.eventName === "PlayerMessage") {
        await handleChat(ws, cfg, msg.body || {}, ctx);
      } else if (purpose === "event") {
        ctx.note(msg.header.eventName, msg.body);
      } else if (purpose === "error") {
        log("Minecraft error: " + JSON.stringify(msg.body));
      } else if (purpose === "commandResponse") {
        const b = msg.body || {};
        if (b.statusCode !== undefined && b.statusCode < 0) {
          log("Command rejected by Minecraft: " + (b.statusMessage || JSON.stringify(b)));
        }
      }
    });

    ws.on("close", (code, reason) => {
      clearTimeout(ws.voxaiFallback);
      log(
        "Minecraft disconnected" +
          (code ? " code=" + code : "") +
          (reason && reason.length ? " reason=" + reason.toString() : "")
      );
    });
    ws.on("error", (e) => log("Socket error: " + e.message));
  });

  wss.on("error", (e) => {
    if (e.code === "EADDRINUSE") {
      fail("Port " + cfg.port + " is already in use. Change port in config.json.");
    }
    fail(e.message);
  });
}

if (require.main === module) start();

module.exports = { start, handleChat, parseMessage, deliver, loadConfig };
