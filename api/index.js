"use strict";
const express = require("express");
const cookieParser = require("cookie-parser");
const crypto = require("node:crypto");

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "16kb" }));
app.use(cookieParser());

const COOKIE = "ttm_session";
const COOKIE_OPTIONS = { httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge: 8 * 60 * 60 * 1000 };

function config() {
  const required = ["ADMIN_PASSWORD", "SESSION_SECRET", "TOKEN_ENCRYPTION_KEY", "GITHUB_TOKEN", "GITHUB_OWNER", "GITHUB_REPO"];
  for (const key of required) if (!process.env[key]) throw new Error(`${key} belum diatur.`);
  if (process.env.ADMIN_PASSWORD.length < 14) throw new Error("ADMIN_PASSWORD minimal 14 karakter.");
  if (!/^[a-fA-F0-9]{64}$/.test(process.env.SESSION_SECRET)) throw new Error("SESSION_SECRET harus 64 karakter hex.");
  if (!/^[a-fA-F0-9]{64}$/.test(process.env.TOKEN_ENCRYPTION_KEY)) throw new Error("TOKEN_ENCRYPTION_KEY harus 64 karakter hex.");
  return {
    owner: process.env.GITHUB_OWNER,
    repo: process.env.GITHUB_REPO,
    branch: process.env.GITHUB_BRANCH || "main",
    path: process.env.GITHUB_DATA_PATH || "data/bots.enc.json"
  };
}
function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function sign(payload) {
  return crypto.createHmac("sha256", process.env.SESSION_SECRET).update(payload).digest("base64url");
}
function makeSession() {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + 8 * 60 * 60 * 1000, nonce: crypto.randomBytes(16).toString("hex") })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}
function validSession(req) {
  const raw = req.cookies[COOKIE];
  if (typeof raw !== "string") return false;
  const parts = raw.split(".");
  if (parts.length !== 2 || !safeEqual(sign(parts[0]), parts[1])) return false;
  try { return JSON.parse(Buffer.from(parts[0], "base64url").toString()).exp > Date.now(); } catch { return false; }
}
function requireAuth(req, res, next) {
  try { config(); if (!validSession(req)) return res.status(401).json({ error: "Sesi berakhir. Silakan login kembali." }); next(); }
  catch (e) { res.status(500).json({ error: "Konfigurasi server belum lengkap: " + e.message }); }
}
function sameOrigin(req, res, next) {
  const origin = req.get("origin"), host = req.get("x-forwarded-host") || req.get("host");
  if (origin) { try { if (new URL(origin).host !== host) return res.status(403).json({ error: "Origin tidak diizinkan." }); } catch { return res.status(403).json({ error: "Origin tidak valid." }); } }
  next();
}
app.use("/api", sameOrigin);

function encryptToken(token) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", Buffer.from(process.env.TOKEN_ENCRYPTION_KEY, "hex"), iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return { iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: encrypted.toString("base64") };
}
function decryptToken(item) {
  const decipher = crypto.createDecipheriv("aes-256-gcm", Buffer.from(process.env.TOKEN_ENCRYPTION_KEY, "hex"), Buffer.from(item.iv, "base64"));
  decipher.setAuthTag(Buffer.from(item.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(item.data, "base64")), decipher.final()]).toString("utf8");
}
function githubHeaders() {
  return { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" };
}
async function readStore() {
  const c = config();
  const url = `https://api.github.com/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/contents/${c.path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(c.branch)}`;
  const response = await fetch(url, { headers: githubHeaders(), signal: AbortSignal.timeout(12000) });
  if (response.status === 404) return { bots: [], sha: null };
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || `GitHub read error ${response.status}`);
  const raw = Buffer.from(data.content.replace(/\n/g, ""), "base64").toString("utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed.bots)) throw new Error("Format file penyimpanan tidak valid.");
  return { bots: parsed.bots, sha: data.sha };
}
async function writeStore(bots, sha) {
  const c = config();
  const url = `https://api.github.com/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/contents/${c.path.split("/").map(encodeURIComponent).join("/")}`;
  const body = {
    message: "Update encrypted Telegram bot store",
    content: Buffer.from(JSON.stringify({ version: 1, bots }, null, 2)).toString("base64"),
    branch: c.branch
  };
  if (sha) body.sha = sha;
  const response = await fetch(url, { method: "PUT", headers: githubHeaders(), body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || `GitHub write error ${response.status}`);
}
async function telegram(token, method, body) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}), signal: AbortSignal.timeout(12000)
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) throw new Error(data?.description || `Telegram API error ${response.status}`);
  return data.result;
}
function tokenLooksValid(token) { return /^\d+:[A-Za-z0-9_-]{20,}$/.test(token); }

