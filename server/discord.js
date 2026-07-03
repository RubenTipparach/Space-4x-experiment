// Discord integration for the Stellar Frontier gateway — raw REST, no SDK
// (mirrors the high-frontier-fan-game reference: fetch against discord.com/api,
// every feature inert when its secret is unset, so a deploy with no Discord
// secrets still boots and serves the game).
//
// Secrets (all optional, set via `fly secrets set` — see docs/DEPLOY.md):
//   DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET  → OAuth2 "Log in with Discord"
//   DISCORD_BOT_TOKEN                          → per-player DM notifications
//   DISCORD_PUBLIC_KEY                         → verifies /interactions requests
//   DISCORD_WEBHOOK_URL                        → channel notifications
import crypto from 'node:crypto';

const API = 'https://discord.com/api/v10';
const CLIENT_ID = process.env.DISCORD_CLIENT_ID || '';
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || '';
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || '';
const PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY || '';
const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || '';

export const oauthEnabled = () => !!(CLIENT_ID && CLIENT_SECRET);
export const botEnabled = () => !!BOT_TOKEN;
export const webhookEnabled = () => !!WEBHOOK_URL;
export const interactionsEnabled = () => !!PUBLIC_KEY;

// ---------- OAuth2 (identify scope only — Discord is the login system) ----------
export function authorizeUrl(redirectUri, state) {
  const q = new URLSearchParams({
    client_id: CLIENT_ID, redirect_uri: redirectUri, response_type: 'code',
    scope: 'identify', state, prompt: 'none',
  });
  return `https://discord.com/oauth2/authorize?${q}`;
}

// Exchange the callback code for a token, then fetch the user. The client
// secret is only ever used HERE, server-side (TECH_DESIGN §8.1).
export async function exchangeCode(code, redirectUri) {
  const r = await fetch(`${API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
      grant_type: 'authorization_code', code, redirect_uri: redirectUri,
    }),
  });
  if (!r.ok) throw new Error(`token exchange ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const tok = await r.json();
  const u = await fetch(`${API}/users/@me`, { headers: { Authorization: `Bearer ${tok.access_token}` } });
  if (!u.ok) throw new Error(`users/@me ${u.status}`);
  const user = await u.json();
  return { id: user.id, username: user.username, global_name: user.global_name || null, avatar: user.avatar || null };
}

// ---------- channel webhook (fire-and-forget, never throws) ----------
export async function sendWebhook(content) {
  if (!WEBHOOK_URL) return { ok: false, error: 'webhook_disabled' };
  try {
    const r = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: String(content).slice(0, 1800), username: 'Stellar Frontier' }),
    });
    return r.ok ? { ok: true } : { ok: false, error: `webhook ${r.status}` };
  } catch (e) { return { ok: false, error: String(e?.message || e) }; }
}

// ---------- bot DMs (needs a shared server + open DMs, like the reference) ----------
const _dmChannel = new Map();   // userId -> DM channel id (opening is rate-limited)
export async function sendDM(userId, content) {
  if (!BOT_TOKEN) return { ok: false, error: 'discord_disabled' };
  const uid = String(userId || '').trim();
  if (!/^\d{5,25}$/.test(uid)) return { ok: false, error: 'bad_discord_id' };
  try {
    let channelId = _dmChannel.get(uid);
    if (!channelId) {
      const r = await fetch(`${API}/users/@me/channels`, {
        method: 'POST',
        headers: { Authorization: `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient_id: uid }),
      });
      if (!r.ok) return { ok: false, error: `open DM ${r.status}` };
      channelId = (await r.json()).id; _dmChannel.set(uid, channelId);
    }
    const r = await fetch(`${API}/channels/${channelId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: String(content).slice(0, 1800) }),
    });
    if (!r.ok) { _dmChannel.delete(uid); return { ok: false, error: `send ${r.status}` }; }
    return { ok: true };
  } catch (e) { return { ok: false, error: String(e?.message || e) }; }
}

// ---------- interactions endpoint signature check (slash commands over HTTP) ----------
// Discord signs every interaction with ed25519; Node 20 verifies natively, so no
// tweetnacl/discord-interactions dependency. Raw 32-byte key → DER-wrapped SPKI.
let _pubKey = null;
function publicKey() {
  if (_pubKey || !PUBLIC_KEY) return _pubKey;
  const der = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(PUBLIC_KEY, 'hex')]);
  _pubKey = crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
  return _pubKey;
}
export function verifyInteraction(signature, timestamp, rawBody) {
  try {
    const key = publicKey(); if (!key) return false;
    return crypto.verify(null, Buffer.concat([Buffer.from(timestamp), rawBody]), key, Buffer.from(signature, 'hex'));
  } catch { return false; }
}
