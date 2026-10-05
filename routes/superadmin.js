const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const SuperAdmin = require("../models/SuperAdmin");
const Shop = require("../models/Shop");
const User = require("../models/User");
const AdminMessage = require("../models/AdminMessage");
const Notification = require("../models/Notification");
const Report = require("../models/Report");
const Announcement = require("../models/Announcement");
const { verifySuperAdmin } = require("../middleware/superAdminAuth");

const PLAN_DEFAULT_AMOUNTS = { free: 0, pro: 999, premium: 2499 };
const PLANS = ["free", "pro", "premium"];
const inr = (n) => `₹${Number(n || 0).toLocaleString("en-IN")}`;

// ── LOGIN ──────────────────────────────────────────────────────────────
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }

    const admin = await SuperAdmin.findOne({ email: email.toLowerCase().trim() });
    if (!admin) return res.status(401).json({ error: "Invalid credentials" });

    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) return res.status(401).json({ error: "Invalid credentials" });

    const token = jwt.sign(
      { superAdminId: admin._id, type: "superadmin" },
      process.env.SUPERADMIN_JWT_SECRET || process.env.JWT_SECRET,
      { expiresIn: "12h" }
    );

    res.json({ token, name: admin.name, email: admin.email });
  } catch (err) {
    console.error("Superadmin login error:", err.message);
    res.status(500).json({ error: "Login failed" });
  }
});

router.use(verifySuperAdmin); // ── neeche ke sab routes protected hain ──

// ── helper: shop ke notification bell me message ──
async function notifyShop(shopId, { title, message, type = "announcement" }) {
  try {
    await Notification.create({ shopId, recipientId: null, type, title, message });
  } catch (err) {
    console.error("notifyShop failed:", err.message);
  }
}

// ── LIST all shops ───────────────────────────────────────────────────
router.get("/shops", async (req, res) => {
  try {
    const shops = await Shop.find().sort({ createdAt: -1 });

    const enriched = await Promise.all(
      shops.map(async (shop) => {
        const staffCount = await User.countDocuments({ shopId: shop.shopId });
        const owner = await User.findById(shop.ownerId).select("name email");
        const history = shop.subscription?.renewalHistory || [];
        const totalRevenue = history.reduce((sum, r) => sum + (r.amount || 0), 0);

        return {
          _id: shop._id,
          shopId: shop.shopId,
          shopName: shop.shopName,
          status: shop.status,
          suspendedReason: shop.suspendedReason,
          createdAt: shop.createdAt,
          ownerName: owner?.name || "—",
          ownerEmail: owner?.email || "—",
          totalUsers: staffCount,
          plan: shop.subscription?.plan || "free",
          monthlyAmount: shop.subscription?.monthlyAmount || 0,
          discountPercent: shop.subscription?.discountPercent || 0,
          expiresAt: shop.subscription?.expiresAt || null,
          renewalCount: history.length,
          totalRevenue,
        };
      })
    );

    res.json(enriched);
  } catch (err) {
    console.error("Superadmin shops fetch error:", err.message);
    res.status(500).json({ error: "Failed to fetch shops" });
  }
});

// ── ANALYTICS: monthly revenue (last 6 months, IST) ──────────────────
router.get("/analytics/monthly", async (req, res) => {
  try {
    const IST = 19800000; // 5.5h in ms
    const ist = new Date(Date.now() + IST);
    const y = ist.getUTCFullYear();
    const m = ist.getUTCMonth();
    const start = new Date(Date.UTC(y, m - 5, 1) - IST);

    const rows = await Shop.aggregate([
      { $unwind: "$subscription.renewalHistory" },
      { $match: { "subscription.renewalHistory.date": { $gte: start } } },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m", date: "$subscription.renewalHistory.date", timezone: "Asia/Kolkata" },
          },
          amount: { $sum: "$subscription.renewalHistory.amount" },
        },
      },
    ]);
    const byKey = Object.fromEntries(rows.map((r) => [r._id, r.amount]));

    const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const out = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(Date.UTC(y, m - i, 1));
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      out.push({ month: names[d.getUTCMonth()], amount: byKey[key] || 0 });
    }
    res.json(out);
  } catch (err) {
    console.error("Superadmin monthly error:", err.message);
    res.status(500).json({ error: "Failed to fetch monthly revenue" });
  }
});

