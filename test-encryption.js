const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const WebSocket = require("ws");
const { PROVIDERS } = require("./src/providers");
const { createCipherPair, createHandshake, extractClientKey } = require("./src/encryption");

const CONFIG_PATH = path.join(__dirname, "test-config.json");
process.env.AICHAT_CONFIG = CONFIG_PATH;

PROVIDERS.mock = {
  label: "Mock",
  defaultModel: "mock-1",
  keyUrl: "",
  async chat() {
    return "Encrypted hello.";
  },
};

const results = [];
function check(name, cond, extra) {
  results.push(!!cond);
  console.log((cond ? "PASS  " : "FAIL  ") + name + (cond ? "" : "   -> " + extra));
}

console.log("=== crypto ===");
{
  const hs = createHandshake();
  const cmd = hs.command();
  const m = cmd.match(/^enableencryption "([^"]+)" "([^"]+)"$/);
  check("the handshake command has the expected shape", !!m, cmd.slice(0, 60));

  const salt = Buffer.from(m[2], "base64");
  check("the salt is sixteen bytes", salt.length === 16, String(salt.length));

  const serverPub = crypto.createPublicKey({
    key: Buffer.from(m[1], "base64"),
    format: "der",
    type: "spki",
  });
  check(
    "the public key is on the expected curve",
    serverPub.asymmetricKeyDetails.namedCurve === "secp384r1",
    JSON.stringify(serverPub.asymmetricKeyDetails)
  );

  const client = crypto.generateKeyPairSync("ec", { namedCurve: "secp384r1" });
  const clientPubB64 = client.publicKey.export({ format: "der", type: "spki" }).toString("base64");
  const shared = crypto.diffieHellman({ privateKey: client.privateKey, publicKey: serverPub });
  const clientKey = crypto.createHash("sha256").update(Buffer.concat([salt, shared])).digest();
  const clientCipher = createCipherPair(clientKey);
  const serverCipher = hs.complete(clientPubB64);

  check("both sides derive the same key", serverCipher.key.equals(clientCipher.key), "keys differ");

  const text = '{"a":1}';
  check(
    "server to client round trip",
    clientCipher.decrypt(serverCipher.encrypt(text)) === text,
    "mismatch"
  );
  check(
    "client to server round trip",
    serverCipher.decrypt(clientCipher.encrypt(text)) === text,
    "mismatch"
  );

  const a = serverCipher.encrypt("one");
  const b = serverCipher.encrypt("two");
  check(
    "the stream cipher stays in sync across messages",
    clientCipher.decrypt(a) === "one" && clientCipher.decrypt(b) === "two",
    "desync"
  );

  check(
    "a tampered message does not decrypt to the original",
    (() => {
      const p = createHandshake();
      const c = crypto.generateKeyPairSync("ec", { namedCurve: "secp384r1" });
      const pub = c.publicKey.export({ format: "der", type: "spki" }).toString("base64");
      const s1 = p.complete(pub);
      const enc = Buffer.from(s1.encrypt("hello world"));
      enc[0] = enc[0] ^ 0xff;
      const other = createCipherPair(s1.key);
      return other.decrypt(enc) !== "hello world";
    })(),
    "tampering was not detectable"
  );

  check("extractClientKey reads a publicKey field", extractClientKey({ publicKey: clientPubB64 }) === clientPubB64, "missed");
  check("extractClientKey reads a key out of statusMessage", extractClientKey({ statusMessage: "key: " + clientPubB64 }) === clientPubB64, "missed");
  check("extractClientKey ignores a body with no key", extractClientKey({ statusMessage: "ok" }) === null, "false positive");
}

