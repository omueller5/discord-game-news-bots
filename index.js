import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pkg from "discord.js";

import { getLatestXNews, getLatestXPatch, debugX } from "./x_watcher.js";

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
} = pkg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// -------------------------
// CONFIG
// -------------------------
const guildId = process.env.GUILD_ID;

const CHECK_EVERY_MS = 10 * 60 * 1000; // 10 minutes
const ANNOUNCE_ON_START = true;

// Bot definitions (keys must match your env prefixes)
const BOTS = [
  { key: "ZZZ", label: "ZZZ", cmd: "zzz" },
  { key: "GF2E", label: "GF2E", cmd: "gf2e" },
  { key: "NIKKE", label: "NIKKE", cmd: "nikke" },
  { key: "HSR", label: "HSR", cmd: "hsr" },
];

// -------------------------
// Helpers
// -------------------------
function envFor(botKey, suffix) {
  return process.env[`${botKey}_${suffix}`];
}

function botSource(botKey) {
  return String(process.env[`${botKey}_SOURCE`] || "X").toUpperCase().trim();
}

function statePathFor(botKey) {
  return path.join(__dirname, `${botKey.toLowerCase()}_state_x.json`);
}

function readState(botKey) {
  const file = statePathFor(botKey);
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return { lastUrl: null, lastAnnouncedAt: null };
  }
}

function writeState(botKey, state) {
  const file = statePathFor(botKey);
  fs.writeFileSync(file, JSON.stringify(state, null, 2), "utf8");
}

function clip(s, n) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

// Convert “now” to a UTC+8 day key (YYYY-MM-DD)
function utc8DayKey(date = new Date()) {
  const ms = date.getTime() + 8 * 60 * 60 * 1000;
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Look for the most recent [BOT] message "today" (UTC+8) in that bot's alert channel
async function getTodayStatus(channel, bracketTag) {
  const todayKey = utc8DayKey();
  const messages = await channel.messages.fetch({ limit: 50 });

  const botMsgs = [...messages.values()]
    .filter((m) => (m.content || "").includes(bracketTag))
    .sort((a, b) => b.createdTimestamp - a.createdTimestamp);

  for (const m of botMsgs) {
    const msgDay = utc8DayKey(new Date(m.createdTimestamp));
    if (msgDay !== todayKey) continue;
    return { status: "posted", message: m.content || "" };
  }

  return { status: "not_yet", message: null };
}

async function registerCommands({ token, appId, guildId, cmd, label }) {
  const cmdStatus = new SlashCommandBuilder()
    .setName(cmd)
    .setDescription(`Show today's ${label} bot status (UTC+8).`);

  const cmdPatch = new SlashCommandBuilder()
    .setName(`${cmd}-patch`)
    .setDescription(`Show the latest ${label} patch/update post (title + link + excerpt).`);

  const cmdNews = new SlashCommandBuilder()
    .setName(`${cmd}-news`)
    .setDescription(`Show the latest ${label} news post (title + link + excerpt).`);

  const cmdXDebug = new SlashCommandBuilder()
    .setName(`${cmd}-xdebug`)
    .setDescription(`Debug: show what the bot is getting and what it parsed.`);

  const rest = new REST({ version: "10" }).setToken(token);

  await rest.put(Routes.applicationGuildCommands(appId, guildId), {
    body: [cmdStatus.toJSON(), cmdPatch.toJSON(), cmdNews.toJSON(), cmdXDebug.toJSON()],
  });

  console.log(`[commands] Registered for ${label}: (/${cmd} …)`);
}

// -------------------------
// Boot & validation
// -------------------------
if (!guildId) throw new Error("Missing env var: GUILD_ID");

process.on("unhandledRejection", (err) => console.error("[unhandledRejection]", err));
process.on("uncaughtException", (err) => console.error("[uncaughtException]", err));

// Build runtime bots with per-source validation
const runtime = BOTS.map((b) => {
  const token = envFor(b.key, "DISCORD_TOKEN");
  const alertChannelId = envFor(b.key, "ALERT_CHANNEL_ID");

  if (!token || !alertChannelId) {
    throw new Error(
      `Missing env vars for ${b.key}. Need ${b.key}_DISCORD_TOKEN and ${b.key}_ALERT_CHANNEL_ID`
    );
  }

  const source = botSource(b.key);

  // For X source: require X_HANDLE
  // For WEB source: require WEB_URL
  let handle = null;
  let webUrl = null;

  if (source === "WEB") {
    webUrl = envFor(b.key, "WEB_URL");
    if (!webUrl) {
      throw new Error(`Missing env var for ${b.key}. Need ${b.key}_WEB_URL (because ${b.key}_SOURCE=WEB)`);
    }
    // still pass something as "handle" to keep function signatures stable
    handle = `${b.key}_WEB`;
  } else {
    handle = envFor(b.key, "X_HANDLE");
    if (!handle) {
      throw new Error(`Missing env var for ${b.key}. Need ${b.key}_X_HANDLE (because ${b.key}_SOURCE=X)`);
    }
  }

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  });

  client.on("error", (err) => console.error(`[${b.key} client error]`, err));

  return {
    ...b,
    token,
    alertChannelId,
    handle,
    webUrl,
    source,
    client,
    bracketTag: `[${b.label}]`,
    ready: false,
  };
});

