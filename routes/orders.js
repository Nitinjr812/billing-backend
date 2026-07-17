const express = require("express");
const router = express.Router();
const Order = require("../models/Order");

// GET all orders
// - .lean() skips mongoose document hydration → much faster JSON responses
// - .limit(500) caps how much data is sent/parsed on every dashboard poll
//   (dashboard only needs recent history for its charts; raise/remove if
//   you have a page elsewhere that genuinely needs full order history)
router.get("/", async (req, res) => {
  try {
    const orders = await Order.find()
      .sort({ date: -1 })
      .limit(500)
      .lean();
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET order summary stats
// Combined into a single aggregation ($facet) instead of 5 separate
// round-trips (4x countDocuments + 1x aggregate). Also dropped the
// "Delivered"/"Processing" counts since those statuses don't exist
// in the schema enum — they were always querying for 0 and wasting a
// round-trip each time.
router.get("/stats", async (req, res) => {
  try {
    const [result] = await Order.aggregate([
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

// POST create order
router.post("/", async (req, res) => {
  try {
    const order = new Order(req.body);
    await order.save();
    res.status(201).json(order);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;