// ── ANALYTICS overview ────────────────────────────────────────────────
router.get("/analytics", async (req, res) => {
  try {
    const shops = await Shop.find();

    let totalRevenue = 0;
    let mrr = 0;
    const planCounts = { free: 0, pro: 0, premium: 0 };
    let activeCount = 0, suspendedCount = 0;
    const loyalShops = [];

    for (const shop of shops) {
      const sub = shop.subscription || {};
      const history = sub.renewalHistory || [];
      const revenue = history.reduce((sum, r) => sum + (r.amount || 0), 0);
      totalRevenue += revenue;

      planCounts[sub.plan || "free"] = (planCounts[sub.plan || "free"] || 0) + 1;

      if (shop.status === "active") {
        activeCount++;
        const discount = sub.discountPercent || 0;
        mrr += (sub.monthlyAmount || 0) * (1 - discount / 100);
      } else {
        suspendedCount++;
      }

      if (history.length >= 3) {
        loyalShops.push({
          shopId: shop.shopId,
          shopName: shop.shopName,
          renewalCount: history.length,
          plan: sub.plan,
          discountPercent: sub.discountPercent || 0,
        });
      }
    }

    loyalShops.sort((a, b) => b.renewalCount - a.renewalCount);

    res.json({
      totalShops: shops.length,
      activeCount,
      suspendedCount,
      totalRevenue,
      mrr: Math.round(mrr),
      planCounts,
      loyalShops,
    });
  } catch (err) {
    console.error("Superadmin analytics error:", err.message);
    res.status(500).json({ error: "Failed to fetch analytics" });
  }
});

// ── PAYMENTS (renewalHistory flatten) ────────────────────────────────
router.get("/payments", async (req, res) => {
  try {
    const rows = await Shop.aggregate([
      { $unwind: "$subscription.renewalHistory" },
      {
        $project: {
          _id: "$subscription.renewalHistory._id",
          shopId: 1,
          shopName: 1,
          plan: "$subscription.renewalHistory.plan",
          amount: "$subscription.renewalHistory.amount",
          method: "$subscription.renewalHistory.method",
          orderId: "$subscription.renewalHistory.orderId",
          createdAt: "$subscription.renewalHistory.date",
        },
      },
      { $sort: { createdAt: -1 } },
      { $limit: 300 },
    ]);
    res.json(rows);
  } catch (err) {
    console.error("Superadmin payments error:", err.message);
    res.status(500).json({ error: "Failed to fetch payments" });
  }
});

// ── ACTIVITY feed (live, signups + payments + reports + suspensions) ──
router.get("/activity", async (req, res) => {
  try {
    const [shops, reports] = await Promise.all([
      Shop.find()
        .select("shopId shopName createdAt status suspendedAt suspendedReason subscription.renewalHistory")
        .lean(),
      Report.find().sort({ createdAt: -1 }).limit(30).lean(),
    ]);

    const events = [];
    for (const s of shops) {
      if (s.createdAt) {
        events.push({ _id: `signup-${s.shopId}`, type: "signup", text: `Naya shop signup: ${s.shopName}`, createdAt: s.createdAt });
      }
      for (const r of s.subscription?.renewalHistory || []) {
        events.push({
          _id: `pay-${r._id}`,
          type: "payment",
          text: `${s.shopName} ne ${r.plan || "plan"} ke liye ${inr(r.amount)} pay kiya`,
          createdAt: r.date,
        });
      }
      if (s.status === "suspended" && s.suspendedAt) {
        events.push({
          _id: `sus-${s.shopId}`,
          type: "suspend",
          text: `${s.shopName} suspend kiya gaya${s.suspendedReason ? ` (${s.suspendedReason})` : ""}`,
          createdAt: s.suspendedAt,
        });
      }
    }
    for (const r of reports) {
      events.push({ _id: `rep-${r._id}`, type: "report", text: `Naya customer report: ${r.subject} (${r.shopName})`, createdAt: r.createdAt });
    }

    events.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(events.slice(0, 40));
  } catch (err) {
    console.error("Superadmin activity error:", err.message);
    res.status(500).json({ error: "Failed to fetch activity" });
  }
});

