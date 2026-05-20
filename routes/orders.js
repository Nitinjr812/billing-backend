const express = require("express");
const router = express.Router();
const Order = require("../models/Order");

// GET all orders
router.get("/", async (req, res) => {
  try {
    const orders = await Order.find().sort({ date: -1 });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET order summary stats
router.get("/stats", async (req, res) => {
  try {
    const total = await Order.countDocuments();
    const delivered = await Order.countDocuments({ status: "Delivered" });
    const pending = await Order.countDocuments({ status: "Pending" });
    const processing = await Order.countDocuments({ status: "Processing" });
    const cancelled = await Order.countDocuments({ status: "Cancelled" });

    const revenueResult = await Order.aggregate([
      { $match: { status: { $ne: "Cancelled" } } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);

    const totalRevenue = revenueResult[0]?.total || 0;

    res.json({ total, delivered, pending, processing, cancelled, totalRevenue });
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