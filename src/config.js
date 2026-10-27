// ReplyLo — central configuration.
// All URLs/keys come from env vars. They are intentionally EMPTY by default:
// the backend runs in DRY-RUN mode until you fill them in (see .env.example).

require("dotenv").config();

const config = {
  port: parseInt(process.env.PORT || "3000", 10),

  // Webhook verification token (must match what you enter in Meta App dashboard).
  verifyToken: process.env.VERIFY_TOKEN || "my-verify-token",

  // --- Meta app credentials (leave empty for now) ---
  metaAppId: process.env.META_APP_ID || "",           // e.g. "1234567890"
  metaAppSecret: process.env.META_APP_SECRET || "",   // App secret from Meta dashboard
  // OAuth redirect that you register in the Meta app. Empty for now.
  metaRedirectUri: process.env.META_REDIRECT_URI || "",

  // --- Meta Graph API endpoints (left empty for now; filled when you configure) ---
  // When empty, every Meta call runs in dry-run mode and is logged instead of sent.
  graphApiBase: process.env.GRAPH_API_BASE || "",     // e.g. "https://graph.instagram.com/v23.0"
  graphApiBetaBase: process.env.GRAPH_API_BETA_BASE || "", // e.g. "https://graph.facebook.com/v23.0"

  // --- This server's public URL (ngrok etc.). Empty for now. ---
  publicBaseUrl: process.env.PUBLIC_BASE_URL || "",

  // --- Behaviour knobs ---
  reminderMinutes: parseInt(process.env.REMINDER_MINUTES || "60", 10),
  // Meta's 24-hour messaging window.
  messagingWindowMs: 24 * 60 * 60 * 1000,
};

// True only when everything needed to actually call Meta is present.
config.metaConfigured = Boolean(
  config.metaAppId && config.metaAppSecret && config.graphApiBase
);

module.exports = config;
