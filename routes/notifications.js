const express = require("express");
const router = express.Router();
const Notification = require("../models/Notification");
const Product = require("../models/Product");
const Order = require("../models/Order");
const { verifyToken } = require("../middleware/auth");

router.use(verifyToken); // ── ab har request pe req.user (userId, shopId) chahiye ──

// ── GET my notifications (shop-broadcast + mujhe targeted) ──────────────
router.get("/", async (req, res) => {
  try {
    const { userId, shopId } = req.user;

    const docs = await Notification.find({
      shopId,
      $or: [{ recipientId: null }, { recipientId: userId }],
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    const notifications = docs.map((n) => ({
      _id: n._id,
      type: n.type,
      title: n.title,
      message: n.message,
      productId: n.productId,
      taskId: n.taskId,
      createdAt: n.createdAt,
      read: (n.readBy || []).some((id) => id.toString() === userId.toString()),
    }));

    const unreadCount = notifications.filter((n) => !n.read).length;

    res.json({ notifications, unreadCount });
  } catch (err) {
    console.error("Notifications fetch error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH mark one as read ────────────────────────────────────────────
router.patch("/:id/read", async (req, res) => {
  try {
    const { userId, shopId } = req.user;
    const notif = await Notification.findOneAndUpdate(
      {
        _id: req.params.id,
        shopId,
        $or: [{ recipientId: null }, { recipientId: userId }],
      },
      { $addToSet: { readBy: userId } },
      { new: true }
    );
    if (!notif) return res.status(404).json({ error: "Notification not found" });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── PATCH mark everything read ("Mark all read" / "Clear all") ──────────
router.patch("/read-all", async (req, res) => {
  try {
    const { userId, shopId } = req.user;
    await Notification.updateMany(
      { shopId, $or: [{ recipientId: null }, { recipientId: userId }] },
      { $addToSet: { readBy: userId } }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── POST scan-stock — poori shop (owner + staff) ko broadcast karta hai ──
router.post("/scan-stock", async (req, res) => {
  try {
    const { shopId } = req.user;

    const [products, orders] = await Promise.all([Product.find().lean(), Order.find().lean()]);

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
          title: "Out of Stock",
          message: `${p.name} is out of stock.`,
        });
      } else if (p.stock < 50) {
        candidates.push({
          type: "lowStock",
          productId: p.productId,
          title: "Low Stock",
          message: `${p.name} has only ${p.stock} units left.`,
        });
      }
      const soldCount = ordersByProduct[p.name] || 0;
      if (soldCount < 2 && p.stock > 0) {
        candidates.push({
          type: "slowMoving",
          productId: p.productId,
          title: "Slow Moving Product",
          message: `${p.name} is moving slowly — only ${soldCount} order(s) recently.`,
        });
      }
    }

    // Cooldown: same shop+type+product ke liye 12 ghante mein dobara na bhejo
    const cutoff = new Date(Date.now() - 12 * 60 * 60 * 1000);
    const created = [];
    for (const c of candidates) {
      const existing = await Notification.findOne({
        shopId,
        type: c.type,
        productId: c.productId,
        createdAt: { $gte: cutoff },
      });
      if (!existing) {
        const notif = await Notification.create({ ...c, shopId, recipientId: null });
        created.push(notif);
      }
    }

    res.json({ created: created.length, scanned: products.length });
  } catch (err) {
    console.error("Scan-stock error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;