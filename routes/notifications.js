const express = require("express");
const router = express.Router();
const Notification = require("../models/Notification");
const Product = require("../models/Product");
const Order = require("../models/Order");

// GET /api/notifications — latest 50 + unread count (for bell icon)
router.get("/", async (req, res) => {
  try {
    const [notifications, unreadCount] = await Promise.all([
      Notification.find().sort({ createdAt: -1 }).limit(50).lean(),
      Notification.countDocuments({ read: false }),
    ]);
    res.json({ notifications, unreadCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/notifications/:id/read — mark one as read
router.patch("/:id/read", async (req, res) => {
  try {
    const notif = await Notification.findByIdAndUpdate(
      req.params.id,
      { read: true },
      { new: true }
    );
    if (!notif) return res.status(404).json({ error: "Notification not found" });
    res.json(notif);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PATCH /api/notifications/read-all — mark everything read (bell dropdown "clear all")
router.patch("/read-all", async (req, res) => {
  try {
    await Notification.updateMany({ read: false }, { read: true });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/notifications/scan-stock
// Scans products for outOfStock / lowStock / slowMoving issues and creates
// a notification for each — but only if an UNREAD one for that exact
// product+type doesn't already exist. This is what stops the popup/bell
// from spamming the same alert every time the Dashboard loads.
router.post("/scan-stock", async (req, res) => {
  try {
    const [products, orders] = await Promise.all([
      Product.find().lean(),
      Order.find().lean(),
    ]);

    const ordersByProduct = {};
    for (const o of orders) {
      if (o.status !== "Cancelled") {
        ordersByProduct[o.product] = (ordersByProduct[o.product] || 0) + 1;
      }
    }

    const candidates = [];
    for (const p of products) {
      if (p.stock === 0) {
        candidates.push({
          type: "outOfStock",
          productId: p.productId,
          productName: p.name,
          message: `${p.name} is out of stock.`,
        });
      } else if (p.stock < 50) {
        candidates.push({
          type: "lowStock",
          productId: p.productId,
          productName: p.name,
          message: `${p.name} has only ${p.stock} units left.`,
        });
      }

      const soldCount = ordersByProduct[p.name] || 0;
      if (soldCount < 2 && p.stock > 0) {
        candidates.push({
          type: "slowMoving",
          productId: p.productId,
          productName: p.name,
          message: `${p.name} is moving slowly — only ${soldCount} order(s) recently.`,
        });
      }
    }

    const created = [];
    for (const c of candidates) {
      const existing = await Notification.findOne({
        productId: c.productId,
        type: c.type,
        read: false,
      });
      if (!existing) {
        const notif = await Notification.create(c);
        created.push(notif);
      }
    }

    res.json({ created, scanned: products.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;