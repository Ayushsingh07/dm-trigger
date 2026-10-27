// ReplyLo — encryption at rest for stored Meta access tokens.
// AES-256-GCM with a 32-byte key supplied as base64 in TOKEN_ENC_KEY.
//
// These helpers are used ONLY from src/store.js — nothing else in the app
// touches ciphertext. Ciphertext format: "v1:<iv-b64>:<tag-b64>:<ct-b64>".
// Values written before encryption existed (plain Meta tokens, "IGQ..." /
// "EAA...") are detected and passed through unchanged by the store layer.

const crypto = require("crypto");
const logger = require("./logger");

const ALGO = "aes-256-gcm";
const PREFIX = "v1:";
const KEY_BYTES = 32;

let cachedKey = null;
let keyWarned = false;

function keyMaterial() {
  if (cachedKey) return cachedKey;
  const raw = process.env.TOKEN_ENC_KEY || "";
  if (!raw) return null;
  let key;
  try {
    key = Buffer.from(raw, "base64");
  } catch {
    key = Buffer.alloc(0);
  }
  if (key.length !== KEY_BYTES) {
    if (!keyWarned) {
      keyWarned = true;
      logger.warn(
        "TOKEN_ENC_KEY is not 32 bytes of base64 — tokens will be stored unencrypted. " +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\""
      );
    }
    return null;
  }
  cachedKey = key;
  return key;
}

// True when a usable key is configured.
function encryptionAvailable() {
  return keyMaterial() !== null;
}

// Heuristic: does this value look like plaintext (i.e. not written by us)?
function looksLikePlaintext(value) {
  return typeof value === "string" && value.length > 0 && !value.startsWith(PREFIX);
}

// Encrypt a plaintext token. Returns "v1:iv:tag:ciphertext".
function encrypt(plaintext) {
  const key = keyMaterial();
  if (!key) throw new Error("TOKEN_ENC_KEY is not configured");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  return `${PREFIX}${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${ct.toString("base64")}`;
}

// Decrypt a value produced by encrypt(). Throws on tamper / wrong key.
function decrypt(payload) {
  const key = keyMaterial();
  if (!key) throw new Error("TOKEN_ENC_KEY is not configured");
  const [, ivB64, tagB64, ctB64] = String(payload).split(":");
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
}

// Store-layer helpers: encrypt on write, decrypt on read, tolerate legacy rows.
function sealToken(plaintext) {
  if (plaintext === null || plaintext === undefined || plaintext === "") return plaintext;
  if (!encryptionAvailable()) return plaintext; // dry-run / dev without a key
  return encrypt(plaintext);
}

function openToken(stored) {
  if (stored === null || stored === undefined || stored === "") return stored;
  if (!String(stored).startsWith(PREFIX)) return stored; // legacy plaintext row
  try {
    return decrypt(stored);
  } catch {
    logger.error("failed to decrypt a stored token — wrong TOKEN_ENC_KEY or corrupted row");
    return null;
  }
}

// One-time migration: encrypt every legacy plaintext token in accounts.
// Safe to run on every boot — rows already encrypted are skipped.
function migrateTokensAtRest(db) {
  if (!encryptionAvailable()) return { migrated: 0, skipped: true };
  const rows = db.prepare("SELECT ig_user_id, access_token FROM accounts WHERE access_token IS NOT NULL").all();
  let migrated = 0;
  const update = db.prepare("UPDATE accounts SET access_token = ? WHERE ig_user_id = ?");
  for (const row of rows) {
    if (!looksLikePlaintext(row.access_token)) continue;
    update.run(encrypt(row.access_token), row.ig_user_id);
    migrated += 1;
  }
  return { migrated, skipped: false };
}

module.exports = { encrypt, decrypt, sealToken, openToken, encryptionAvailable, looksLikePlaintext, migrateTokensAtRest };
