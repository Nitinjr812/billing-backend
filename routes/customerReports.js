const express = require("express");
const router = express.Router();
const Report = require("../models/Report");
const Shop = require("../models/Shop");
const requireAuth = require("../middleware/auth"); // ⬅ apna actual middleware naam/path yahan daalo

router.post("/", requireAuth, async (req, res) => {
  try {
    const { subject, message, category, priority } = req.body;
    if (!subject?.trim() || !message?.trim()) {
      return res.status(400).json({ error: "subject and message required" });
    }
    const shop = await Shop.findOne({ shopId: req.user.shopId }).select("shopName");
    if (!shop) return res.status(404).json({ error: "Shop not found" });

    const report = await Report.create({
      shopId: req.user.shopId,
      shopName: shop.shopName,
      subject: subject.trim(),
      message: message.trim(),
      category: ["bug", "billing", "feature", "other"].includes(category) ? category : "other",
      priority: ["low", "medium", "high"].includes(priority) ? priority : "medium",
    });
    res.json({ success: true, report });
  } catch (err) {
    console.error("Report create error:", err.message);
    res.status(500).json({ error: "Failed to submit report" });
  }
});

router.get("/mine", requireAuth, async (req, res) => {
  try {
    const list = await Report.find({ shopId: req.user.shopId }).sort({ createdAt: -1 }).limit(50);
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch reports" });
  }
});

module.exports = router;