// -------------------------
// Per-bot ready + command handlers
// -------------------------
for (const bot of runtime) {
  bot.client.once("ready", async () => {
    bot.ready = true;
    console.log(`Bot ready as ${bot.client.user.tag} (${bot.label})`);

    await registerCommands({
      token: bot.token,
      appId: bot.client.user.id,
      guildId,
      cmd: bot.cmd,
      label: bot.label,
    });

    if (ANNOUNCE_ON_START) {
      try {
        const channel = await bot.client.channels.fetch(bot.alertChannelId);
        if (channel && channel.isTextBased()) {
          if (bot.source === "WEB") {
            await channel.send(`🛰️ **${bot.bracketTag} WEB (bot started):** Watching official site`);
          } else {
            await channel.send(`🛰️ **${bot.bracketTag} X (bot started):** Watching @${bot.handle}`);
          }
        }
      } catch (e) {
        console.warn(`[${bot.key}] startup announce failed:`, e?.message || e);
      }
    }
  });

  bot.client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const cmd = interaction.commandName;

    const isMine =
      cmd === bot.cmd ||
      cmd === `${bot.cmd}-news` ||
      cmd === `${bot.cmd}-patch` ||
      cmd === `${bot.cmd}-xdebug`;

    if (!isMine) return;

    try {
      await interaction.deferReply();
    } catch (e) {
      console.warn(`[${bot.key}] deferReply failed:`, e?.message || e);
      return;
    }

    try {
      const channel = await bot.client.channels.fetch(bot.alertChannelId);
      if (!channel || !channel.isTextBased()) {
        await interaction.editReply("Alert channel not found or not text-based.");
        return;
      }

      // /<cmd> (status)
      if (cmd === bot.cmd) {
        const today = utc8DayKey();
        const result = await getTodayStatus(channel, bot.bracketTag);

        const color = result.status === "posted" ? 0x2ecc71 : 0xf1c40f;
        const title =
          result.status === "posted"
            ? `${bot.label}: POSTED TODAY ✅`
            : `${bot.label}: NO POST TODAY ⚠️`;

        const desc =
          result.status === "posted"
            ? `Status for **${today} (UTC+8)**: **Posted**\n\n**Last log:**\n${result.message}`
            : `Status for **${today} (UTC+8)**: **No post found yet**\n\nNo ${bot.label} log found for today yet.`;

        const embed = new EmbedBuilder().setTitle(title).setDescription(desc).setColor(color);
        await interaction.editReply({ embeds: [embed] });
        return;
      }

      // /<cmd>-news
      if (cmd === `${bot.cmd}-news`) {
        const latest = await getLatestXNews({ handle: bot.handle, botKey: bot.key });
        if (!latest) {
          await interaction.editReply("No posts found.");
          return;
        }

        const excerpt = latest.text ? `\n\n> ${latest.text}` : "";

        const embed = new EmbedBuilder()
          .setTitle(`📰 ${bot.label}: ${latest.title}`)
          .setDescription(`${latest.url}${excerpt}`)
          .setColor(0x3498db);

        await interaction.editReply({ embeds: [embed] });
        return;
      }

      // /<cmd>-patch
      if (cmd === `${bot.cmd}-patch`) {
        const patch = await getLatestXPatch({ handle: bot.handle, botKey: bot.key });
        const latest = patch || (await getLatestXNews({ handle: bot.handle, botKey: bot.key }));

        if (!latest) {
          await interaction.editReply("No posts found.");
          return;
        }

        const isFallback = !patch;
        const titlePrefix = isFallback
          ? `🧩 ${bot.label} Patch/Update (fallback):`
          : `🧩 ${bot.label} Patch/Update:`;

        const desc = `${latest.url}${latest.text ? `\n\n> ${latest.text}` : ""}`;

        const embed = new EmbedBuilder()
          .setTitle(`${titlePrefix} ${latest.title}`)
          .setDescription(desc)
          .setColor(0x9b59b6);

        await interaction.editReply({ embeds: [embed] });
        return;
      }

      // /<cmd>-xdebug
      if (cmd === `${bot.cmd}-xdebug`) {
        const info = await debugX({ handle: bot.handle, botKey: bot.key });

        const lines = [
          `**Bot:** ${bot.label}`,
          `**Source:** ${bot.source}`,
          bot.source === "WEB" ? `**WEB_URL:** ${bot.webUrl}` : `**X Handle:** @${bot.handle}`,
          `**OK:** ${info.ok ? "yes" : "no"}`,
          info.error ? `**Error:** ${info.error}` : null,
          `**Parsed posts:** ${info.found ?? 0}`,
          ``,
          `**Sample:**`,
          ...(info.sample?.length
            ? info.sample.map((p) => `- ${p.title}\n  ${p.url} (${p.source || "?"})`)
            : ["- (none)"]),
        ].filter(Boolean);

        const embed = new EmbedBuilder()
          .setTitle(`${bot.label} Debug`)
          .setDescription(lines.join("\n").slice(0, 3900))
          .setColor(info.ok ? 0xf1c40f : 0xe74c3c);

        await interaction.editReply({ embeds: [embed] });
        return;
      }

      await interaction.editReply("Unknown command.");
    } catch (err) {
      console.error(`[${bot.key}] interaction error`, err);
      try {
        await interaction.editReply("Error handling command. Check bot console logs.");
      } catch {
        // ignore
      }
    }
  });
}

