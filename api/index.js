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
  const required = ["ADMIN_PASSWORD", "SESSION_SECRET", "DATABASE_GITHUB_TOKEN", "DATABASE_GITHUB_OWNER", "DATABASE_GITHUB_REPO"];
  for (const key of required) if (!process.env[key]) throw new Error(`${key} belum diatur.`);
  if (process.env.ADMIN_PASSWORD.length < 14) throw new Error("ADMIN_PASSWORD minimal 14 karakter.");
  if (!/^[a-fA-F0-9]{64}$/.test(process.env.SESSION_SECRET)) throw new Error("SESSION_SECRET harus 64 karakter hex.");
  return { owner: process.env.DATABASE_GITHUB_OWNER, repo: process.env.DATABASE_GITHUB_REPO, branch: process.env.DATABASE_GITHUB_BRANCH || "main", path: process.env.DATABASE_GITHUB_PATH || "database.json" };
}
function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function sign(payload) { return crypto.createHmac("sha256", process.env.SESSION_SECRET).update(payload).digest("base64url"); }
function makeSession(user) {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + 8 * 60 * 60 * 1000, nonce: crypto.randomBytes(16).toString("hex"), username: user.username, role: user.role })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}
function sessionUser(req) {
  const raw = req.cookies[COOKIE];
  if (typeof raw !== "string") return null;
  const parts = raw.split(".");
  if (parts.length !== 2 || !safeEqual(sign(parts[0]), parts[1])) return null;
  try { const user = JSON.parse(Buffer.from(parts[0], "base64url").toString()); return user.exp > Date.now() && ["owner", "member"].includes(user.role) ? user : null; } catch { return null; }
}
function requireAuth(req, res, next) {
  try { config(); req.user = sessionUser(req); if (!req.user) return res.status(401).json({ error: "Sesi berakhir. Silakan login kembali." }); next(); }
  catch (e) { res.status(500).json({ error: "Konfigurasi server belum lengkap: " + e.message }); }
}
function requireOwner(req, res, next) { if (req.user?.role !== "owner") return res.status(403).json({ error: "Akses khusus OWNER." }); next(); }
function sameOrigin(req, res, next) {
  const origin = req.get("origin"), host = req.get("x-forwarded-host") || req.get("host");
  if (origin) { try { if (new URL(origin).host !== host) return res.status(403).json({ error: "Origin tidak diizinkan." }); } catch { return res.status(403).json({ error: "Origin tidak valid." }); } }
  next();
}
app.use("/api", sameOrigin);
function githubHeaders() { return { Authorization: `Bearer ${process.env.DATABASE_GITHUB_TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" }; }
async function readStore() {
  const c = config();
  const url = `https://api.github.com/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/contents/${c.path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(c.branch)}`;
  const response = await fetch(url, { headers: githubHeaders(), signal: AbortSignal.timeout(12000) });
  if (response.status === 404) return { tokenBot: {}, users: {}, sha: null };
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || `GitHub read error ${response.status}`);
  if (!data.content) throw new Error("File database.json kosong atau tidak dapat dibaca.");
  const parsed = JSON.parse(Buffer.from(data.content.replace(/\n/g, ""), "base64").toString("utf8"));
  if (!parsed.tokenBot || typeof parsed.tokenBot !== "object" || Array.isArray(parsed.tokenBot)) throw new Error("Format database.json harus memiliki object tokenBot.");
  const users = parsed.users && typeof parsed.users === "object" && !Array.isArray(parsed.users) ? parsed.users : {};
  return { tokenBot: parsed.tokenBot, users, sha: data.sha };
}
async function writeStore(tokenBot, users, sha) {
  const c = config();
  const url = `https://api.github.com/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/contents/${c.path.split("/").map(encodeURIComponent).join("/")}`;
  const body = { message: "Update Telegram token database", content: Buffer.from(JSON.stringify({ tokenBot, users }, null, 2)).toString("base64"), branch: c.branch };
  if (sha) body.sha = sha;
  const response = await fetch(url, { method: "PUT", headers: githubHeaders(), body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || `GitHub write error ${response.status}`);
}
function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) { return { salt, hash: crypto.scryptSync(password, salt, 64).toString("hex") }; }
function verifyPassword(password, record) {
  if (!record || typeof record.salt !== "string" || typeof record.hash !== "string") return false;
  return safeEqual(crypto.scryptSync(password, record.salt, 64).toString("hex"), record.hash);
}
async function telegram(token, method, body) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}), signal: AbortSignal.timeout(12000) });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) throw new Error(data?.description || `Telegram API error ${response.status}`);
  return data.result;
}
function tokenLooksValid(token) { return /^\d+:[A-Za-z0-9_-]{20,}$/.test(token); }
app.get("/api/health", async (_req, res) => {
  try { config(); await readStore(); res.json({ ok: true, configured: true, storage: "dedicated-github-json" }); }
  catch (e) { res.status(500).json({ ok: false, configured: false, error: e.message.slice(0, 180) }); }
});
app.post("/api/auth/login", async (req, res) => {
  try {
    config();
    const username = typeof req.body?.username === "string" ? req.body.username.trim() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!username || !password) return res.status(400).json({ error: "Isi username dan password." });
    let user = null;
    if (username.toLowerCase() === "owner" && safeEqual(password, process.env.ADMIN_PASSWORD)) user = { username: "owner", role: "owner" };
    else {
      const store = await readStore();
      const record = store.users[username];
      if (record && verifyPassword(password, record)) user = { username, role: "member" };
    }
    if (!user) return res.status(401).json({ error: "Username atau password salah." });
    res.cookie(COOKIE, makeSession(user), COOKIE_OPTIONS);
    res.json({ ok: true, user });
  } catch (e) { res.status(500).json({ error: e.message.slice(0, 180) }); }
});
app.get("/api/auth/me", requireAuth, (req, res) => res.json({ authenticated: true, user: { username: req.user.username, role: req.user.role } }));
app.post("/api/auth/logout", (_req, res) => { res.clearCookie(COOKIE, { httpOnly: true, secure: true, sameSite: "strict", path: "/" }); res.json({ ok: true }); });
app.get("/api/bots", requireAuth, requireOwner, async (_req, res) => {
  try {
    const store = await readStore();
    const bots = await Promise.all(Object.entries(store.tokenBot).map(async ([owner, token]) => {
      try { const me = await telegram(token, "getMe", {}); return { id: owner, owner, username: me.username || "", telegramId: String(me.id), firstName: me.first_name || "", valid: true }; }
      catch { return { id: owner, owner, username: "", telegramId: "", firstName: "", valid: false }; }
    }));
    res.json({ bots });
  } catch (e) { res.status(500).json({ error: e.message.slice(0, 180) }); }
});
app.post("/api/bots", requireAuth, async (req, res) => {
  const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
  const owner = typeof req.body?.owner === "string" ? req.body.owner.trim() : "";
  if (!owner || owner.length > 60 || !tokenLooksValid(token)) return res.status(400).json({ error: "Isi Nama Owner dan token Telegram yang valid." });
  try {
    const me = await telegram(token, "getMe", {}), store = await readStore();
    if (Object.prototype.hasOwnProperty.call(store.tokenBot, owner)) return res.status(409).json({ error: "Nama owner sudah ada. Gunakan nama lain." });
    if (Object.values(store.tokenBot).includes(token)) return res.status(409).json({ error: "Token bot ini sudah terdaftar." });
    store.tokenBot[owner] = token;
    await writeStore(store.tokenBot, store.users, store.sha);
    res.json({ ok: true, bot: { owner, username: me.username || "", telegramId: String(me.id) } });
  } catch (e) { res.status(400).json({ error: e.message.slice(0, 180) }); }
});
app.delete("/api/bots/:id", requireAuth, requireOwner, async (req, res) => {
  try {
    const store = await readStore();
    if (!Object.prototype.hasOwnProperty.call(store.tokenBot, req.params.id)) return res.status(404).json({ error: "Owner tidak ditemukan." });
    delete store.tokenBot[req.params.id]; await writeStore(store.tokenBot, store.users, store.sha); res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message.slice(0, 180) }); }
});
app.post("/api/send", requireAuth, requireOwner, async (req, res) => {
  const owner = typeof req.body?.botId === "string" ? req.body.botId : "", chatId = typeof req.body?.chatId === "string" ? req.body.chatId.trim() : "", text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  if (!owner || !chatId || !text || text.length > 4000 || chatId.length > 80) return res.status(400).json({ error: "Pilih bot, isi Chat ID, dan pesan (maksimal 4000 karakter)." });
  try {
    const store = await readStore(), token = store.tokenBot[owner];
    if (!token) return res.status(404).json({ error: "Bot tidak ditemukan." });
    const result = await telegram(token, "sendMessage", { chat_id: chatId, text }); res.json({ ok: true, messageId: result.message_id });
  } catch (e) { res.status(400).json({ error: e.message.slice(0, 180) }); }
});
app.get("/api/users", requireAuth, requireOwner, async (_req, res) => {
  try { const store = await readStore(); res.json({ users: Object.keys(store.users).map(username => ({ username, role: "member" })) }); }
  catch (e) { res.status(500).json({ error: e.message.slice(0, 180) }); }
});
app.post("/api/users", requireAuth, requireOwner, async (req, res) => {
  const username = typeof req.body?.username === "string" ? req.body.username.trim() : "", password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!/^[A-Za-z0-9_-]{3,32}$/.test(username) || username.toLowerCase() === "owner") return res.status(400).json({ error: "Username 3-32 karakter: huruf, angka, _ atau -." });
  if (password.length < 10 || password.length > 128) return res.status(400).json({ error: "Password member minimal 10 karakter." });
  try {
    const store = await readStore();
    if (Object.keys(store.users).some(name => name.toLowerCase() === username.toLowerCase())) return res.status(409).json({ error: "Username sudah digunakan." });
    store.users[username] = hashPassword(password); await writeStore(store.tokenBot, store.users, store.sha);
    res.json({ ok: true, user: { username, role: "member" } });
  } catch (e) { res.status(400).json({ error: e.message.slice(0, 180) }); }
});
app.delete("/api/users/:username", requireAuth, requireOwner, async (req, res) => {
  try {
    const store = await readStore();
    if (!Object.prototype.hasOwnProperty.call(store.users, req.params.username)) return res.status(404).json({ error: "Member tidak ditemukan." });
    delete store.users[req.params.username]; await writeStore(store.tokenBot, store.users, store.sha); res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message.slice(0, 180) }); }
});
app.use((error, _req, res, _next) => { console.error("API error:", error?.message || error); res.status(500).json({ error: "Kesalahan server internal." }); });
module.exports = app;
