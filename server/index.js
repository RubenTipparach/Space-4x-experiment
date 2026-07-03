// Stellar Frontier gateway (Phase 1 of docs/TECH_DESIGN.md §7): one Fly.io
// machine that serves the built Three.js client AND the first slice of the
// backend — Discord OAuth login, webhook/DM notifications, the slash-command
// interactions endpoint, and /healthz for Fly's checks. Modeled on the
// high-frontier-fan-game reference server (raw REST, secrets-optional).
//
// Run locally:  node server/index.js   (client dev server proxies /api,/auth here)
import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  oauthEnabled, botEnabled, webhookEnabled, interactionsEnabled,
  authorizeUrl, exchangeCode, sendWebhook, sendDM, verifyInteraction,
} from './discord.js';

const app = express();
const PORT = Number(process.env.PORT || 8080);
const BASE = (process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const started = Date.now();

// Session cookies are HMAC-signed with SESSION_SECRET. A missing secret gets a
// random one (sessions won't survive restarts) + a loud warning — never ship that.
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET) console.warn('[gateway] SESSION_SECRET not set — using a random one (sessions reset on restart). Set it via `fly secrets set SESSION_SECRET=...`');

const sign = (data) => crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');
const encodeSession = (user) => { const b = Buffer.from(JSON.stringify(user)).toString('base64url'); return `${b}.${sign(b)}`; };
function decodeSession(cookieVal) {
  if (!cookieVal) return null;
  const [b, mac] = String(cookieVal).split('.');
  if (!b || !mac) return null;
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sign(b)), Buffer.from(mac))) return null;
    return JSON.parse(Buffer.from(b, 'base64url').toString());
  } catch { return null; }
}
const readCookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((c) => { const i = c.indexOf('='); return i < 0 ? [c.trim(), ''] : [c.slice(0, i).trim(), decodeURIComponent(c.slice(i + 1))]; }));
const sessionOf = (req) => decodeSession(readCookies(req).sf_session);
const COOKIE = (name, val, maxAge) => `${name}=${val}; Path=/; HttpOnly; SameSite=Lax${BASE.startsWith('https') ? '; Secure' : ''}${maxAge ? `; Max-Age=${maxAge}` : ''}`;

// /interactions must see the RAW body for signature verification.
app.use('/interactions', express.raw({ type: '*/*' }));
app.use(express.json());
app.use(cors({ origin: true, credentials: true }));

// ---------- health (Fly's http check hits this) ----------
app.get('/healthz', (_req, res) => res.json({
  ok: true, uptime_s: Math.round((Date.now() - started) / 1000),
  discord: { oauth: oauthEnabled(), bot: botEnabled(), webhook: webhookEnabled(), interactions: interactionsEnabled() },
}));

// ---------- Discord OAuth (identify only; secret never leaves the server) ----------
const redirectUri = () => process.env.DISCORD_REDIRECT_URI || `${BASE}/auth/discord/callback`;

app.get('/auth/discord/login', (_req, res) => {
  if (!oauthEnabled()) return res.status(503).send('Discord login is not configured (set DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET).');
  const state = crypto.randomBytes(16).toString('hex');
  res.setHeader('Set-Cookie', COOKIE('sf_oauth_state', state, 600));
  res.redirect(authorizeUrl(redirectUri(), state));
});

app.get('/auth/discord/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code || !state || state !== readCookies(req).sf_oauth_state) return res.status(400).send('OAuth state mismatch — try logging in again.');
    const user = await exchangeCode(String(code), redirectUri());
    res.setHeader('Set-Cookie', [COOKIE('sf_session', encodeSession(user), 30 * 24 * 3600), COOKIE('sf_oauth_state', '', 0)]);
    res.redirect('/');
  } catch (e) {
    console.error('[oauth]', e);
    res.status(502).send('Discord login failed — check the gateway logs.');
  }
});

app.get('/api/me', (req, res) => {
  const u = sessionOf(req);
  if (!u) return res.status(401).json({ error: 'not_logged_in' });
  res.json(u);
});
app.post('/api/logout', (_req, res) => { res.setHeader('Set-Cookie', COOKIE('sf_session', '', 0)); res.json({ ok: true }); });

// Session-gated notification relay: the client can push game events (voyage
// arrived, hold full, colony milestones later) to the alliance channel webhook.
app.post('/api/notify', async (req, res) => {
  const u = sessionOf(req);
  if (!u) return res.status(401).json({ error: 'not_logged_in' });
  const msg = String(req.body?.message || '').trim();
  if (!msg) return res.status(400).json({ error: 'empty_message' });
  res.json(await sendWebhook(`**${u.global_name || u.username}** · ${msg}`));
});

// ---------- Discord interactions endpoint (slash commands over HTTP) ----------
// Register commands once with scripts/discord/register-commands.mjs, point the
// application's "Interactions Endpoint URL" at {BASE}/interactions, and Discord
// will POST signed payloads here — no gateway websocket, no discord.js.
app.post('/interactions', (req, res) => {
  const sig = req.get('X-Signature-Ed25519') || '', ts = req.get('X-Signature-Timestamp') || '';
  if (!interactionsEnabled() || !verifyInteraction(sig, ts, req.body)) return res.status(401).send('bad signature');
  const i = JSON.parse(req.body.toString());
  if (i.type === 1) return res.json({ type: 1 });   // PING → PONG (Discord's URL validation)
  if (i.type === 2 && i.data?.name === 'status') {
    return res.json({ type: 4, data: { content: `🛰️ **Stellar Frontier** is live — up ${Math.round((Date.now() - started) / 60000)} min. Play: ${BASE}`, flags: 64 } });
  }
  if (i.type === 2 && i.data?.name === 'fleet') {
    // Static slice roster for now; wires to real per-player state when the sim lands.
    return res.json({ type: 4, data: { flags: 64, content: [
      '**Your fleet** (vertical slice):',
      '• Meridian — Cruiser · Spirewing — Scout · Ironside — Harvester',
      '• Cipher — Scout · Freehold — Freighter · Threnody — Cruiser',
      '• Rotmaw — Harvester · Nightglass — Scout',
    ].join('\n') } });
  }
  res.json({ type: 4, data: { content: 'Unknown command.', flags: 64 } });
});

// ---------- static client (built by `npm --prefix client run build`) ----------
const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, '..', 'client', 'dist');
app.use(express.static(dist));
app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html'), (err) => { if (err) res.status(404).send('client not built — run `npm --prefix client run build`'); }));

app.listen(PORT, () => {
  console.log(`[gateway] listening on :${PORT} (base ${BASE})`);
  console.log(`[gateway] discord: oauth=${oauthEnabled()} bot=${botEnabled()} webhook=${webhookEnabled()} interactions=${interactionsEnabled()}`);
});
