// ReplyFlow — structured logging (pino). One logger for the whole app.
// Secrets are redacted by the serializer, so it is safe to log request bodies.
const pino = require("pino");

const level = process.env.LOG_LEVEL || (process.env.NODE_ENV === "production" ? "info" : "debug");

const logger = pino({
  level,
  base: undefined, // no pid/hostname noise in local dev
  redact: {
    paths: [
      "access_token", "accessToken", "*.access_token", "*.accessToken",
      "app_secret", "appSecret", "metaAppSecret",
      "password", "*.password", "currentPassword",
      "token", "*.token",
      "TOKEN_ENC_KEY", "verifyToken",
    ],
    censor: "[redacted]",
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

module.exports = logger;
