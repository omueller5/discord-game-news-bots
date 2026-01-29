# Discord Game News Bots

A shared Discord bot system that tracks **official news and updates** for multiple games and posts them to Discord in real time.

This project is designed to run **four independent Discord bots simultaneously**, all from one shared Node.js / Playwright codebase, while keeping each bot fully isolated in behavior, commands, and output channels.

Supported bots:
- **ZZZ** — Zenless Zone Zero  
- **GF2E** — Girls’ Frontline 2: Exilium  
- **NIKKE** — GODDESS OF VICTORY: NIKKE  
- **HSR** — Honkai: Star Rail  

Each bot uses its own Discord application and token, but they all run together in a single process with a shared scheduler.

---

## Features

- Runs **four Discord bots at the same time**
- Tracks official news sources only (X or official websites)
- Per-bot slash commands:
  - `/zzz`, `/zzz-news`, `/zzz-patch`
  - `/gf2e`, `/gf2e-news`, `/gf2e-patch`
  - `/nikke`, `/nikke-news`, `/nikke-patch`
  - `/hsr`, `/hsr-news`, `/hsr-patch`
- Automatic background watcher that posts new updates as they appear
- Per-bot state files to prevent reposting old news
- Global error handlers to avoid silent crashes
- Designed for long-running use via **Windows Task Scheduler**

---

## Requirements

- Node.js (recommended version 18 or newer)
- Playwright
- Four Discord bot tokens (one per bot)
- One Discord server (guild)
- One text channel per bot for news posts

---

## Setup

### Install dependencies

Open a terminal in the project directory and run:

```bash
npm install
npx playwright install
```

---

### Create the `.env` file

Create a file named `.env` in the project root (the same folder as `index.js`) and add the following:

```env
# ========= SHARED =========
GUILD_ID=your_server_guild_id_here

# ========= ZZZ BOT =========
ZZZ_DISCORD_TOKEN=your_zzz_bot_token
ZZZ_ALERT_CHANNEL_ID=zzz_channel_id
ZZZ_X_HANDLE=ZZZ_EN

# ========= GF2E BOT =========
GF2E_DISCORD_TOKEN=your_gf2e_bot_token
GF2E_ALERT_CHANNEL_ID=gf2e_channel_id
GF2E_SOURCE=WEB
GF2E_WEB_URL=https://gf2exilium.sunborngame.com/main/noticeMore

# ========= NIKKE BOT =========
NIKKE_DISCORD_TOKEN=your_nikke_bot_token
NIKKE_ALERT_CHANNEL_ID=nikke_channel_id
NIKKE_SOURCE=WEB
NIKKE_WEB_URL=https://nikke-en.com/news

# ========= HSR BOT =========
HSR_DISCORD_TOKEN=your_hsr_bot_token
HSR_ALERT_CHANNEL_ID=hsr_channel_id
HSR_X_HANDLE=honkaistarrail
```

---

### Environment variable reference

`GUILD_ID`  
Your Discord server ID  
Enable Developer Mode in Discord → Right-click the server → Copy ID

`*_DISCORD_TOKEN`  
Bot token from the Discord Developer Portal  
Application → Bot → Token

`*_ALERT_CHANNEL_ID`  
Channel where that bot posts news  
Right-click the channel → Copy ID

`*_X_HANDLE`  
Official X (Twitter) username **without** the `@`

`*_SOURCE`  
Set to `WEB` to use an official website instead of X

`*_WEB_URL`  
Official news page URL used when `SOURCE=WEB`

> Do not commit the `.env` file. It contains private credentials and should remain local only.

---

## Running the bots

Start all four bots at once with:

```bash
node index.js
```

If configured correctly:
- Each bot logs in
- Slash commands are registered per bot
- Initial “watching” messages appear in each alert channel
- The shared scheduler begins polling for updates

---

## Windows Task Scheduler (Recommended for 24/7 use)

This project is designed to run continuously using Windows Task Scheduler, without wrapper scripts.

### Action configuration

- **Program/script**
  ```
  C:\Program Files\nodejs\node.exe
  ```

- **Add arguments**
  ```
  index.js
  ```

- **Start in**
  ```
  Full path to the project folder containing index.js
  ```

### Task settings

- Enable **Restart the task if it fails**
- Disable **Stop the task if it runs longer than…**
- Set **If the task is already running** → *Do not start a new instance*

---

## Reliability notes

This project includes global handlers for:
- `unhandledRejection`
- `uncaughtException`
- Discord client errors

These prevent silent failures when running unattended.  
Website and X scraping intentionally avoids aggressive hard timeouts to reduce broken sessions and orphaned browser processes.

---

## Troubleshooting

### Commands take a while to respond

Website or X scraping may take a few seconds depending on page load speed.  
If a command appears slow, wait briefly and try again.

### A bot stops posting updates

Run the bot manually in a terminal to inspect console output.  
If using Task Scheduler, check the task history for restart attempts or errors.

---

## 🔖 **Credits**

Made by Owen  

Zenless Zone Zero is © HoYoverse  
Girls’ Frontline 2: Exilium is © Sunborn Network  
GODDESS OF VICTORY: NIKKE is © SHIFT UP / Level Infinite  
Honkai: Star Rail is © HoYoverse
