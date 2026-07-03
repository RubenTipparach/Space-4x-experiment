// Register Stellar Frontier's Discord slash commands (run once, and again
// whenever the command list changes):
//
//   DISCORD_CLIENT_ID=... DISCORD_BOT_TOKEN=... node scripts/discord/register-commands.mjs
//
// Registers GLOBAL commands (may take up to an hour to propagate). To iterate
// instantly against one server, also set DISCORD_GUILD_ID and they register
// guild-scoped instead. The gateway answers these at POST /interactions.
const APP_ID = process.env.DISCORD_CLIENT_ID;
const TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD = process.env.DISCORD_GUILD_ID;
if (!APP_ID || !TOKEN) { console.error('Set DISCORD_CLIENT_ID and DISCORD_BOT_TOKEN.'); process.exit(1); }

const COMMANDS = [
  { name: 'status', description: 'Is Stellar Frontier up? Get the play link.' },
  { name: 'fleet', description: 'Show your fleet roster.' },
];

const url = GUILD
  ? `https://discord.com/api/v10/applications/${APP_ID}/guilds/${GUILD}/commands`
  : `https://discord.com/api/v10/applications/${APP_ID}/commands`;
const r = await fetch(url, {
  method: 'PUT',
  headers: { Authorization: `Bot ${TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(COMMANDS),
});
console.log(r.ok ? `Registered ${COMMANDS.length} ${GUILD ? 'guild' : 'global'} commands.` : `Failed ${r.status}: ${await r.text()}`);
