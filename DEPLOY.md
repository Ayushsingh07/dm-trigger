  # Deploying ReplyLo to Fly.io (Windows)

One always-on `shared-cpu-1x / 256mb` machine in Mumbai (`bom`) with a 1 GB
persistent volume mounted at `/data`. The SQLite DB lives at
`/data/replylo.db` (`DATABASE_PATH` is set in `fly.toml`), nightly backups go
to `/data/backups`.

All commands below are **PowerShell** on Windows.

---

## 1. Install flyctl

```powershell
# Option A: winget
winget install --id Flyctl.Flyctl -e

# Option B: PowerShell installer
iwr https://fly.io/install.ps1 -useb | iex

# Verify + login
fly version
fly auth login        # opens the browser
```

## 2. Launch the app (no Postgres)

From the repo root (`dm-trigger\`):

```powershell
cd c:\Users\ayush.kumar\dm-automation\dm-trigger
fly launch --no-deploy
```

- When asked *"Do you want to set up a Postgres database cluster?"* → **No**
  (we use SQLite on a volume).
- When asked for a region → choose **bom (Sydney/Mumbai: Mumbai, India)**.
- `fly launch` detects the `Dockerfile` and keeps the existing `fly.toml`
  (volume mount, health checks, VM size). Review the diff it prints and accept.

## 3. Create the persistent volume

```powershell
fly volumes create data --size 1 --region bom
```

(`fly.toml` already mounts volume `data` → `/data`.)

## 4. Set secrets

Generate the token-encryption key once (32 random bytes, base64):

```powershell
$key = [Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Max 256 } | ForEach-Object { [byte]$_ }))
# or, if node is on PATH:
$key = (node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
```

Set every variable from PROJECT.md section 5 (values come from your `.env`;
never commit them):

```powershell
fly secrets set PORT=3000
fly secrets set VERIFY_TOKEN="<your webhook verify token>"
fly secrets set ADMIN_EMAIL="admin@example.com"
fly secrets set ADMIN_PASSWORD="<strong admin password>"   # only needed on first boot
fly secrets set META_APP_ID="<Meta app id>"
fly secrets set META_APP_SECRET="<Meta app secret>"
fly secrets set META_REDIRECT_URI="https://<app-name>.fly.dev/auth/callback"
# Must match the Instagram product added in the Meta app dashboard.
# instagram = "Instagram API with Instagram Login", facebook = "Instagram API with Facebook Login".
# Wrong value => "Invalid platform app" on the login screen.
fly secrets set META_OAUTH_FLOW="instagram"
fly secrets set GRAPH_API_BASE="https://graph.instagram.com/v23.0"
fly secrets set GRAPH_API_BETA_BASE="https://graph.facebook.com/v23.0"
fly secrets set PUBLIC_BASE_URL="https://<app-name>.fly.dev"
fly secrets set REMINDER_MINUTES=60
fly secrets set TOKEN_ENC_KEY="$key"
```

Notes:
- `DATABASE_PATH=/data/replylo.db` and `BACKUP_DIR=/data/backups` are set in
  `fly.toml` `[env]` — no secret needed.
- `NODE_ENV=production` is set by the Dockerfile, which turns on the `Secure`
  session cookie.
- Changing `TOKEN_ENC_KEY` after tokens exist makes them undecryptable — set it
  once, before the first OAuth connect.

## 5. Deploy

```powershell
fly deploy
```

Then watch it boot:

```powershell
fly logs
```

You should see `ReplyLo listening`, the scheduled-jobs line, and
`GET /health 200` checks. Verify from your shell:

```powershell
curl.exe https://<app-name>.fly.dev/health
```

## 6. Roll back

Every deploy keeps the previous image. List and roll back:

```powershell
fly releases                       # shows recent release ids
fly releases --verbose             # find the image digest per release
fly rollback v3                    # roll back to release v3 (no downtime)
```

Or deploy a specific git ref (if the repo is tagged/committed):

```powershell
fly deploy --remote-build
```

## 7. Custom domain

```powershell
fly certs add replylo.example.com
```

Then at your DNS provider create the record `fly certs` prints, usually:

```
CNAME  replylo.example.com  ->  <app-name>.fly.dev
```

Check status:

```powershell
fly certs check replylo.example.com
```

Once issued, update the secrets to the new canonical origin (the CSRF origin
check and OAuth redirect depend on them):

```powershell
fly secrets set PUBLIC_BASE_URL="https://replylo.example.com"
fly secrets set META_REDIRECT_URI="https://replylo.example.com/auth/callback"
```

## 8. Download a database backup

The app runs `VACUUM INTO /data/backups/replylo-<utc>.db` nightly (keeps 7).

```powershell
# list backups
fly ssh console -C /data/backups -c "ls -la"

# copy the newest backup down
fly ssh sftp get /data/backups/replylo-2026-10-27T04-00-00.db .\replylo.db

# or grab the live DB (safe thanks to WAL; a consistent snapshot is the VACUUM INTO file above)
fly ssh sftp get /data/replylo.db .\replylo-live.db
```

Restore = upload a file to the volume and restart:

```powershell
fly ssh sftp put /data/replylo.db .\replylo.db
fly machine restart
```

## 9. Handy operations

```powershell
fly status                 # machine health
fly scale show             # confirm 1 machine, shared-cpu-1x 256mb
fly ssh console            # shell inside the machine
fly secrets list           # names only, never values
```

## Troubleshooting

### "Invalid request: Request parameters are invalid: Invalid platform app"

Meta rejects the login because the app on Meta's side does not offer the login
product the app is asking for. Check these in order, in
[developers.facebook.com](https://developers.facebook.com) -> your app:

1. **Add the right Instagram product.** *Use cases* (or *App settings -> Basic*)
   must show one of:
   - **Instagram API with Instagram Login** -> set `META_OAUTH_FLOW=instagram`
   - **Instagram API with Facebook Login** -> set `META_OAUTH_FLOW=facebook`

   If the app only has "Instagram Graph API" (the old Business Manager product)
   or nothing at all, the dialog fails exactly like this. Add the product, then
   match `META_OAUTH_FLOW` to it and restart.
2. **App mode must be Live**, not "Development". In development mode only
   people listed under *App roles -> Roles* can log in.
3. **Valid OAuth Redirect URI** must contain your callback character for
   character: `https://<app-name>.fly.dev/auth/callback` (https, no trailing
   slash). Same for *App settings -> Basic -> App domains*.
4. **App ID / App Secret** in the secrets must belong to *this* app
   (*App settings -> Basic*). A secret copied from a different app produces the
   same class of error.

Then re-apply the secret and restart:

```powershell
fly secrets set META_OAUTH_FLOW="facebook"
fly logs
```

The dashboard now shows Meta's own message in a red banner under the nav after a
failed connect, so you can read the exact reason instead of a blank page.

### Connect Instagram shows JSON instead of the login page

Fixed: `GET /auth/connect` 302-redirects when the browser asks for HTML and
still returns `{ authorize_url, state }` for API clients.

## Webhook checklist (Meta App dashboard)

- Callback URL: `https://<app-name>.fly.dev/webhook`
- Verify token: same value as `VERIFY_TOKEN`
- App secret: `META_APP_SECRET` (used for `X-Hub-Signature-256` verification)
- Data deletion / deauthorize callbacks: `https://<app-name>.fly.dev/meta/data-deletion`
  and `/meta/deauthorize`
- `GRAPH_API_BASE` empty ⇒ the whole app runs in dry-run mode (no live Meta calls).
