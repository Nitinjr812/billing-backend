// backend/routes/saSecurity.js
// Mount: app.use("/api/sa-x7k9q2/security", require("./routes/saSecurity")(requireSuperAdmin /* optional */));
const express = require("express");
const mongoose = require("mongoose");
const {
  SaSession, SaAlert, SaAudit, logAudit, getToken, hashToken, registerSession,
} = require("../lib/saSecurity");

const STATES = { 0: "disconnected", 1: "connected", 2: "connecting", 3: "disconnecting" };

// Built-in auth: JWT verify. Secret env me jo bhi set ho wo try hota hai.
function builtInGuard() {
  let jwt;
  try { jwt = require("jsonwebtoken"); } catch { jwt = null; }
  const secrets = [process.env.SA_JWT_SECRET, process.env.SUPERADMIN_JWT_SECRET, process.env.JWT_SECRET].filter(Boolean);
  return (req, res, next) => {
    const token = getToken(req);
    if (!token) return res.status(401).json({ error: "Unauthorized" });
    if (!jwt || secrets.length === 0) {
      return res.status(500).json({ error: "Server me JWT secret env nahi mila (JWT_SECRET / SA_JWT_SECRET) ya jsonwebtoken install nahi hai" });
    }
    for (const s of secrets) {
      try {
        const payload = jwt.verify(token, s);
        req.admin = req.admin || { email: payload.email || payload.username || "superadmin" };
        return next();
      } catch { /* next secret */ }
    }
    return res.status(401).json({ error: "Unauthorized" });
  };
}

module.exports = function saSecurityRouter(requireSuperAdmin) {
  const r = express.Router();

  r.use(typeof requireSuperAdmin === "function" ? requireSuperAdmin : builtInGuard());

  // Auth ke baad: session revoke check + (pehli request par) session register
  r.use(async (req, res, next) => {
    try {
      const token = getToken(req);
      if (!token) return next();
      const th = hashToken(token);
      let s = await SaSession.findOne({ tokenHash: th }).select("revoked expiresAt");
      if (s && (s.revoked || (s.expiresAt && s.expiresAt < new Date()))) {
        return res.status(401).json({ error: "Session revoked. Please log in again.", code: "SESSION_REVOKED" });
      }
      req.saSid = s ? String(s._id) : await registerSession(req, token);
    } catch (e) { console.error("saSecurity session:", e.message); }
    next();
  });

  /* ── DATABASE STATUS ── */
  r.get("/db-status", async (req, res) => {
    const conn = mongoose.connection;
    const out = {
      state: STATES[conn.readyState] || "unknown",
      host: conn.host || null,
      dbName: conn.name || null,
      latencyMs: null,
      stats: null,
      error: null,
      storageLimitMb: Number(process.env.DB_STORAGE_LIMIT_MB) || 512, // Atlas M0 = 512
      server: {
        uptimeSec: Math.round(process.uptime()),
        node: process.version,
        env: process.env.NODE_ENV || "development",
        serverless: !!process.env.VERCEL,
        region: process.env.VERCEL_REGION || null,
        memoryMb: Math.round(process.memoryUsage().rss / 1048576),
        cashfreeEnv: process.env.CASHFREE_ENV === "PRODUCTION" ? "PRODUCTION" : "SANDBOX",
      },
      checkedAt: new Date().toISOString(),
    };
    if (conn.readyState === 1) {
      try {
        const t0 = Date.now();
        await conn.db.admin().ping();
        out.latencyMs = Date.now() - t0;
        const s = await conn.db.stats();
        out.stats = {
          collections: s.collections, objects: s.objects, dataSize: s.dataSize,
          storageSize: s.storageSize, indexes: s.indexes, indexSize: s.indexSize,
        };
      } catch (e) { out.error = e.message; }
    }
    res.json(out);
  });

  /* ── SESSIONS ── */
  r.get("/sessions", async (req, res) => {
    const list = await SaSession.find({ revoked: false, expiresAt: { $gt: new Date() } })
      .sort({ lastActiveAt: -1 }).limit(100).lean();
    res.json(list.map((s) => ({
      _id: s._id, adminEmail: s.adminEmail, ip: s.ip, device: s.device,
      createdAt: s.createdAt, lastActiveAt: s.lastActiveAt,
      suspicious: s.suspicious, reasons: s.reasons || [],
      isCurrent: String(s._id) === req.saSid,
    })));
  });

  r.post("/sessions/revoke-others", async (req, res) => {
    const filter = { revoked: false };
    if (req.saSid) filter._id = { $ne: req.saSid };
    const result = await SaSession.updateMany(filter, {
      revoked: true, revokedAt: new Date(), revokedBy: req.admin?.email || "superadmin",
    });
    await logAudit(req, "sessions.revoke_others", { meta: { count: result.modifiedCount } });
    res.json({ ok: true, count: result.modifiedCount });
  });

  r.post("/sessions/:id/revoke", async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: "Invalid session id" });
    const s = await SaSession.findByIdAndUpdate(req.params.id, {
      revoked: true, revokedAt: new Date(), revokedBy: req.admin?.email || "superadmin",
    });
    if (!s) return res.status(404).json({ error: "Session not found" });
    await logAudit(req, "session.force_logout", { targetType: "session", targetId: String(s._id), targetName: `${s.ip} · ${s.device}` });
    res.json({ ok: true });
  });

  /* ── ALERTS ── */
  r.get("/alerts", async (req, res) => {
    res.json(await SaAlert.find({ dismissed: false }).sort({ createdAt: -1 }).limit(30).lean());
  });

  r.patch("/alerts/:id", async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: "Invalid alert id" });
    await SaAlert.findByIdAndUpdate(req.params.id, { dismissed: true });
    await logAudit(req, "alert.dismiss", { targetType: "alert", targetId: req.params.id });
    res.json({ ok: true });
  });

  /* ── AUDIT LOG ── */
  r.get("/audit", async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 200, 500);
    res.json(await SaAudit.find().sort({ createdAt: -1 }).limit(limit).lean());
  });

  return r;
};