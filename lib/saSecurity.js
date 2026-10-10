// backend/lib/saSecurity.js
// Super-admin security suite:
//  • Sessions with IP / device / location        • Risk score (0-100) + suspicious-login alerts
//  • Force logout (revoked token => 401)         • Brute-force lockout + auto IP block
//  • Manual IP blocklist                         • Login history + auto audit log
// Self-contained: login ya superadmin.js me koi change nahi chahiye — saTracker middleware sab handle karta hai.
const crypto = require("crypto");
const mongoose = require("mongoose");
const { Schema } = mongoose;

const SESSION_DAYS = Number(process.env.SA_SESSION_DAYS) || 7;
const WINDOW_MS = 15 * 60000; // failed-login window
const MAX_IP_FAILS = Number(process.env.SA_MAX_IP_FAILS) || 5; // itne fail ke baad login lock (15 min)
const MAX_EMAIL_FAILS = Number(process.env.SA_MAX_EMAIL_FAILS) || 8;
const AUTO_BLOCK_FAILS = Number(process.env.SA_AUTO_BLOCK_FAILS) || 15; // itne fail par IP 24h ke liye auto-block
const AUTO_BLOCK_HOURS = 24;
const SUSPICIOUS_SCORE = 25; // is score ya upar => suspicious

const model = (name, schema) => mongoose.models[name] || mongoose.model(name, schema);

/* ── MODELS ─────────────────────────────────────────── */
const sessionSchema = new Schema(
  {
    adminEmail: { type: String, index: true },
    tokenHash: { type: String, unique: true, sparse: true },
    ip: String,
    country: String,
    city: String,
    userAgent: String,
    device: String,
    lastActiveAt: { type: Date, default: Date.now },
    risk: { type: Number, default: 0 },
    riskLevel: { type: String, default: "low" },
    suspicious: { type: Boolean, default: false },
    reasons: [String],
    revoked: { type: Boolean, default: false },
    revokedAt: Date,
    revokedBy: String,
    expiresAt: Date,
  },
  { timestamps: true }
);
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });
const SaSession = model("SaSession", sessionSchema);

const SaLoginAttempt = model("SaLoginAttempt", new Schema({
  email: { type: String, index: true },
  ip: { type: String, index: true },
  country: String,
  city: String,
  device: String,
  success: Boolean,
  createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 30 },
}));

const SaAlert = model("SaAlert", new Schema(
  {
    type: { type: String, default: "suspicious_login" }, // suspicious_login | brute_force
    severity: { type: String, enum: ["medium", "high"], default: "medium" },
    risk: Number,
    adminEmail: String,
    ip: String,
    country: String,
    city: String,
    device: String,
    reasons: [String],
    sessionId: String,
    dismissed: { type: Boolean, default: false },
  },
  { timestamps: true }
));

const blockedSchema = new Schema(
  {
    ip: { type: String, unique: true, index: true },
    reason: String,
    blockedBy: String,
    auto: { type: Boolean, default: false },
    expiresAt: { type: Date, default: null }, // null = permanent
  },
  { timestamps: true }
);
blockedSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
const SaBlockedIp = model("SaBlockedIp", blockedSchema);

const SaAudit = model("SaAudit", new Schema({
  actor: String,
  action: { type: String, index: true },
  targetType: String,
  targetId: String,
  targetName: String,
  meta: Schema.Types.Mixed,
  ip: String,
  createdAt: { type: Date, default: Date.now, index: true, expires: 60 * 60 * 24 * 365 },
}));

/* ── HELPERS ────────────────────────────────────────── */
function getIp(req) {
  const raw =
    req.headers["x-vercel-forwarded-for"] ||
    req.headers["x-real-ip"] ||
    (req.headers["x-forwarded-for"] || "").split(",")[0] ||
    req.ip ||
    req.socket?.remoteAddress ||
    "unknown";
  return String(raw).trim().replace(/^::ffff:/, "");
}

// Vercel (ya Cloudflare) location headers deta hai — koi external API nahi chahiye.
function getGeo(req) {
  const dec = (v) => { try { return v ? decodeURIComponent(v) : ""; } catch { return v || ""; } };
  const country = req.headers["x-vercel-ip-country"] || req.headers["cf-ipcountry"] || "";
  const city = dec(req.headers["x-vercel-ip-city"]);
  return { country: String(country).toUpperCase(), city };
}

function parseDevice(ua = "") {
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome"
    : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Unknown browser";
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad|iOS/.test(ua) ? "iOS"
    : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "Unknown OS";
  return `${browser} on ${os}`;
}

function getToken(req) {
  const h = req.headers.authorization || "";
  if (/^Bearer\s+/i.test(h)) return h.replace(/^Bearer\s+/i, "").trim();
  return req.headers["x-auth-token"] || req.headers["x-access-token"] || null;
}

const hashToken = (tok) => crypto.createHash("sha256").update(String(tok)).digest("hex");