app.get("/api/health", async (_req, res) => {
  try { config(); await readStore(); res.json({ ok: true, configured: true, storage: "github-private-repository" }); }
  catch (e) { res.status(500).json({ ok: false, configured: false, error: e.message.slice(0, 180) }); }
});
app.post("/api/auth/login", (req, res) => {
  try {
    config();
    if (typeof req.body?.password !== "string" || !safeEqual(req.body.password, process.env.ADMIN_PASSWORD)) return res.status(401).json({ error: "Password admin salah." });
    res.cookie(COOKIE, makeSession(), COOKIE_OPTIONS);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get("/api/auth/me", requireAuth, (_req, res) => res.json({ authenticated: true }));
app.post("/api/auth/logout", (_req, res) => { res.clearCookie(COOKIE, { httpOnly: true, secure: true, sameSite: "strict", path: "/" }); res.json({ ok: true }); });

app.get("/api/bots", requireAuth, async (_req, res) => {
  try {
    const store = await readStore();
    const bots = await Promise.all(store.bots.map(async (item, index) => {
      try {
        const token = decryptToken(item);
        const me = await telegram(token, "getMe", {});
        return { id: item.id, owner: item.owner, username: me.username || "", telegramId: String(me.id), firstName: me.first_name || "", valid: true };
      } catch { return { id: item.id, owner: item.owner, username: "", telegramId: "", firstName: "", valid: false }; }
    }));
    res.json({ bots });
  } catch (e) { res.status(500).json({ error: e.message.slice(0, 180) }); }
});
app.post("/api/bots", requireAuth, async (req, res) => {
  const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
  const owner = typeof req.body?.owner === "string" ? req.body.owner.trim() : "";
  if (!owner || owner.length > 60 || !tokenLooksValid(token)) return res.status(400).json({ error: "Isi Nama Owner dan token Telegram yang valid." });
  try {
    const me = await telegram(token, "getMe", {});
    const store = await readStore();
    if (store.bots.some(item => item.telegramId === String(me.id))) return res.status(409).json({ error: "Bot ini sudah terdaftar." });
    store.bots.push({ id: crypto.randomUUID(), owner, telegramId: String(me.id), username: me.username || "", ...encryptToken(token), createdAt: new Date().toISOString() });
    await writeStore(store.bots, store.sha);
    res.json({ ok: true, bot: { owner, username: me.username || "", telegramId: String(me.id) } });
  } catch (e) { res.status(400).json({ error: e.message.slice(0, 180) }); }
});
app.delete("/api/bots/:id", requireAuth, async (req, res) => {
  try {
    const store = await readStore();
    const next = store.bots.filter(item => item.id !== req.params.id);
    if (next.length === store.bots.length) return res.status(404).json({ error: "Bot tidak ditemukan." });
    await writeStore(next, store.sha);
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message.slice(0, 180) }); }
});
app.post("/api/send", requireAuth, async (req, res) => {
  const id = typeof req.body?.botId === "string" ? req.body.botId : "";
  const chatId = typeof req.body?.chatId === "string" ? req.body.chatId.trim() : "";
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  if (!id || !chatId || !text || text.length > 4000 || chatId.length > 80) return res.status(400).json({ error: "Pilih bot, isi Chat ID, dan pesan (maksimal 4000 karakter)." });
  try {
    const store = await readStore();
    const item = store.bots.find(bot => bot.id === id);
    if (!item) return res.status(404).json({ error: "Bot tidak ditemukan." });
    const result = await telegram(decryptToken(item), "sendMessage", { chat_id: chatId, text });
    res.json({ ok: true, messageId: result.message_id });
  } catch (e) { res.status(400).json({ error: e.message.slice(0, 180) }); }
});

app.use((error, _req, res, _next) => { console.error("API error:", error?.message || error); res.status(500).json({ error: "Kesalahan server internal." }); });
module.exports = app;