// ── CUSTOMER REPORTS ─────────────────────────────────────────────────
router.get("/reports", async (req, res) => {
  try {
    const reports = await Report.find().sort({ createdAt: -1 }).limit(300).lean();
    res.json(reports);
  } catch (err) {
    console.error("Superadmin reports error:", err.message);
    res.status(500).json({ error: "Failed to fetch reports" });
  }
});

router.patch("/reports/:id", async (req, res) => {
  try {
    const { status, reply } = req.body;
    if (status !== undefined && !["open", "in_progress", "resolved"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const report = await Report.findById(req.params.id);
    if (!report) return res.status(404).json({ error: "Report not found" });

    const oldReply = report.reply;
    if (status !== undefined) report.status = status;
    if (reply !== undefined) report.reply = String(reply).trim();
    await report.save();

    // naya reply gaya ya resolve hua => shop ko bell me bata do
    if (report.reply && report.reply !== oldReply) {
      await notifyShop(report.shopId, {
        title: `Update on your report: ${report.subject}`,
        message: report.reply,
      });
    }

    res.json(report);
  } catch (err) {
    console.error("Superadmin report update error:", err.message);
    res.status(500).json({ error: "Failed to update report" });
  }
});

// ── ANNOUNCEMENTS ────────────────────────────────────────────────────
router.get("/announcements", async (req, res) => {
  try {
    const list = await Announcement.find().sort({ createdAt: -1 }).limit(100).lean();
    res.json(list);
  } catch (err) {
    console.error("Superadmin announcements error:", err.message);
    res.status(500).json({ error: "Failed to fetch announcements" });
  }
});

router.post("/announcements", async (req, res) => {
  try {
    const { title, message, audience = "all" } = req.body;
    if (!title?.trim() || !message?.trim()) {
      return res.status(400).json({ error: "title and message required" });
    }
    if (audience !== "all" && !PLANS.includes(audience)) {
      return res.status(400).json({ error: "Invalid audience" });
    }

    const filter = audience === "all" ? {} : { "subscription.plan": audience };
    const shops = await Shop.find(filter).select("shopId").lean();

    if (shops.length > 0) {
      await Notification.insertMany(
        shops.map((s) => ({
          shopId: s.shopId,
          recipientId: null,
          type: "announcement",
          title: title.trim(),
          message: message.trim(),
        }))
      );
    }

    const announcement = await Announcement.create({
      title: title.trim(),
      message: message.trim(),
      audience,
      recipients: shops.length,
    });

    res.json({ success: true, announcement });
  } catch (err) {
    console.error("Superadmin announce error:", err.message);
    res.status(500).json({ error: "Failed to send announcement" });
  }
});

// ── GET one shop's full detail ───────────────────────────────────────
router.get("/shops/:shopId", async (req, res) => {
  try {
    const shop = await Shop.findOne({ shopId: req.params.shopId });
    if (!shop) return res.status(404).json({ error: "Shop not found" });

    const users = await User.find({ shopId: shop.shopId }).select("-password");
    const messages = await AdminMessage.find({ shopId: shop.shopId }).sort({ createdAt: -1 }).limit(20);

    res.json({ shop, users, messages });
  } catch (err) {
    console.error("Superadmin shop detail error:", err.message);
    res.status(500).json({ error: "Failed to fetch shop details" });
  }
});

// ── SUSPEND / ACTIVATE ───────────────────────────────────────────────
router.patch("/shops/:shopId/status", async (req, res) => {
  try {
    const { status, reason } = req.body;
    if (!["active", "suspended"].includes(status)) {
      return res.status(400).json({ error: "status must be 'active' or 'suspended'" });
    }

    const shop = await Shop.findOneAndUpdate(
      { shopId: req.params.shopId },
      {
        status,
        suspendedReason: status === "suspended" ? (reason || "Suspended by admin") : "",
        suspendedAt: status === "suspended" ? new Date() : null,
      },
      { new: true }
    );

    if (!shop) return res.status(404).json({ error: "Shop not found" });

    if (status === "suspended") {
      await notifyShop(shop.shopId, {
        title: "Your shop has been suspended",
        message: reason ? `Reason: ${reason}` : "Your shop access has been suspended by the admin. Please contact support.",
      });
    } else {
      await notifyShop(shop.shopId, {
        title: "Your shop is active again",
        message: "Your shop has been reactivated. You can now access everything as usual.",
      });
    }

    res.json({ success: true, shop });
  } catch (err) {
    console.error("Superadmin status update error:", err.message);
    res.status(500).json({ error: "Failed to update shop status" });
  }
});

// ── UPDATE subscription ──────────────────────────────────────────────
router.patch("/shops/:shopId/subscription", async (req, res) => {
  try {
    const { plan, monthlyAmount, discountPercent } = req.body;

    const update = {};
    const changesForNotify = [];

    if (plan !== undefined) {
      if (!PLANS.includes(plan)) {
        return res.status(400).json({ error: "Invalid plan" });
      }
      update["subscription.plan"] = plan;
      changesForNotify.push(`plan changed to ${plan}`);
      if (monthlyAmount === undefined) {
        update["subscription.monthlyAmount"] = PLAN_DEFAULT_AMOUNTS[plan];
      }
    }
    if (monthlyAmount !== undefined) {
      const amt = Number(monthlyAmount);
      if (isNaN(amt) || amt < 0) return res.status(400).json({ error: "Invalid monthlyAmount" });
      update["subscription.monthlyAmount"] = amt;
    }
    if (discountPercent !== undefined) {
      const dp = Number(discountPercent);
      if (isNaN(dp) || dp < 0 || dp > 100) return res.status(400).json({ error: "Invalid discountPercent" });
      update["subscription.discountPercent"] = dp;
      if (dp > 0) changesForNotify.push(`a ${dp}% discount was applied`);
    }

    const shop = await Shop.findOneAndUpdate(
      { shopId: req.params.shopId },
      { $set: update },
      { new: true }
    );

    if (!shop) return res.status(404).json({ error: "Shop not found" });

    if (changesForNotify.length > 0) {
      await notifyShop(shop.shopId, {
        title: "Your subscription was updated",
        message: `Your subscription was updated: ${changesForNotify.join(", ")}.`,
      });
    }

    res.json({ success: true, subscription: shop.subscription });
  } catch (err) {
    console.error("Superadmin subscription update error:", err.message);
    res.status(500).json({ error: "Failed to update subscription" });
  }
});

// ── RECORD a manual payment ──────────────────────────────────────────
router.post("/shops/:shopId/record-payment", async (req, res) => {
  try {
    const { amount } = req.body;
    const amt = Number(amount);
    if (isNaN(amt) || amt < 0) return res.status(400).json({ error: "Invalid amount" });

    const shop = await Shop.findOne({ shopId: req.params.shopId });
    if (!shop) return res.status(404).json({ error: "Shop not found" });

    shop.subscription.renewalHistory.push({
      date: new Date(),
      amount: amt,
      plan: shop.subscription.plan,
      method: "Manual",
    });
    await shop.save();

    res.json({ success: true, renewalHistory: shop.subscription.renewalHistory });
  } catch (err) {
    console.error("Superadmin record-payment error:", err.message);
    res.status(500).json({ error: "Failed to record payment" });
  }
});

// ── SEND a message/offer to a shop ───────────────────────────────────
router.post("/shops/:shopId/notify", async (req, res) => {
  try {
    const { title, message, type } = req.body;
    if (!title || !message) return res.status(400).json({ error: "title and message required" });

    const shop = await Shop.findOne({ shopId: req.params.shopId });
    if (!shop) return res.status(404).json({ error: "Shop not found" });

    const safeType = ["offer", "announcement", "warning"].includes(type) ? type : "offer";

    const msg = await AdminMessage.create({
      shopId: req.params.shopId,
      title,
      message,
      type: safeType,
    });

    await notifyShop(req.params.shopId, { type: "announcement", title, message });

    res.json({ success: true, message: msg });
  } catch (err) {
    console.error("Superadmin notify error:", err.message);
    res.status(500).json({ error: "Failed to send message" });
  }
});

// ── DELETE a shop entirely ───────────────────────────────────────────
router.delete("/shops/:shopId", async (req, res) => {
  try {
    const shop = await Shop.findOne({ shopId: req.params.shopId });
    if (!shop) return res.status(404).json({ error: "Shop not found" });

    await User.deleteMany({ shopId: shop.shopId });
    await AdminMessage.deleteMany({ shopId: shop.shopId });
    await Report.deleteMany({ shopId: shop.shopId });
    await Shop.deleteOne({ shopId: shop.shopId });

    res.json({ success: true, message: "Shop and all its users deleted" });
  } catch (err) {
    console.error("Superadmin shop delete error:", err.message);
    res.status(500).json({ error: "Failed to delete shop" });
  }
});



// ── SHOP VERIFICATION REQUESTS ───────────────────────────────────────
router.get("/verifications", async (req, res) => {
  try {
    const status = ["pending", "approved", "rejected"].includes(req.query.status) ? req.query.status : "pending";
    const shops = await Shop.find({
      "verification.status": status,
      "verification.submittedAt": { $ne: null },
    })
      .sort({ "verification.submittedAt": status === "pending" ? 1 : -1 })
      .limit(50)
      .lean();

    const out = await Promise.all(
      shops.map(async (s) => {
        const owner = await User.findById(s.ownerId).select("name email").lean();
        return {
          shopId: s.shopId,
          shopName: s.shopName,
          ownerName: owner?.name || "—",
          ownerEmail: owner?.email || "—",
          gstin: s.verification.gstin,
          address: s.verification.address,
          photos: s.verification.photos,
          status: s.verification.status,
          rejectReason: s.verification.rejectReason,
          submittedAt: s.verification.submittedAt,
          reviewedAt: s.verification.reviewedAt,
        };
      })
    );
    res.json(out);
  } catch (err) {
    console.error("Superadmin verifications error:", err.message);
    res.status(500).json({ error: "Failed to fetch verification requests" });
  }
});

router.patch("/verifications/:shopId", async (req, res) => {
  try {
    const { decision, reason } = req.body;
    if (!["approve", "reject"].includes(decision)) {
      return res.status(400).json({ error: "decision must be 'approve' or 'reject'" });
    }
    const approve = decision === "approve";

    const shop = await Shop.findOneAndUpdate(
      { shopId: req.params.shopId, "verification.status": "pending" },
      {
        $set: {
          "verification.status": approve ? "approved" : "rejected",
          "verification.reviewedAt": new Date(),
          "verification.rejectReason": approve ? "" : String(reason || "").trim(),
        },
      },
      { new: true }
    );
    if (!shop) return res.status(404).json({ error: "No pending request for this shop" });

    await notifyShop(shop.shopId, {
      title: approve ? "Your shop has been approved" : "Your shop verification was rejected",
      message: approve
        ? "Your shop is verified. You can now use all features."
        : `Reason: ${reason || "Details could not be verified"}. Please resubmit your details.`,
    });

    res.json({ success: true, status: shop.verification.status });
  } catch (err) {
    console.error("Superadmin verification decision error:", err.message);
    res.status(500).json({ error: "Failed to update verification" });
  }
});

module.exports = router;