function decodeEmail(token) {
  try {
    const p = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
    return String(p.email || p.username || p.id || p.sub || "superadmin").toLowerCase();
  } catch { return "superadmin"; }
}

const activeBlockFilter = (ip) => ({ ip, $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] });

async function recordFailedLogin(req, email) {
  try {
    const geo = getGeo(req);
    await SaLoginAttempt.create({
      email: String(email || "unknown").toLowerCase(), ip: getIp(req), ...geo,
      device: parseDevice(req.headers["user-agent"] || ""), success: false,
    });
  } catch (e) { console.error("recordFailedLogin:", e.message); }
}

/** Audit entry — kabhi throw nahi karta. */
async function logAudit(req, action, { targetType, targetId, targetName, meta } = {}, actorOverride) {
  try {
    await SaAudit.create({
      actor: actorOverride || req.admin?.email || "superadmin",
      action, targetType, targetId, targetName, meta, ip: getIp(req),
    });
  } catch (e) { console.error("logAudit:", e.message); }
}

/** IP block karo + us IP ke saare sessions revoke. hours=0 => permanent. */
async function blockIp(ip, { reason, blockedBy, auto = false, hours = 0 } = {}) {
  await SaBlockedIp.findOneAndUpdate(
    { ip },
    { ip, reason, blockedBy, auto, expiresAt: hours ? new Date(Date.now() + hours * 3600000) : null },
    { upsert: true, new: true }
  );
  await SaSession.updateMany({ ip, revoked: false }, { revoked: true, revokedAt: new Date(), revokedBy: blockedBy || "auto-block" });
}

/** Naya token dikhne par session banao + risk score + suspicious alert. Parallel requests se duplicate nahi banta. */
async function registerSession(req, token) {
  const th = hashToken(token);
  const email = req.admin?.email ? String(req.admin.email).toLowerCase() : decodeEmail(token);
  const ip = getIp(req);
  const geo = getGeo(req);
  const userAgent = req.headers["user-agent"] || "";
  const device = parseDevice(userAgent);
  const now = new Date();

  const existing = await SaSession.findOne({ tokenHash: th }).select("_id");
  if (existing) return String(existing._id);

  const [past, failed, active] = await Promise.all([
    SaSession.find({ adminEmail: email }).select("ip device country").lean(),
    SaLoginAttempt.countDocuments({ success: false, createdAt: { $gte: new Date(now - WINDOW_MS) }, $or: [{ ip }, { email }] }),
    SaSession.find({ adminEmail: email, revoked: false, expiresAt: { $gt: now } }).select("ip").lean(),
  ]);

  const reasons = [];
  let score = 0;
  if (past.length > 0) {
    if (!past.some((s) => s.ip === ip)) { reasons.push("New IP address"); score += 25; }
    if (!past.some((s) => s.device === device)) { reasons.push("New device / browser"); score += 20; }
    if (geo.country && past.some((s) => s.country) && !past.some((s) => s.country === geo.country)) {
      reasons.push(`Login from new country (${geo.country})`); score += 40;
    }
  }
  if (failed >= 5) { reasons.push(`${failed} failed attempts before this login`); score += 35; }
  else if (failed >= 3) { reasons.push(`${failed} failed attempts before this login`); score += 25; }
  if (active.some((s) => s.ip !== ip)) { reasons.push("Already logged in from another IP"); score += 25; }

  score = Math.min(100, score);
  const riskLevel = score >= 60 ? "high" : score >= 30 ? "medium" : "low";
  const suspicious = score >= SUSPICIOUS_SCORE;

  let session;
  try {
    session = await SaSession.create({
      adminEmail: email, tokenHash: th, ip, country: geo.country, city: geo.city, userAgent, device,
      risk: score, riskLevel, suspicious, reasons,
      expiresAt: new Date(now.getTime() + SESSION_DAYS * 86400000),
    });
  } catch (e) {
    if (e.code === 11000) {
      const s = await SaSession.findOne({ tokenHash: th }).select("_id");
      return s ? String(s._id) : null;
    }
    throw e;
  }

  await SaLoginAttempt.create({ email, ip, ...geo, device, success: true }).catch(() => {});
  if (suspicious) {
    await SaAlert.create({
      type: "suspicious_login", adminEmail: email, ip, ...geo, device, reasons, risk: score,
      sessionId: String(session._id), severity: riskLevel === "high" ? "high" : "medium",
    });
  }
  return String(session._id);
}

