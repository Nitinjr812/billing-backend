const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const SuperAdmin = require("../models/SuperAdmin");
const Shop = require("../models/Shop");
const User = require("../models/User");
const AdminMessage = require("../models/AdminMessage");
const { verifySuperAdmin } = require("../middleware/superAdminAuth");

const PLAN_DEFAULT_AMOUNTS = { free: 0, pro: 999, premium: 2499 };

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

// ── LIST all shops (with subscription summary) ───────────────────────
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

// ── GET one shop's full detail (owner + team + subscription history) ──
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

// ── SUSPEND / ACTIVATE a shop ────────────────────────────────────────
router.patch("/shops/:shopId/status", async (req, res) => {
  try {
    const { status, reason } = req.body;
    if (!["active", "suspended"].includes(status)) {
      return res.status(400).json({ error: "status must be 'active' or 'suspended'" });
    }

    const shop = await Shop.findOneAndUpdate(
      { shopId: req.params.shopId },
      { status, suspendedReason: status === "suspended" ? (reason || "Suspended by admin") : "" },
      { new: true }
    );

    if (!shop) return res.status(404).json({ error: "Shop not found" });

    res.json({ success: true, shop });
  } catch (err) {
    console.error("Superadmin status update error:", err.message);
    res.status(500).json({ error: "Failed to update shop status" });
  }
});

// ── UPDATE subscription plan / amount / discount ─────────────────────
router.patch("/shops/:shopId/subscription", async (req, res) => {
  try {
    const { plan, monthlyAmount, discountPercent } = req.body;

    const update = {};
    if (plan !== undefined) {
      if (!["free", "pro", "premium"].includes(plan)) {
        return res.status(400).json({ error: "Invalid plan" });
      }
      update["subscription.plan"] = plan;
      // agar amount nahi diya, plan ke default amount pe set kar do
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
    }

    const shop = await Shop.findOneAndUpdate(
      { shopId: req.params.shopId },
      { $set: update },
      { new: true }
    );

    if (!shop) return res.status(404).json({ error: "Shop not found" });

    res.json({ success: true, subscription: shop.subscription });
  } catch (err) {
    console.error("Superadmin subscription update error:", err.message);
    res.status(500).json({ error: "Failed to update subscription" });
  }
});

// ── RECORD a payment/renewal (loyalty history ke liye) ───────────────
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
    });
    await shop.save();

    res.json({ success: true, renewalHistory: shop.subscription.renewalHistory });
  } catch (err) {
    console.error("Superadmin record-payment error:", err.message);
    res.status(500).json({ error: "Failed to record payment" });
  }
});

// ── SEND a message/offer to a shop ────────────────────────────────────
router.post("/shops/:shopId/notify", async (req, res) => {
  try {
    const { title, message, type } = req.body;
    if (!title || !message) return res.status(400).json({ error: "title and message required" });

    const shop = await Shop.findOne({ shopId: req.params.shopId });
    if (!shop) return res.status(404).json({ error: "Shop not found" });

    const msg = await AdminMessage.create({
      shopId: req.params.shopId,
      title,
      message,
      type: ["offer", "announcement", "warning"].includes(type) ? type : "offer",
    });

    res.json({ success: true, message: msg });
  } catch (err) {
    console.error("Superadmin notify error:", err.message);
    res.status(500).json({ error: "Failed to send message" });
  }
});

// ── ANALYTICS overview ────────────────────────────────────────────────
router.get("/analytics", async (req, res) => {
  try {
    const shops = await Shop.find();

    let totalRevenue = 0;
    let mrr = 0; // monthly recurring revenue from active shops
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

// ── DELETE a shop entirely (teardown) ────────────────────────────────
router.delete("/shops/:shopId", async (req, res) => {
  try {
    const shop = await Shop.findOne({ shopId: req.params.shopId });
    if (!shop) return res.status(404).json({ error: "Shop not found" });

    await User.deleteMany({ shopId: shop.shopId });
    await AdminMessage.deleteMany({ shopId: shop.shopId });
    await Shop.deleteOne({ shopId: shop.shopId });

    res.json({ success: true, message: "Shop and all its users deleted" });
  } catch (err) {
    console.error("Superadmin shop delete error:", err.message);
    res.status(500).json({ error: "Failed to delete shop" });
  }
});

module.exports = router;