const { randomUUID } = require("crypto");

function subscribe(eventName) {
  return JSON.stringify({
    header: {
      version: 1,
      requestId: randomUUID(),
      messageType: "commandRequest",
      messagePurpose: "subscribe",
    },
    body: { eventName },
  });
}

function command(commandLine, requestId) {
  return JSON.stringify({
    header: {
      version: 1,
      requestId: requestId || randomUUID(),
      messageType: "commandRequest",
      messagePurpose: "commandRequest",
    },
    body: {
      version: 1,
      commandLine,
      origin: { type: "player" },
    },
  });
}

function chunkText(text, size) {
  const out = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out.length ? out : [""];
}

const CONTROL_CHARS = new RegExp("[\u0000-\u0008\u000B\u000C\u000E-\u001F]", "g");

const THINK_PAIR = /<think>[\s\S]*?<\/think>/gi;
const THINK_OPEN = /<think>[\s\S]*$/i;

const TYPO_MAP = {
  "‘": "'",
  "’": "'",
  "‚": "'",
  "‛": "'",
  "“": '"',
  "”": '"',
  "„": '"',
  "‑": "-",
  "‒": "-",
  "–": "-",
  "—": "-",
  "―": "-",
  "…": "...",
  " ": " ",
  " ": " ",
  " ": " ",
  " ": " ",
  "·": "-",
  "•": "-",
};

const TYPOGRAPHY = new RegExp("[" + Object.keys(TYPO_MAP).join("") + "]", "g");

function stripThinking(text) {
  const paired = text.replace(THINK_PAIR, "");
  if (!/<think>/i.test(paired)) return paired;
  const trimmed = paired.replace(THINK_OPEN, "");
  return trimmed.trim() ? trimmed : paired.replace(/<\/?think>/gi, "");
}

function sanitize(text) {
  return stripThinking(String(text))
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```/g, "").trim())
    .replace(/[*_#`>]/g, "")
    .replace(TYPOGRAPHY, (c) => TYPO_MAP[c])
    .replace(CONTROL_CHARS, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .replace(/\n/g, "<br>")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function escapeRawtext(text) {
  return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

module.exports = {
  subscribe,
  command,
  chunkText,
  sanitize,
  escapeRawtext,
  newRequestId: randomUUID,
};
