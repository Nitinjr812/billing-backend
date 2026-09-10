const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const SuperAdmin = require("../models/SuperAdmin");
const Shop = require("../models/Shop");
const User = require("../models/User");
const { verifySuperAdmin } = require("../middleware/superAdminAuth");

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

// ── LIST all shops ───────────────────────────────────────────────────
router.get("/shops", async (req, res) => {
  try {
    const shops = await Shop.find().sort({ createdAt: -1 });

    const enriched = await Promise.all(
      shops.map(async (shop) => {
        const staffCount = await User.countDocuments({ shopId: shop.shopId });
        const owner = await User.findById(shop.ownerId).select("name email");
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
        };
      })
    );

    res.json(enriched);
  } catch (err) {
    console.error("Superadmin shops fetch error:", err.message);
    res.status(500).json({ error: "Failed to fetch shops" });
  }
});

// ── GET one shop's full detail (owner + team) ────────────────────────
router.get("/shops/:shopId", async (req, res) => {
  try {
    const shop = await Shop.findOne({ shopId: req.params.shopId });
    if (!shop) return res.status(404).json({ error: "Shop not found" });

    const users = await User.find({ shopId: shop.shopId }).select("-password");

    res.json({ shop, users });
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

// ── DELETE a shop entirely (teardown) ────────────────────────────────
router.delete("/shops/:shopId", async (req, res) => {
  try {
    const shop = await Shop.findOne({ shopId: req.params.shopId });
    if (!shop) return res.status(404).json({ error: "Shop not found" });

    await User.deleteMany({ shopId: shop.shopId });
    await Shop.deleteOne({ shopId: shop.shopId });

    res.json({ success: true, message: "Shop and all its users deleted" });
  } catch (err) {
    console.error("Superadmin shop delete error:", err.message);
    res.status(500).json({ error: "Failed to delete shop" });
  }
});

module.exports = router;