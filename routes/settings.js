const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const Shop = require("../models/Shop");
const { verifyToken, requireRole } = require("../middleware/auth");

router.use(verifyToken); // ── sab settings routes ke liye login zaroori ──

// ── GET Profile ──────────────────────────────────────────────────────────
router.get("/profile", async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select("-password");
    if (!user) return res.status(404).json({ error: "User not found" });

    const shop = await Shop.findOne({ shopId: user.shopId });

    res.json({
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      company: shop?.shopName || "",
      shopId: user.shopId,
    });
  } catch (err) {
    console.error("Profile fetch error:", err.message);
    res.status(500).json({ error: "Failed to fetch profile" });
  }
});

// ── UPDATE Profile (naam, phone) ─────────────────────────────────────────
router.put("/profile", async (req, res) => {
  try {
    const { name, phone } = req.body;
    const update = {};
    if (name !== undefined) update.name = name;
    if (phone !== undefined) update.phone = phone;

    const user = await User.findByIdAndUpdate(req.user.userId, update, { new: true }).select("-password");
    res.json({ success: true, user });
  } catch (err) {
    console.error("Profile update error:", err.message);
    res.status(500).json({ error: "Failed to update profile" });
  }
});

// ── CHANGE Password ──────────────────────────────────────────────────────
router.put("/password", async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "Both current and new password required" });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: "New password must be at least 6 characters" });
    }

    const user = await User.findById(req.user.userId);
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();

    res.json({ success: true });
  } catch (err) {
    console.error("Password change error:", err.message);
    res.status(500).json({ error: "Failed to change password" });
  }
});

// ── GET Team members (same shop) ─────────────────────────────────────────
router.get("/team", async (req, res) => {
  try {
    const members = await User.find({ shopId: req.user.shopId }).select("-password");
    res.json(members);
  } catch (err) {
    console.error("Team fetch error:", err.message);
    res.status(500).json({ error: "Failed to fetch team" });
  }
});

// ── REMOVE staff member (owner only, can't remove owner) ─────────────────
router.delete("/team/:userId", requireRole("owner"), async (req, res) => {
  try {
    const target = await User.findById(req.params.userId);
    if (!target || target.shopId !== req.user.shopId) {
      return res.status(404).json({ error: "User not found in your shop" });
    }
    if (target.role === "owner") {
      return res.status(400).json({ error: "Cannot remove the shop owner" });
    }

    await User.findByIdAndDelete(req.params.userId);
    res.json({ success: true });
  } catch (err) {
    console.error("Team remove error:", err.message);
    res.status(500).json({ error: "Failed to remove member" });
  }
});

// ── GET Notification settings ────────────────────────────────────────────
router.get("/notifications", async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select("notificationSettings");
    res.json(user.notificationSettings);
  } catch (err) {
    console.error("Notifications fetch error:", err.message);
    res.status(500).json({ error: "Failed to fetch notification settings" });
  }
});

// ── UPDATE Notification settings ─────────────────────────────────────────
router.put("/notifications", async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.user.userId,
      { notificationSettings: req.body },
      { new: true }
    ).select("notificationSettings");
    res.json({ success: true, notificationSettings: user.notificationSettings });
  } catch (err) {
    console.error("Notifications update error:", err.message);
    res.status(500).json({ error: "Failed to update notification settings" });
  }
});

// ── DELETE Account ────────────────────────────────────────────────────────
// - Staff: not allowed to self-delete. Owner must remove them via /team/:userId.
// - Owner: deletes the owner's own User doc, ALL staff Users under the same
//   shopId, and the Shop document itself (full shop teardown).
router.delete("/account", async (req, res) => {
  try {
    const { userId, shopId, role } = req.user;

    if (role === "staff") {
      return res.status(403).json({
        error: "Staff members can't delete their own account. Ask your shop owner to remove you from the team instead.",
      });
    }

    if (role !== "owner") {
      return res.status(400).json({ error: "Unrecognized role" });
    }

    const shop = await Shop.findOne({ shopId });
    if (!shop) {
      return res.status(404).json({ error: "Shop not found" });
    }

    // Safety check: only the actual owner of this shop can trigger the teardown
    if (shop.ownerId.toString() !== userId.toString()) {
      return res.status(403).json({ error: "You are not the owner of this shop" });
    }

    // Delete every user (owner + all staff) tied to this shop
    await User.deleteMany({ shopId });

    // Delete the shop itself
    await Shop.deleteOne({ shopId });

    // NOTE: Order and Product models currently have no shopId field, so they
    // are NOT touched here to avoid accidentally wiping unrelated data.
    // If/when you add shopId to those schemas, add the matching deleteMany
    // calls here, e.g.:
    // await Order.deleteMany({ shopId });
    // await Product.deleteMany({ shopId });

    res.json({ success: true, message: "Account and shop deleted successfully" });
  } catch (err) {
    console.error("Delete account error:", err.message);
    res.status(500).json({ error: "Failed to delete account" });
  }
});

module.exports = router;