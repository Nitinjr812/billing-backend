const express = require("express");
const router = express.Router();
const Order = require("../models/Order");
const { verifyToken } = require("../middleware/auth");

router.use(verifyToken); // ── har request ab shop-scoped hai ──

// GET all orders (sirf apni shop ke)
router.get("/", async (req, res) => {
  try {
    const orders = await Order.find({ shopId: req.user.shopId })
      .sort({ date: -1 })
      .limit(500)
      .lean();
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET order summary stats (sirf apni shop ke)
router.get("/stats", async (req, res) => {
  try {
    const { shopId } = req.user;
    const [result] = await Order.aggregate([
      { $match: { shopId } },
      {
        $facet: {
          total: [{ $count: "count" }],
          byStatus: [{ $group: { _id: "$status", count: { $sum: 1 } } }],
          revenue: [
            { $match: { status: { $ne: "Cancelled" } } },
            { $group: { _id: null, total: { $sum: "$amount" } } },
          ],
        },
      },
    ]);

    const statusMap = Object.fromEntries(
      (result.byStatus || []).map((s) => [s._id, s.count])
    );

    res.json({
      total: result.total[0]?.count || 0,
      completed: statusMap.Completed || 0,
      pending: statusMap.Pending || 0,
      cancelled: statusMap.Cancelled || 0,
      totalRevenue: result.revenue[0]?.total || 0,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create order (apni shop ke saath tag hoke)
router.post("/", async (req, res) => {
  try {
    const order = new Order({ ...req.body, shopId: req.user.shopId });
    await order.save();
    res.status(201).json(order);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ error: "An order with this ID already exists in your shop." });
    }
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;