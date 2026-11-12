"use strict";
const express = require("express");
const cookieParser = require("cookie-parser");
const crypto = require("node:crypto");
const { MongoClient, ObjectId } = require("mongodb");

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "16kb" }));
app.use(cookieParser());

const COOKIE = "ttm_session";
const COOKIE_OPTIONS = { httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge: 28800000 };
let mongoClientPromise;

function validateConfig() {
  for (const key of ["ADMIN_PASSWORD", "SESSION_SECRET", "ENCRYPTION_KEY", "MONGODB_URI", "MONGODB_DB"]) {
    if (!process.env[key]) throw new Error(`Missing ${key}`);
  }
  if (process.env.ADMIN_PASSWORD.length < 14) throw new Error("ADMIN_PASSWORD too short");
  for (const key of ["SESSION_SECRET", "ENCRYPTION_KEY"]) {
    if (!/^[a-fA-F0-9]{64}$/.test(process.env[key])) throw new Error(`${key} must be 64 hex characters`);
  }
}
async function getDb() {
  validateConfig();
  if (!mongoClientPromise) {
    const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000, connectTimeoutMS: 8000, maxPoolSize: 5 });
    mongoClientPromise = client.connect().catch(error => { mongoClientPromise = null; throw error; });
  }
  const client = await mongoClientPromise;
  const db = client.db(process.env.MONGODB_DB);
  await db.collection("bots").createIndex({ createdAt: -1 });
  return db;
}
function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function sign(payload) {
  return crypto.createHmac("sha256", process.env.SESSION_SECRET).update(payload).digest("base64url");
}
function newSession() {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + 28800000, nonce: crypto.randomBytes(16).toString("hex") })).toString("base64url");
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
  try {
    validateConfig();
    if (!validSession(req)) return res.status(401).json({ error: "Sesi berakhir. Silakan login kembali." });
    next();
  } catch { res.status(500).json({ error: "Konfigurasi server belum lengkap." }); }
}
function encryptToken(token) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", Buffer.from(process.env.ENCRYPTION_KEY, "hex"), iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return { encryptedToken: encrypted.toString("base64"), iv: iv.toString("base64"), authTag: cipher.getAuthTag().toString("base64") };
}
function decryptToken(row) {
  const decipher = crypto.createDecipheriv("aes-256-gcm", Buffer.from(process.env.ENCRYPTION_KEY, "hex"), Buffer.from(row.iv, "base64"));
  decipher.setAuthTag(Buffer.from(row.authTag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(row.encryptedToken, "base64")), decipher.final()]).toString("utf8");
}
async function telegram(token, method, body) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}),
    signal: AbortSignal.timeout(12000)
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) throw new Error(data?.description || `Telegram API error ${response.status}`);
  return data.result;
}
function telegramError(error) {
  const m = String(error.message || "");
  if (/unauthorized|invalid token/i.test(m)) return "Telegram menolak token. Periksa token dari BotFather.";
  if (/blocked|chat not found|forbidden/i.test(m)) return "Bot tidak dapat mengirim ke chat tersebut. Periksa chat ID dan izin bot.";
  if (/timeout|fetch failed|network/i.test(m)) return "Koneksi ke Telegram gagal. Coba lagi.";
  return m.slice(0, 150) || "Telegram API request gagal.";
}
function sameOrigin(req, res, next) {
  const origin = req.get("origin"), host = req.get("x-forwarded-host") || req.get("host");
  if (origin) {
    try { if (new URL(origin).host !== host) return res.status(403).json({ error: "Origin tidak diizinkan." }); }
    catch { return res.status(403).json({ error: "Origin tidak valid." }); }
  }
  next();
}
app.use("/api", sameOrigin);

