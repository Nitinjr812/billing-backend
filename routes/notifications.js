const express = require("express");
const router = express.Router();
const Notification = require("../models/Notification");
const Product = require("../models/Product");
const Order = require("../models/Order");
const { verifyToken } = require("../middleware/auth");

router.use(verifyToken); // ── ab har request pe req.user (userId, shopId) chahiye ──

// How long a cached AI suggestion stays valid before regenerating
const SUGGESTION_CACHE_MS = 6 * 60 * 60 * 1000; // 6 hours

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
      aiSuggestion: n.aiSuggestion || null,
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

// ── PATCH mark everything read ("Mark all read") ─────────────────────
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

// ── DELETE one notification ("clear" a single card) ──────────────────
// Note: broadcast notifications (recipientId: null) are shop-wide, so
// deleting one removes it for the whole shop, not just this user.
router.delete("/:id", async (req, res) => {
  try {
    const { userId, shopId } = req.user;
    const notif = await Notification.findOneAndDelete({
      _id: req.params.id,
      shopId,
      $or: [{ recipientId: null }, { recipientId: userId }],
    });
    if (!notif) return res.status(404).json({ error: "Notification not found" });
    res.json({ success: true, id: req.params.id });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── DELETE everything ("Clear all" — actually removes, not just read) ─
router.delete("/", async (req, res) => {
  try {
    const { userId, shopId } = req.user;
    const result = await Notification.deleteMany({
      shopId,
      $or: [{ recipientId: null }, { recipientId: userId }],
    });
    res.json({ success: true, deletedCount: result.deletedCount });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── POST AI suggestion for a notification (cached on the doc) ────────
router.post("/:id/suggest", async (req, res) => {
  try {
    const { userId, shopId } = req.user;
    const notif = await Notification.findOne({
      _id: req.params.id,
      shopId,
      $or: [{ recipientId: null }, { recipientId: userId }],
    });
    if (!notif) return res.status(404).json({ error: "Notification not found" });

    // Serve cached suggestion if it's still fresh
    const isFresh =
      notif.aiSuggestion &&
      notif.aiSuggestionAt &&
      Date.now() - new Date(notif.aiSuggestionAt).getTime() < SUGGESTION_CACHE_MS;

    if (isFresh) {
      return res.json({ suggestion: notif.aiSuggestion, cached: true });
    }

    // Pull real context: product details + recent order count + how many
    // times this same alert has recurred for this product.
    let product = null;
    let recentOrders = 0;
    if (notif.productId) {
      product = await Product.findOne({ productId: notif.productId, shopId }).lean();
      if (product) {
        const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        recentOrders = await Order.countDocuments({
          shopId,
          product: product.name,
          status: { $ne: "Cancelled" },
          createdAt: { $gte: cutoff },
        });
      }
    }

    const occurrenceCount = notif.productId
      ? await Notification.countDocuments({ shopId, type: notif.type, productId: notif.productId })
      : 1;

    const prompt = `You are helping a small retail shop owner in India understand a stock/sales alert from their inventory dashboard.

Alert type: ${notif.type}
Product: ${product?.name || "N/A"}
Current stock: ${product?.stock ?? "unknown"}
Orders for this product in the last 30 days: ${recentOrders}
Alert message: ${notif.message}
This alert has recurred ${occurrenceCount} time(s) for this product.
First raised: ${notif.createdAt}

Write ONE short, specific, actionable suggestion (max 2 sentences) for what the shop owner should do. Use the actual numbers given. No greeting, no preamble — just the suggestion.`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001", // fast + cheap, good enough for short suggestions
        max_tokens: 150,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Anthropic API error:", errText);
      return res.status(502).json({ error: "AI suggestion service failed" });
    }

    const data = await response.json();
    const suggestion =
      data.content?.find((b) => b.type === "text")?.text?.trim() ||
      "Could not generate a suggestion right now.";

    notif.aiSuggestion = suggestion;
    notif.aiSuggestionAt = new Date();
    await notif.save();

    res.json({ suggestion, cached: false });
  } catch (err) {
    console.error("AI suggestion error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST scan-stock — poori shop (owner + staff) ko broadcast karta hai ──
router.post("/scan-stock", async (req, res) => {
  try {
    const { shopId } = req.user;

    const [products, orders] = await Promise.all([
      Product.find({ shopId }).lean(),
      Order.find({ shopId }).lean(),
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

/* ── Notification model — add these two fields if not present ──────────
aiSuggestion:   { type: String, default: null },
aiSuggestionAt: { type: Date, default: null },
------------------------------------------------------------------------ */