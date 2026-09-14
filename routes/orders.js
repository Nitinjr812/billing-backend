const express = require("express");
const router = express.Router();
const Order = require("../models/Order");
const { verifyToken } = require("../middleware/auth");

router.use(verifyToken); // ── har request ab shop-scoped hai ──

// GET all orders (sirf apni shop ke) — grouped by invoiceId so a multi-item
// invoice shows as ONE row instead of one row per line-item
router.get("/", async (req, res) => {
  try {
    const orders = await Order.find({ shopId: req.user.shopId })
      .sort({ date: -1 })
      .limit(1000) // raw line-items — grouped down to <=500 invoices below
      .lean();

    const grouped = new Map();

    for (const o of orders) {
      // Fallback for older Order docs saved before invoiceId existed:
      // strip the trailing "-N" line-item suffix off orderId.
      const key = o.invoiceId || o.orderId.replace(/-\d+$/, "");

      if (!grouped.has(key)) {
        grouped.set(key, {
          orderId: key,
          invoiceId: key,
          shopId: o.shopId,
          customer: o.customer,
          status: o.status,
          date: o.date,
          amount: 0,
          items: [],
        });
      }

      const entry = grouped.get(key);
      entry.amount += Number(o.amount) || 0;
      entry.items.push({ product: o.product, qty: o.qty, amount: o.amount });
      // Keep the earliest/latest date consistent across line-items of the same invoice
      if (new Date(o.date) > new Date(entry.date)) entry.date = o.date;
    }

    const result = Array.from(grouped.values())
      .map((row) => ({
        ...row,
        // Backwards-compatible fields for any UI still reading `product`/`qty` directly
        product: row.items.map((i) => i.product).join(", "),
        qty: row.items.reduce((sum, i) => sum + (Number(i.qty) || 0), 0),
      }))
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 500);

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET order summary stats (sirf apni shop ke) — counted per INVOICE, not per line-item
router.get("/stats", async (req, res) => {
  try {
    const { shopId } = req.user;
    const [result] = await Order.aggregate([
      { $match: { shopId } },
      {
        // Collapse line-items belonging to the same invoice into one doc first
        $group: {
          _id: {
            $ifNull: [
              "$invoiceId",
              {
                $reduce: {
                  input: { $slice: [{ $split: ["$orderId", "-"] }, 0, { $subtract: [{ $size: { $split: ["$orderId", "-"] } }, 1] }] },
                  initialValue: "",
                  in: { $cond: [{ $eq: ["$$value", ""] }, "$$this", { $concat: ["$$value", "-", "$$this"] }] },
                },
              },
            ],
          },
          status: { $first: "$status" },
          amount: { $sum: "$amount" },
        },
      },
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