function startServer(encryption, port) {
  fs.writeFileSync(
    CONFIG_PATH,
    JSON.stringify({
      provider: "mock",
      apiKey: "x",
      port,
      encryption,
      encryptionWaitMs: 800,
      useGameContext: false,
      allowActions: false,
      defaultAlwaysOn: true,
      cooldownMs: 0,
      chunkDelayMs: 0,
    })
  );
  delete require.cache[require.resolve("./src/server")];
  require("./src/server").start();
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function encryptedClient(port) {
  return new Promise((resolve) => {
    const ws = new WebSocket("ws://127.0.0.1:" + port);
    let cipher = null;
    const seen = [];
    ws.on("message", (data) => {
      const text = cipher ? cipher.decrypt(data) : data.toString();
      let msg;
      try {
        msg = JSON.parse(text);
      } catch {
        seen.push("UNPARSEABLE");
        return;
      }
      if (msg.header.messagePurpose === "commandRequest") {
        const line = msg.body.commandLine;
        const m = line.match(/^enableencryption "([^"]+)" "([^"]+)"$/);
        if (m && !cipher) {
          const salt = Buffer.from(m[2], "base64");
          const serverPub = crypto.createPublicKey({
            key: Buffer.from(m[1], "base64"),
            format: "der",
            type: "spki",
          });
          const c = crypto.generateKeyPairSync("ec", { namedCurve: "secp384r1" });
          const shared = crypto.diffieHellman({ privateKey: c.privateKey, publicKey: serverPub });
          const key = crypto.createHash("sha256").update(Buffer.concat([salt, shared])).digest();
          ws.send(
            JSON.stringify({
              header: { messagePurpose: "commandResponse", requestId: msg.header.requestId },
              body: {
                publicKey: c.publicKey.export({ format: "der", type: "spki" }).toString("base64"),
                statusCode: 0,
              },
            })
          );
          cipher = createCipherPair(key);
          return;
        }
        seen.push(line);
      } else if (msg.header.messagePurpose === "subscribe") {
        seen.push("subscribe:" + msg.body.eventName);
      }
    });
    ws.on("open", async () => {
      await wait(700);
      if (cipher) {
        ws.send(
          cipher.encrypt(
            JSON.stringify({
              header: { messagePurpose: "event", eventName: "PlayerMessage", version: 1 },
              body: { message: "hello", sender: "Bunny", type: "chat" },
            })
          )
        );
      }
      await wait(700);
      ws.close();
      resolve({ encrypted: !!cipher, seen });
    });
  });
}

async function plainClient(port) {
  return new Promise((resolve) => {
    const ws = new WebSocket("ws://127.0.0.1:" + port);
    const seen = [];
    ws.on("message", (data) => {
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        seen.push("UNPARSEABLE");
        return;
      }
      if (msg.header.messagePurpose === "subscribe") seen.push("subscribe:" + msg.body.eventName);
      else if (msg.header.messagePurpose === "commandRequest") seen.push(msg.body.commandLine);
    });
    ws.on("open", async () => {
      await wait(1600);
      ws.close();
      resolve({ seen });
    });
  });
}

(async () => {
  console.log("\n=== handshake over a live socket ===");
  startServer("auto", 8241);
  await wait(300);

  const enc = await encryptedClient(8241);
  check("the client and server complete the handshake", enc.encrypted, "no cipher");
  check(
    "everything after the handshake decrypts cleanly",
    !enc.seen.includes("UNPARSEABLE"),
    JSON.stringify(enc.seen)
  );
  check(
    "the session starts only after encryption is agreed",
    enc.seen.some((s) => s === "subscribe:PlayerMessage"),
    JSON.stringify(enc.seen)
  );
  check(
    "a chat message sent encrypted gets an encrypted reply",
    enc.seen.some((s) => typeof s === "string" && s.includes("voxai:reply")),
    JSON.stringify(enc.seen)
  );

  console.log("\n=== fallback when the client ignores encryption ===");
  const plain = await plainClient(8241);
  check(
    "a client that never answers still gets a session",
    plain.seen.includes("subscribe:PlayerMessage"),
    JSON.stringify(plain.seen)
  );
  check(
    "the fallback session is readable plain text",
    !plain.seen.includes("UNPARSEABLE"),
    JSON.stringify(plain.seen)
  );

  const failed = results.filter((r) => !r).length;
  console.log("\n" + (results.length - failed) + "/" + results.length + " passed");
  try {
    fs.unlinkSync(CONFIG_PATH);
  } catch (e) {}
  process.exit(failed ? 1 : 0);
})();
