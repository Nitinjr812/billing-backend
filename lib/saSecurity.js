// backend/lib/saSecurity.js
// Super-admin security: sessions (IP/device), suspicious-login detection, force logout, audit log.
// Self-contained: login ya superadmin.js me koi change nahi chahiye — saTracker middleware sab handle karta hai.
const crypto = require("crypto");
const mongoose = require("mongoose");
const { Schema } = mongoose;

const SESSION_DAYS = Number(process.env.SA_SESSION_DAYS) || 7;
const model = (name, schema) => mongoose.models[name] || mongoose.model(name, schema);

/* ── MODELS ─────────────────────────────────────────── */
const sessionSchema = new Schema(
  {
    adminEmail: { type: String, index: true },
    tokenHash: { type: String, unique: true, sparse: true },
    ip: String,
    userAgent: String,
    device: String,
    lastActiveAt: { type: Date, default: Date.now },
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
  ip: String,
  success: Boolean,
  createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 30 },
}));

const SaAlert = model("SaAlert", new Schema(
  {
    type: { type: String, default: "suspicious_login" },
    severity: { type: String, enum: ["medium", "high"], default: "medium" },
    adminEmail: String,
    ip: String,
    device: String,
    reasons: [String],
    sessionId: String,
    dismissed: { type: Boolean, default: false },
  },
  { timestamps: true }
));

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

async function recordFailedLogin(req, email) {
  try {
    await SaLoginAttempt.create({ email: String(email || "unknown").toLowerCase(), ip: getIp(req), success: false });
  } catch (e) { console.error("recordFailedLogin:", e.message); }
}

/** Audit entry — kabhi throw nahi karta. */
async function logAudit(req, action, { targetType, targetId, targetName, meta } = {}, actorOverride) {
  try {
    await SaAudit.create({
      actor: actorOverride || req.admin?.email || req.saEmail || "superadmin",
      action, targetType, targetId, targetName, meta, ip: getIp(req),
    });
  } catch (e) { console.error("logAudit:", e.message); }
}

/** Naya token dikhne par session banao + suspicious check. Parallel requests se duplicate nahi banta. */
async function registerSession(req, token) {
  const th = hashToken(token);
  const email = req.admin?.email ? String(req.admin.email).toLowerCase() : decodeEmail(token);
  const ip = getIp(req);
  const userAgent = req.headers["user-agent"] || "";
  const device = parseDevice(userAgent);
  const now = new Date();

  const existing = await SaSession.findOne({ tokenHash: th }).select("_id");
  if (existing) return String(existing._id);

  const [past, failed, active] = await Promise.all([
    SaSession.find({ adminEmail: email }).select("ip device").lean(),
    SaLoginAttempt.countDocuments({ createdAt: { $gte: new Date(now - 15 * 60000) }, success: false }),
    SaSession.find({ adminEmail: email, revoked: false, expiresAt: { $gt: now } }).select("ip").lean(),
  ]);

  const reasons = [];
  if (past.length > 0) {
    if (!past.some((s) => s.ip === ip)) reasons.push("New IP address");
    if (!past.some((s) => s.device === device)) reasons.push("New device / browser");
  }
  if (failed >= 3) reasons.push(`${failed} failed login attempts in last 15 min`);
  if (active.some((s) => s.ip !== ip)) reasons.push("Already logged in from another IP");
  const suspicious = reasons.length > 0;

  let session;
  try {
    session = await SaSession.create({
      adminEmail: email, tokenHash: th, ip, userAgent, device, suspicious, reasons,
      expiresAt: new Date(now.getTime() + SESSION_DAYS * 86400000),
    });
  } catch (e) {
    if (e.code === 11000) {
      const s = await SaSession.findOne({ tokenHash: th }).select("_id");
      return s ? String(s._id) : null;
    }
    throw e;
  }

  await SaLoginAttempt.create({ email, ip, success: true }).catch(() => {});
  if (suspicious) {
    await SaAlert.create({
      adminEmail: email, ip, device, reasons, sessionId: String(session._id),
      severity: failed >= 3 || reasons.includes("Already logged in from another IP") ? "high" : "medium",
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

/** Mount: app.use("/api/sa-x7k9q2", saTracker) — superAdminRouter se PEHLE. */
async function saTracker(req, res, next) {
  try {
    if (req.method === "OPTIONS" || req.path.startsWith("/security")) return next();

    const isLogin = req.method === "POST" && /login/i.test(req.path);
    if (isLogin) {
      res.on("finish", () => {
        const email = req.body?.email || req.body?.username;
        if ([400, 401, 403].includes(res.statusCode)) recordFailedLogin(req, email);
        else if (res.statusCode < 400) logAudit(req, "login", {}, String(email || "superadmin").toLowerCase());
      });
      return next();
    }

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
  SaSession, SaAlert, SaAudit, SaLoginAttempt,
  getIp, parseDevice, getToken, hashToken, registerSession, recordFailedLogin, logAudit, saTracker,
};