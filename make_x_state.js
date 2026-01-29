// make_x_state.js
// Creates <botkey>_x_state.json, ONLY if it detects real auth cookies:
// - auth_token (login session)
// - ct0 (CSRF token)
//
// Usage:
//   node make_x_state.js NIKKE NIKKE_en

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { chromium } from "playwright";

const botKey = (process.argv[2] || "").toUpperCase();
const handle = String(process.argv[3] || "").replace(/^@/, "").trim();

if (!botKey || !handle) {
  console.log("Usage: node make_x_state.js <BOTKEY> <HANDLE>");
  console.log("Example: node make_x_state.js NIKKE NIKKE_en");
  process.exit(1);
}

const username = process.env.USERNAME || os.userInfo().username || "";
const home = process.env.USERPROFILE || `C:\\Users\\${username}`;

function exists(p) {
  try { return fs.existsSync(p); } catch { return false; }
}
function pickFirst(paths) {
  for (const p of paths) if (p && exists(p)) return p;
  return null;
}

const OPERA_GX_EXE = pickFirst([
  path.join(home, "AppData", "Local", "Programs", "Opera GX", "opera.exe"),
  "C:\\Program Files\\Opera GX\\opera.exe",
  "C:\\Program Files (x86)\\Opera GX\\opera.exe",
]);

if (!OPERA_GX_EXE) {
  console.error("OperaGX executable not found in common locations.");
  process.exit(1);
}

// IMPORTANT: separate Playwright profile, so it can run while your real OperaGX is open
const profileDir = path.resolve(process.cwd(), "_pw_profiles", botKey.toLowerCase());
fs.mkdirSync(profileDir, { recursive: true });

const outFile = path.resolve(process.cwd(), `${botKey.toLowerCase()}_x_state.json`);

async function cookieNames(ctx) {
  const cookies = await ctx.cookies();
  return cookies.map((c) => `${c.name}@${c.domain}`);
}

async function hasAuth(ctx) {
  const cookies = await ctx.cookies();
  const names = new Set(cookies.map((c) => c.name));
  return {
    auth_token: names.has("auth_token"),
    ct0: names.has("ct0"),
    names: cookies
      .filter((c) => (c.domain || "").includes("x.com") || (c.domain || "").includes("twitter.com"))
      .map((c) => `${c.name}@${c.domain}`),
  };
}

(async () => {
  console.log("[make_x_state] Using OperaGX exe:", OPERA_GX_EXE);
  console.log("[make_x_state] Playwright profile dir:", profileDir);
  console.log("[make_x_state] Output file:", outFile);

  const ctx = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    executablePath: OPERA_GX_EXE,
    args: ["--no-first-run", "--no-default-browser-check"],
  });

  const page = await ctx.newPage();
  await page.goto(`https://x.com/${handle}?f=live`, { waitUntil: "domcontentloaded" });

  console.log("\nACTION REQUIRED:");
  console.log("1) In this Playwright OperaGX window, log into X.");
  console.log("2) AFTER login, go to https://x.com/home and make sure you see your feed.");
  console.log("3) Then come back here and press ENTER.\n");

  await new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    process.stdin.once("data", () => resolve());
  });

  // Force a reload on /home, which is where auth cookies typically become visible
  await page.goto("https://x.com/home", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);

  const auth = await hasAuth(ctx);

  console.log("\n[make_x_state] Cookie summary (x.com/twitter.com):");
  console.log(auth.names.join(", ") || "(none)");

  if (!auth.auth_token || !auth.ct0) {
    console.error("\n[make_x_state] ❌ Not authenticated (missing auth_token and/or ct0).");
    console.error("This means you are NOT truly logged in inside this Playwright profile.");
    console.error("Fix: complete login, then visit https://x.com/home, then press ENTER again.\n");
    await ctx.close();
    process.exit(1);
  }

  const state = await ctx.storageState();
  fs.writeFileSync(outFile, JSON.stringify(state, null, 2), "utf8");
  console.log("\n[make_x_state] ✅ Saved authenticated state:", outFile);

  await ctx.close();
})();
