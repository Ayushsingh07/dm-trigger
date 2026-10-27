// ReplyFlow — authentication: scrypt password hashing, cookie sessions,
// and route middleware. No external auth deps.

const crypto = require("crypto");
const { db } = require("./db");

const SESSION_DAYS = 30;
const COOKIE = "rf_session";

// ---------------------------------------------------------------- passwords
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || "").split(":");
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(password, salt, 64);
  const known = Buffer.from(hash, "hex");
  return known.length === test.length && crypto.timingSafeEqual(known, test);
}

// ---------------------------------------------------------------- sessions
function createSession(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  const now = new Date();
  const exp = new Date(now.getTime() + SESSION_DAYS * 864e5);
  db.prepare("INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?,?,?,?)")
    .run(token, userId, now.toISOString(), exp.toISOString());
  db.prepare("UPDATE users SET last_seen_at = ? WHERE id = ?").run(now.toISOString(), userId);
  return token;
}

function destroySession(token) {
  if (token) db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

function sessionUser(token) {
  if (!token) return null;
  const row = db.prepare(
    `SELECT s.token, s.expires_at, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`
  ).get(token);
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    destroySession(token);
    return null;
  }
  db.prepare("UPDATE users SET last_seen_at = ? WHERE id = ?").run(new Date().toISOString(), row.id);
  return row;
}

// parse "rf_session=abc" cookie header without a cookie lib
function readCookie(req, name) {
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie",
    `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=${SESSION_DAYS * 86400}`);
}
function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=0`);
}

// ---------------------------------------------------------------- middleware
function attachUser(req, _res, next) {
  req.user = sessionUser(readCookie(req, COOKIE));
  next();
}

function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Sign in required" });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Sign in required" });
  if (req.user.role !== "admin") return res.status(403).json({ error: "Admin only" });
  next();
}

// basic email shape check (real validation happens client-side too)
const looksLikeEmail = (s) => /^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(String(s || "").trim());

module.exports = {
  hashPassword, verifyPassword, createSession, destroySession, sessionUser,
  attachUser, requireUser, requireAdmin, setSessionCookie, clearSessionCookie,
  readCookie, looksLikeEmail, COOKIE,
};