app.get("/api/health", async (_req, res) => {
  try { const db = await getDb(); await db.command({ ping: 1 }); res.json({ ok: true, database: "connected" }); }
  catch { res.status(500).json({ ok: false, error: "Server/database belum dikonfigurasi atau tidak dapat dijangkau." }); }
});
app.post("/api/auth/login", (req, res) => {
  try {
    validateConfig();
    if (typeof req.body?.password !== "string" || !safeEqual(req.body.password, process.env.ADMIN_PASSWORD))
      return res.status(401).json({ error: "Password admin salah." });
    res.cookie(COOKIE, newSession(), COOKIE_OPTIONS);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: "Konfigurasi server belum lengkap." }); }
});
app.get("/api/auth/me", requireAuth, (_req, res) => res.json({ authenticated: true }));
app.post("/api/auth/logout", (_req, res) => {
  res.clearCookie(COOKIE, { httpOnly: true, secure: true, sameSite: "strict", path: "/" });
  res.json({ ok: true });
});
app.get("/api/bots", requireAuth, async (_req, res) => {
  try {
    const rows = await (await getDb()).collection("bots")
      .find({}, { projection: { label: 1, telegramId: 1, username: 1, firstName: 1, createdAt: 1 } })
      .sort({ createdAt: -1 }).limit(200).toArray();
    res.json({ bots: rows.map(r => ({
      id: r._id.toString(), label: r.label, telegram_id: r.telegramId,
      username: r.username, first_name: r.firstName, created_at: r.createdAt, valid: true
    })) });
  } catch { res.status(500).json({ error: "Gagal membaca database MongoDB." }); }
});
app.post("/api/bots", requireAuth, async (req, res) => {
  const label = typeof req.body?.label === "string" ? req.body.label.trim().slice(0, 60) : "";
  const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
  if (!label || !token || token.length > 256 || !/^\d+:[A-Za-z0-9_-]+$/.test(token))
    return res.status(400).json({ error: "Label dan format token Telegram wajib valid." });
  try {
    const me = await telegram(token, "getMe", {});
    if (!me.is_bot) return res.status(400).json({ error: "Akun Telegram tersebut bukan bot." });
    const encrypted = encryptToken(token);
    const doc = {
      label, telegramId: String(me.id), username: me.username || "", firstName: me.first_name || "",
      ...encrypted, createdAt: new Date()
    };
    const result = await (await getDb()).collection("bots").insertOne(doc);
    res.status(201).json({ ok: true, bot: {
      id: result.insertedId.toString(), label, telegram_id: String(me.id),
      username: me.username || "", first_name: me.first_name || ""
    } });
  } catch (error) { res.status(400).json({ error: telegramError(error) }); }
});
app.delete("/api/bots/:id", requireAuth, async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: "ID bot tidak valid." });
  try {
    const result = await (await getDb()).collection("bots").deleteOne({ _id: new ObjectId(req.params.id) });
    if (!result.deletedCount) return res.status(404).json({ error: "Bot tidak ditemukan." });
    res.json({ ok: true });
  } catch { res.status(500).json({ error: "Gagal menghapus bot." }); }
});
app.post("/api/send", requireAuth, async (req, res) => {
  const botId = typeof req.body?.botId === "string" ? req.body.botId : "";
  const chatId = typeof req.body?.chatId === "string" ? req.body.chatId.trim() : "";
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  if (!ObjectId.isValid(botId) || !chatId || !text || text.length > 4000 || chatId.length > 80)
    return res.status(400).json({ error: "Bot, chat ID, dan pesan wajib diisi. Maksimal 4000 karakter." });
  try {
    const record = await (await getDb()).collection("bots").findOne({ _id: new ObjectId(botId) });
    if (!record) return res.status(404).json({ error: "Bot tidak ditemukan." });
    const result = await telegram(decryptToken(record), "sendMessage", { chat_id: chatId, text });
    res.json({ ok: true, messageId: result.message_id });
  } catch (error) { res.status(400).json({ error: telegramError(error) }); }
});
app.use((error, _req, res, _next) => {
  console.error("API error:", error?.message || error);
  res.status(500).json({ error: "Kesalahan server internal." });
});
module.exports = app;
