// Shared test setup: must be required BEFORE any module that opens the DB.
const os = require("os");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

// Unique throwaway DB per test file, created before src/db.js is required.
const dbFile = path.join(os.tmpdir(), `rf-test-${crypto.randomBytes(6).toString("hex")}.db`);
process.env.DATABASE_PATH = dbFile;
delete process.env.NODE_ENV; // keep cookie/secure behavior in dev mode

// Deterministic key for crypto tests (32 bytes, base64).
process.env.TOKEN_ENC_KEY = crypto.randomBytes(32).toString("base64");

function cleanup() {
  for (const suffix of ["", "-wal", "-shm"]) {
    try { fs.rmSync(dbFile + suffix, { force: true }); } catch { /* windows lock */ }
  }
}

module.exports = { dbFile, cleanup };
