const express = require("express");
const router = express.Router();
const OpenAI = require("openai");
const Product = require("../models/Product");
const { verifyToken } = require("../middleware/auth");

const openai = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: "https://api.groq.com/openai/v1",
});

const ALLOWED_CATEGORIES = ["Electronics", "Apparel", "Home Goods"];

router.use(verifyToken);

// ── STEP 1: Parse spoken text into structured product data ───────────────
router.post("/parse", async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: "text required" });

  try {
    const completion = await openai.chat.completions.create({
      model: "openai/gpt-oss-120b", // updated — old model was decommissioned by Groq
      messages: [
        {
          role: "system",
          content: `You extract product details from spoken text (Hindi, Hinglish, or English) and return ONLY valid JSON, nothing else — no explanation, no markdown, no backticks.

Extract these fields:
- name (string): product name, cleaned up properly capitalized
- price (number): selling price in rupees, numeric only, no currency symbols
- costPrice (number): cost/purchase price if mentioned, else same as price
- stock (number): quantity/stock count, numeric only
- category (string): MUST be exactly one of: "${ALLOWED_CATEGORIES.join('", "')}". Pick the closest match based on context. If unclear, default to "Home Goods".

Example input: "Samsung TV add karo price 25000 stock 10 electronics category"
Example output: {"name": "Samsung TV", "price": 25000, "costPrice": 25000, "stock": 10, "category": "Electronics"}

Example input: "add cotton shirt for 500 rupees quantity 20"
Example output: {"name": "Cotton Shirt", "price": 500, "costPrice": 500, "stock": 20, "category": "Apparel"}

If any required field (name, price, stock) is genuinely missing from the text, set it to null so the frontend can ask the user to fill it manually. Return ONLY the JSON object.`,
        },
        { role: "user", content: text },
      ],
      temperature: 0.1,
    });

    let raw = completion.choices[0].message.content.trim();
    // Safety: kabhi kabhi model markdown fences bhej deta hai, unhe hata do
    raw = raw.replace(/```json|```/g, "").trim();

    const parsed = JSON.parse(raw);

    // Category ko validate karo, agar invalid hai toh fallback
    if (!ALLOWED_CATEGORIES.includes(parsed.category)) {
      parsed.category = "Home Goods";
    }

    res.json({ success: true, parsed, originalText: text });
  } catch (err) {
    console.error("Voice parse error:", err.message);
    res.status(500).json({ error: "Could not understand the product details. Please try again or type manually." });
  }
});

// ── STEP 2: Save confirmed product (after user reviews/edits) ────────────
router.post("/confirm", async (req, res) => {
  try {
    const { shopId } = req.user; // ── shop-scoped, same as routes/products.js ──
    const { name, category } = req.body;

    const price = Number(req.body.price);
    const stock = Number(req.body.stock);
    const costPrice =
      req.body.costPrice == null || req.body.costPrice === ""
        ? price
        : Number(req.body.costPrice);

    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: "Product name is required" });
    }
    if (req.body.price == null || req.body.price === "" || Number.isNaN(price) || price < 0) {
      return res.status(400).json({ error: "A valid price is required" });
    }
    if (req.body.stock == null || req.body.stock === "" || Number.isNaN(stock) || stock < 0) {
      return res.status(400).json({ error: "A valid stock quantity is required" });
    }

    const cleanName = String(name).trim();

    // Duplicate name check — within the SAME shop only (matches products.js)
    const escaped = cleanName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const existing = await Product.findOne({
      shopId,
      name: { $regex: `^${escaped}$`, $options: "i" },
    }).lean();
    if (existing) {
      return res.status(400).json({
        error: `"${cleanName}" already exists (SKU: ${existing.productId}). Edit it instead of adding a duplicate.`,
      });
    }

    const productId =
      "prod_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);

    const product = await Product.create({
      productId,
      shopId,
      name: cleanName,
      price,
      costPrice: Number.isNaN(costPrice) ? price : costPrice,
      category: ALLOWED_CATEGORIES.includes(category) ? category : "Home Goods",
      stock,
      growthPercent: 0,
    });

    res.status(201).json({ success: true, product });
  } catch (err) {
    console.error("Voice confirm save error:", err.stack || err.message);
    if (err.code === 11000) {
      return res.status(400).json({ error: "A product with this SKU already exists in your shop." });
    }
    // ValidationError / CastError are the client's data problem, not a server crash
    if (err.name === "ValidationError" || err.name === "CastError") {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: err.message || "Failed to save product" });
  }
});

module.exports = router;