# Deploying Stellar Frontier (Fly.io + Discord)

One Fly.io app (`stellar-frontier`) serves the built client **and** the gateway
API (`server/index.js`) — Discord OAuth login, webhook/DM notifications, the
slash-command interactions endpoint, and `/healthz`. The GitHub Pages workflow
keeps publishing the static client separately for quick previews.

The deploy pipeline (`.github/workflows/fly-deploy.yml`) follows the
[high-frontier-fan-game](https://github.com/RubenTipparach/high-frontier-fan-game)
reference: readiness gate → volume/machine enforcement → staged secrets →
retried deploy. Until the one-time setup below is done, the Fly job **skips**
(with a notice) instead of failing — pushes stay green.

## One-time setup

### 1. Fly.io bootstrap (local, with [flyctl](https://fly.io/docs/flyctl/))

```sh
fly auth login
fly apps create stellar-frontier          # if the name is taken, pick another and
                                          # update server/fly.toml `app` + the
                                          # APP env in fly-deploy.yml + PUBLIC_BASE_URL
fly volumes create sf_data --size 1 --region ord --app stellar-frontier
fly secrets set SESSION_SECRET="$(openssl rand -hex 32)" --app stellar-frontier
```

### 2. GitHub Actions deploy token

```sh
fly tokens create deploy -a stellar-frontier
gh secret set FLY_API_TOKEN               # paste the FlyV1 ... token
```

From the next push, the Fly job goes `ready=true` and deploys automatically.

### 3. Discord application (all optional — features light up per secret)

In the [Discord Developer Portal](https://discord.com/developers/applications)
create an application **Stellar Frontier**, then:

| Where in the portal | What | Fly secret |
| --- | --- | --- |
| OAuth2 → Client ID | app id | `DISCORD_CLIENT_ID` |
| OAuth2 → Client Secret | **server-side only** | `DISCORD_CLIENT_SECRET` |
| OAuth2 → Redirects | add `https://stellar-frontier.fly.dev/auth/discord/callback` | — |
| Bot → Token | for DM notifications | `DISCORD_BOT_TOKEN` |
| General → Public Key | verifies `/interactions` | `DISCORD_PUBLIC_KEY` |
| A channel → Integrations → Webhooks | alliance-channel feed | `DISCORD_WEBHOOK_URL` |

Set them on Fly (or as GitHub Actions secrets of the same names — the workflow
stages any that exist before each deploy and never clobbers ones it doesn't have):

```sh
fly secrets set DISCORD_CLIENT_ID=... DISCORD_CLIENT_SECRET=... \
                DISCORD_PUBLIC_KEY=... DISCORD_BOT_TOKEN=... \
                DISCORD_WEBHOOK_URL=... --app stellar-frontier
```

> Per TECH_DESIGN §8: the client secret and bot token live **only** in Fly
> secrets — never in the repo, never in the client bundle.

### 4. Slash commands + interactions URL

```sh
DISCORD_CLIENT_ID=... DISCORD_BOT_TOKEN=... node scripts/discord/register-commands.mjs
```

Then set the application's **Interactions Endpoint URL** to
`https://stellar-frontier.fly.dev/interactions` (the gateway answers Discord's
PING validation once `DISCORD_PUBLIC_KEY` is set). `/status` and `/fleet` work
from any server the bot is invited to.

## What players get

- **Log in with Discord** — the nav button starts the OAuth `identify` flow;
  the gateway mints a signed HttpOnly session cookie (`/api/me` reads it).
- **`/status`**, **`/fleet`** slash commands (ephemeral replies).
- **Channel notifications** via `POST /api/notify` (session-gated) → webhook.
- **DMs** via the bot token (shared-server rule applies) — `sendDM()` in
  `server/discord.js`, ready for mission-complete pings.

## Local dev

```sh
npm --prefix client run build      # gateway serves client/dist
node server/index.js               # http://localhost:8080 (game + API)
# or: run `npm --prefix client run dev` (5173) — vite proxies /api,/auth,/healthz to 8080
cp server/.env.example server/.env # optional: fill in Discord creds for local OAuth
```

For local OAuth, add `http://localhost:8080/auth/discord/callback` as a second
redirect in the portal and export the `DISCORD_*` vars before starting the
server (Node 20+ auto-loads nothing — use `node --env-file=server/.env server/index.js`).

## Ops crib sheet

```sh
fly status -a stellar-frontier            # machines + health
fly logs -a stellar-frontier              # live gateway logs
fly secrets list -a stellar-frontier      # names + digests only
curl https://stellar-frontier.fly.dev/healthz   # {ok, discord:{oauth,bot,webhook,interactions}}
fly deploy --config server/fly.toml --dockerfile server/Dockerfile .   # manual deploy
```
