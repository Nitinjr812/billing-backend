// backend/routes/saSecurity.js
// Mount: app.use("/api/sa-x7k9q2/security", require("./routes/saSecurity")(requireSuperAdmin));
const express = require("express");
const mongoose = require("mongoose");
const { SaSession, SaAlert, SaAudit, logAudit } = require("../lib/saSecurity");

const STATES = { 0: "disconnected", 1: "connected", 2: "connecting", 3: "disconnecting" };

module.exports = function saSecurityRouter(requireSuperAdmin) {
  const r = express.Router();
  r.use(requireSuperAdmin); // ye middleware touchSession() bhi chalana chahiye (neeche instructions)

  /* ── DATABASE STATUS ── */
  r.get("/db-status", async (req, res) => {
    const conn = mongoose.connection;
    const state = STATES[conn.readyState] || "unknown";
    const out = {
      state,
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
    const now = new Date();
    const list = await SaSession.find({ revoked: false, expiresAt: { $gt: now } })
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