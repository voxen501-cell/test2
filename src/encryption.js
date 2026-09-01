const crypto = require("crypto");

const CURVE = "secp384r1";
const SUBPROTOCOL = "com.microsoft.minecraft.wsencrypt";


function unpadded(buffer) {
  return buffer.toString("base64").replace(/=+$/, "");
}

function createHandshake() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", {
    namedCurve: CURVE,
  });
  const salt = crypto.randomBytes(16);
  const publicKeyDer = publicKey.export({ format: "der", type: "spki" });
  const keyB64 = unpadded(publicKeyDer);
  const saltB64 = unpadded(salt);

  return {
    publicKeyBase64: keyB64,
    saltBase64: saltB64,

    command() {
      return 'enableencryption "' + keyB64 + '" "' + saltB64 + '"';
    },

    complete(clientPublicKeyBase64) {
      const clientKey = crypto.createPublicKey({
        key: Buffer.from(clientPublicKeyBase64, "base64"),
        format: "der",
        type: "spki",
      });
      const shared = crypto.diffieHellman({
        privateKey,
        publicKey: clientKey,
      });
      const key = crypto
        .createHash("sha256")
        .update(Buffer.concat([salt, shared]))
        .digest();
      return createCipherPair(key);
    },
  };
}

function createCipherPair(key) {
  const iv = key.slice(0, 16);
  const encipher = crypto.createCipheriv("aes-256-cfb8", key, iv);
  const decipher = crypto.createDecipheriv("aes-256-cfb8", key, iv);
  return {
    key,
    encrypt(text) {
      return encipher.update(Buffer.from(text, "utf8"));
    },
    decrypt(buffer) {
      return decipher.update(Buffer.from(buffer)).toString("utf8");
    },
  };
}

function extractClientKey(body) {
  if (!body) return null;
  const direct = body.publicKey || body.public_key;
  if (typeof direct === "string" && direct.length > 40) return direct;
  const text = body.statusMessage || body.details;
  if (typeof text === "string") {
    const m = text.match(/[A-Za-z0-9+/=]{60,}/);
    if (m) return m[0];
  }
  return null;
}

module.exports = {
  createHandshake,
  createCipherPair,
  extractClientKey,
  CURVE,
  SUBPROTOCOL,
  unpadded,
};