// -------------------------
// Single shared scheduler loop
// -------------------------
async function schedulerTick() {
  for (const bot of runtime) {
    if (!bot.ready) continue;

    try {
      const state = readState(bot.key);
      const latest = await getLatestXNews({ handle: bot.handle, botKey: bot.key });
      if (!latest?.url) continue;

      if (!state.lastUrl) {
        if (ANNOUNCE_ON_START) {
          const channel = await bot.client.channels.fetch(bot.alertChannelId);
          if (channel && channel.isTextBased()) {
            const excerpt = latest.text ? `\n> ${latest.text}` : "";
            await channel.send(
              `🛰️ **${bot.bracketTag} ${latest.source || bot.source} (first run):** ${clip(latest.title, 120)}\n${latest.url}${excerpt}`
            );
          }
        }
        state.lastUrl = latest.url;
        state.lastAnnouncedAt = new Date().toISOString();
        writeState(bot.key, state);
        continue;
      }

      if (latest.url !== state.lastUrl) {
        const channel = await bot.client.channels.fetch(bot.alertChannelId);
        if (channel && channel.isTextBased()) {
          const excerpt = latest.text ? `\n> ${latest.text}` : "";
          await channel.send(
            `🛰️ **${bot.bracketTag} ${latest.source || bot.source}:** ${clip(latest.title, 120)}\n${latest.url}${excerpt}`
          );
        }

        state.lastUrl = latest.url;
        state.lastAnnouncedAt = new Date().toISOString();
        writeState(bot.key, state);
      }
    } catch (e) {
      console.error(`[scheduler ${bot.key}]`, e?.message || e);
    }
  }
}

function startScheduler() {
  setTimeout(() => {
    schedulerTick().catch((e) => console.error("[schedulerTick initial]", e));
    setInterval(
      () => schedulerTick().catch((e) => console.error("[schedulerTick]", e)),
      CHECK_EVERY_MS
    );
  }, 10_000);
}

// -------------------------
// Login all bots, then start scheduler
// -------------------------
(async () => {
  await Promise.all(runtime.map((b) => b.client.login(b.token)));
  startScheduler();
})();
