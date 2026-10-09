// backend/lib/saSecurity.js
// Super-admin security: sessions, suspicious-login detection, audit log.
const mongoose = require("mongoose");
const { Schema } = mongoose;

const SESSION_DAYS = Number(process.env.SA_SESSION_DAYS) || 7; // JWT expiry ke barabar rakho
const model = (name, schema) => mongoose.models[name] || mongoose.model(name, schema);

/* ── MODELS ─────────────────────────────────────────── */
const sessionSchema = new Schema(
  {
    adminEmail: { type: String, index: true },
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
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 }); // 30 din baad auto-delete
const SaSession = model("SaSession", sessionSchema);

const attemptSchema = new Schema({
  email: { type: String, index: true },
  ip: String,
  success: Boolean,
  createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 30 },
});
const SaLoginAttempt = model("SaLoginAttempt", attemptSchema);

const alertSchema = new Schema(
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
);
const SaAlert = model("SaAlert", alertSchema);

const auditSchema = new Schema({
  actor: String,
  action: { type: String, index: true },
  targetType: String,
  targetId: String,
  targetName: String,
  meta: Schema.Types.Mixed,
  ip: String,
  createdAt: { type: Date, default: Date.now, index: true, expires: 60 * 60 * 24 * 365 }, // 1 saal
});
const SaAudit = model("SaAudit", auditSchema);

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

/** Login FAIL hone par call karo (wrong password etc.) */
async function recordFailedLogin(req, email) {
  try {
    await SaLoginAttempt.create({ email: String(email || "").toLowerCase(), ip: getIp(req), success: false });
  } catch (e) { console.error("recordFailedLogin:", e.message); }
}

/** Login SUCCESS par call karo. Returns { sid, suspicious, reasons } — sid ko JWT me daalo. */
async function createSession(req, adminEmail) {
  const email = String(adminEmail || "").toLowerCase();
  const ip = getIp(req);
  const userAgent = req.headers["user-agent"] || "";
  const device = parseDevice(userAgent);
  const now = new Date();

  const [past, failed, active] = await Promise.all([
    SaSession.find({ adminEmail: email }).select("ip device").lean(),
    SaLoginAttempt.countDocuments({ email, success: false, createdAt: { $gte: new Date(now - 15 * 60000) } }),
    SaSession.find({ adminEmail: email, revoked: false, expiresAt: { $gt: now } }).select("ip").lean(),
  ]);

  const reasons = [];
  if (past.length > 0) {
    if (!past.some((s) => s.ip === ip)) reasons.push("New IP address");
    if (!past.some((s) => s.device === device)) reasons.push("New device / browser");
  }
  if (failed >= 3) reasons.push(`${failed} failed attempts in last 15 min`);
  if (active.some((s) => s.ip !== ip)) reasons.push("Already logged in from another IP");

  const suspicious = reasons.length > 0;
  const session = await SaSession.create({
    adminEmail: email, ip, userAgent, device, suspicious, reasons,
    expiresAt: new Date(now.getTime() + SESSION_DAYS * 86400000),
  });
  await SaLoginAttempt.create({ email, ip, success: true });

  if (suspicious) {
    await SaAlert.create({
      adminEmail: email, ip, device, reasons, sessionId: String(session._id),
      severity: failed >= 3 || reasons.includes("Already logged in from another IP") ? "high" : "medium",
    });
  }
  await logAudit(req, "login", { meta: { suspicious, reasons } }, email);
  return { sid: String(session._id), suspicious, reasons };
}

/** Har authenticated request par call karo. false => 401 do (session revoked/expired). */
async function touchSession(req, sid) {
  if (!sid || !mongoose.isValidObjectId(sid)) return false;
  const s = await SaSession.findById(sid).select("revoked expiresAt lastActiveAt");
  if (!s || s.revoked || (s.expiresAt && s.expiresAt < new Date())) return false;
  if (Date.now() - new Date(s.lastActiveAt).getTime() > 60000) {
    SaSession.updateOne({ _id: sid }, { lastActiveAt: new Date() }).catch(() => {});
  }
  req.saSid = String(sid);
  return true;
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

module.exports = {
  SaSession, SaAlert, SaAudit, SaLoginAttempt,
  getIp, parseDevice, recordFailedLogin, createSession, touchSession, logAudit,
};