// backend/routes/saSecurity.js
// Mount: app.use("/api/sa-x7k9q2/security", require("./routes/saSecurity")(requireSuperAdmin /* optional */));
const express = require("express");
const mongoose = require("mongoose");
const {
  SaSession, SaAlert, SaAudit, SaLoginAttempt, SaBlockedIp,
  logAudit, getToken, getIp, hashToken, registerSession, blockIp,
} = require("../lib/saSecurity");

const STATES = { 0: "disconnected", 1: "connected", 2: "connecting", 3: "disconnecting" };
const IP_RE = /^[0-9a-fA-F:.]{3,45}$/;

// Built-in auth: JWT verify. Env me jo bhi secret set ho wo try hota hai.
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

const activeBlocks = () => ({ $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] });

module.exports = function saSecurityRouter(requireSuperAdmin) {
  const r = express.Router();

  r.use(typeof requireSuperAdmin === "function" ? requireSuperAdmin : builtInGuard());

  // Auth ke baad: session revoke check + (pehli request par) session register
  r.use(async (req, res, next) => {
    try {
      const token = getToken(req);
      if (!token) return next();
      const s = await SaSession.findOne({ tokenHash: hashToken(token) }).select("revoked expiresAt");
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

  /* ── SUMMARY (stat cards) ── */
  r.get("/summary", async (req, res) => {
    const now = new Date();
    const live = { revoked: false, expiresAt: { $gt: now } };
    const [activeSessions, suspiciousSessions, failed24h, blockedIps, openAlerts] = await Promise.all([
      SaSession.countDocuments(live),
      SaSession.countDocuments({ ...live, suspicious: true }),
      SaLoginAttempt.countDocuments({ success: false, createdAt: { $gte: new Date(now - 86400000) } }),
      SaBlockedIp.countDocuments(activeBlocks()),
      SaAlert.countDocuments({ dismissed: false }),
    ]);
    res.json({ activeSessions, suspiciousSessions, failed24h, blockedIps, openAlerts });
  });

  /* ── SESSIONS ── */
  r.get("/sessions", async (req, res) => {
    const list = await SaSession.find({ revoked: false, expiresAt: { $gt: new Date() } })
      .sort({ lastActiveAt: -1 }).limit(100).lean();
    res.json(list.map((s) => ({
      _id: s._id, adminEmail: s.adminEmail, ip: s.ip, country: s.country, city: s.city, device: s.device,
      createdAt: s.createdAt, lastActiveAt: s.lastActiveAt,
      risk: s.risk || 0, riskLevel: s.riskLevel || "low", suspicious: s.suspicious, reasons: s.reasons || [],
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

  /* ── LOGIN HISTORY ── */
  r.get("/logins", async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 30, 100);
    res.json(await SaLoginAttempt.find().sort({ createdAt: -1 }).limit(limit).lean());
  });

  /* ── BLOCKED IPs ── */
  r.get("/blocked-ips", async (req, res) => {
    res.json(await SaBlockedIp.find(activeBlocks()).sort({ createdAt: -1 }).limit(100).lean());
  });

  r.post("/blocked-ips", async (req, res) => {
    const ip = String(req.body?.ip || "").trim();
    if (!IP_RE.test(ip)) return res.status(400).json({ error: "Valid IP address daalo" });
    if (ip === getIp(req)) return res.status(400).json({ error: "Aap apna current IP block nahi kar sakte (khud lock ho jaoge)" });
    const reason = String(req.body?.reason || "Blocked from dashboard").slice(0, 200);
    await blockIp(ip, { reason, blockedBy: req.admin?.email || "superadmin" });
    await logAudit(req, "ip.block", { targetType: "ip", targetId: ip, meta: { reason } });
    res.json({ ok: true });
  });

  r.delete("/blocked-ips/:id", async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: "Invalid id" });
    const b = await SaBlockedIp.findByIdAndDelete(req.params.id);
    if (!b) return res.status(404).json({ error: "Not found" });
    await logAudit(req, "ip.unblock", { targetType: "ip", targetId: b.ip });
    res.json({ ok: true });
  });

  /* ── DATA & INSIGHTS (poori SaaS ka data) ── */
  const INTERNAL = new Set(["sasessions", "saloginattempts", "saalerts", "sablockedips", "saudits"]);
  const collectionNames = async () => {
    const list = await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray();
    return list.map((c) => c.name).filter((n) => !n.startsWith("system.")).slice(0, 80);
  };

  // Har collection ka document count + size, aur pichhle 6 mahine ke naye shops
  r.get("/insights", async (req, res) => {
    try {
      const db = mongoose.connection.db;
      const names = await collectionNames();
      const collections = await Promise.all(names.map(async (name) => {
        const col = db.collection(name);
        let count = 0, size = 0, storage = 0;
        try { count = await col.estimatedDocumentCount(); } catch { /* ignore */ }
        try {
          const [st] = await col.aggregate([{ $collStats: { storageStats: {} } }]).toArray();
          size = st?.storageStats?.size || 0;
          storage = st?.storageStats?.storageSize || 0;
        } catch { /* $collStats allowed nahi to size skip */ }
        return { name, count, size, storage, internal: INTERNAL.has(name) };
      }));
      collections.sort((a, b) => b.count - a.count);

      // naye shops per month (ObjectId ke timestamp se — createdAt field ki zaroorat nahi)
      let signupsByMonth = [];
      try {
        const Shop = require("../models/Shop");
        const since = new Date();
        since.setUTCMonth(since.getUTCMonth() - 5, 1);
        since.setUTCHours(0, 0, 0, 0);
        const rows = await Shop.aggregate([
          { $addFields: { _d: { $toDate: "$_id" } } },
          { $match: { _d: { $gte: since } } },
          { $group: { _id: { y: { $year: "$_d" }, m: { $month: "$_d" } }, count: { $sum: 1 } } },
        ]);
        const key = (y, m) => `${y}-${m}`;
        const map = new Map(rows.map((x) => [key(x._id.y, x._id.m), x.count]));
        for (let i = 0; i < 6; i++) {
          const d = new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth() + i, 1));
          signupsByMonth.push({
            month: d.toLocaleString("en-US", { month: "short", timeZone: "UTC" }),
            count: map.get(key(d.getUTCFullYear(), d.getUTCMonth() + 1)) || 0,
          });
        }
      } catch (e) { signupsByMonth = []; }

      res.json({
        collections,
        totals: {
          documents: collections.reduce((s, c) => s + c.count, 0),
          size: collections.reduce((s, c) => s + c.size, 0),
        },
        signupsByMonth,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Ek shop ka data: kis collection me uske kitne records hain (shopId se)
  r.get("/insights/shop/:shopId", async (req, res) => {
    try {
      const shopId = String(req.params.shopId || "").slice(0, 100);
      const db = mongoose.connection.db;
      const names = (await collectionNames()).filter((n) => !INTERNAL.has(n));
      const rows = await Promise.all(names.map(async (name) => {
        try {
          const count = await db.collection(name).countDocuments({ shopId });
          return count ? { name, count } : null;
        } catch { return null; }
      }));
      res.json({ shopId, collections: rows.filter(Boolean).sort((a, b) => b.count - a.count) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /* ── AUDIT LOG ── */
  r.get("/audit", async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 200, 500);
    res.json(await SaAudit.find().sort({ createdAt: -1 }).limit(limit).lean());
  });

  return r;
};