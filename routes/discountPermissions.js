const express = require("express");
const router = express.Router();
const User = require("../models/User");
const DiscountPermission = require("../models/DiscountPermission");
const { verifyToken, requireRole } = require("../middleware/auth");

router.use(verifyToken);

// GET /api/discount-permissions/team — staff list + unki current permission
router.get("/team", requireRole("owner"), async (req, res) => {
  try {
    const staff = await User.find({ shopId: req.user.shopId, role: "staff" }).select("-password");
    const permissions = await DiscountPermission.find({ shopId: req.user.shopId });
    const permMap = Object.fromEntries(permissions.map((p) => [p.userId.toString(), p]));

    const result = staff.map((s) => ({
      _id: s._id,
      name: s.name,
      email: s.email,
      canGiveDiscount: permMap[s._id.toString()]?.canGiveDiscount || false,
      maxDiscountPercent: permMap[s._id.toString()]?.maxDiscountPercent || 0,
    }));

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/discount-permissions/:userId — set/update permission
router.put("/:userId", requireRole("owner"), async (req, res) => {
  try {
    const { canGiveDiscount, maxDiscountPercent } = req.body;

    const target = await User.findById(req.params.userId);
    if (!target || target.shopId !== req.user.shopId || target.role !== "staff") {
      return res.status(404).json({ error: "Staff member not found in your shop" });
    }

    const rate = Math.min(100, Math.max(0, Number(maxDiscountPercent) || 0));

    const perm = await DiscountPermission.findOneAndUpdate(
      { userId: target._id },
      { userId: target._id, shopId: req.user.shopId, canGiveDiscount: !!canGiveDiscount, maxDiscountPercent: rate },
      { upsert: true, new: true }
    );

    res.json({ success: true, permission: perm });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;