/* ── AUTO AUDIT: request -> readable action ─────────── */
function describeAction(method, path, body = {}) {
  const p = path.replace(/\/+$/, "");
  let m;
  if (method === "PATCH" && (m = p.match(/^\/shops\/([^/]+)\/status$/)))
    return { action: body.status === "suspended" ? "shop.suspend" : "shop.activate", targetType: "shop", targetId: m[1], meta: { reason: body.reason } };
  if (method === "DELETE" && (m = p.match(/^\/shops\/([^/]+)$/))) return { action: "shop.delete", targetType: "shop", targetId: m[1] };
  if (method === "PATCH" && (m = p.match(/^\/verifications\/([^/]+)$/)))
    return { action: `verification.${body.decision || "decision"}`, targetType: "shop", targetId: m[1], meta: { reason: body.reason } };
  if (method === "PATCH" && (m = p.match(/^\/reports\/([^/]+)$/)))
    return { action: "report.update", targetType: "report", targetId: m[1], meta: { status: body.status } };
  if (method === "POST" && p === "/announcements")
    return { action: "announcement.send", targetType: "announcement", targetName: body.title, meta: { audience: body.audience, shops: body.shopIds?.length, people: body.userEmails?.length } };
  return { action: `${method.toLowerCase()} ${p || "/"}` };
}

/** Mount: app.use("/api/sa-x7k9q2", saTracker) — superAdminRouter aur security router se PEHLE. */
async function saTracker(req, res, next) {
  try {
    if (req.method === "OPTIONS") return next();
    const ip = getIp(req);

    // 1) Blocked IP — har request par rok do
    if (await SaBlockedIp.exists(activeBlockFilter(ip))) {
      return res.status(403).json({ error: "Aapke IP se access block hai. Admin se contact karo.", code: "IP_BLOCKED" });
    }

    if (req.path.startsWith("/security")) return next(); // security router apna session khud handle karta hai

    // 2) Login attempts — brute-force lockout
    if (req.method === "POST" && /login/i.test(req.path)) {
      const email = String(req.body?.email || req.body?.username || "").toLowerCase();
      const since = new Date(Date.now() - WINDOW_MS);
      const [byIp, byEmail] = await Promise.all([
        SaLoginAttempt.countDocuments({ ip, success: false, createdAt: { $gte: since } }),
        email ? SaLoginAttempt.countDocuments({ email, success: false, createdAt: { $gte: since } }) : 0,
      ]);

      if (byIp >= MAX_IP_FAILS || byEmail >= MAX_EMAIL_FAILS) {
        await recordFailedLogin(req, email); // attempts count badhta rahe => auto-block trigger ho sake
        if (byIp >= AUTO_BLOCK_FAILS) {
          await blockIp(ip, { reason: `Auto-blocked: ${byIp}+ failed logins`, blockedBy: "system", auto: true, hours: AUTO_BLOCK_HOURS });
          await logAudit(req, "ip.auto_block", { targetType: "ip", targetId: ip, meta: { fails: byIp } }, "system");
        }
        const dupe = await SaAlert.exists({ type: "brute_force", ip, dismissed: false, createdAt: { $gte: since } });
        if (!dupe) {
          await SaAlert.create({
            type: "brute_force", severity: "high", ip, ...getGeo(req), device: parseDevice(req.headers["user-agent"] || ""),
            adminEmail: email, risk: 90, reasons: [`${Math.max(byIp, byEmail)} failed logins in 15 min`, "Login temporarily locked"],
          });
        }
        return res.status(429).json({ error: "Bahut zyada galat attempts. 15 minute baad dobara try karo.", code: "LOGIN_LOCKED" });
      }

      res.on("finish", () => {
        if ([400, 401, 403].includes(res.statusCode)) recordFailedLogin(req, email);
        else if (res.statusCode < 400) logAudit(req, "login", {}, email || "superadmin");
      });
      return next();
    }

    // 3) Authenticated requests — session track + revoked check
    const token = getToken(req);
    if (!token) return next();

    const s = await SaSession.findOne({ tokenHash: hashToken(token) }).select("revoked expiresAt lastActiveAt");
    if (s && (s.revoked || (s.expiresAt && s.expiresAt < new Date()))) {
      return res.status(401).json({ error: "Session revoked. Please log in again.", code: "SESSION_REVOKED" });
    }
    if (s) {
      req.saSid = String(s._id);
      if (Date.now() - new Date(s.lastActiveAt).getTime() > 60000) {
        SaSession.updateOne({ _id: s._id }, { lastActiveAt: new Date() }).catch(() => {});
      }
    }

    res.on("finish", () => {
      if (res.statusCode >= 400) return; // failed/unauthorised request ka na session, na audit
      if (!s) registerSession(req, token).catch((e) => console.error("registerSession:", e.message));
      if (req.method !== "GET") {
        const d = describeAction(req.method, req.path, req.body);
        logAudit(req, d.action, d);
      }
    });
    next();
  } catch (e) {
    console.error("saTracker:", e.message);
    next(); // tracking fail hone par dashboard band nahi hona chahiye
  }
}

module.exports = {
  SaSession, SaAlert, SaAudit, SaLoginAttempt, SaBlockedIp,
  getIp, getGeo, parseDevice, getToken, hashToken, registerSession, recordFailedLogin,
  logAudit, blockIp, activeBlockFilter, saTracker,
};