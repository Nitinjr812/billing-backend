const express = require("express");
const router = express.Router();
const OpenAI = require("openai");
const Product = require("../models/Product");
const Order = require("../models/Order");
const { verifyToken } = require("../middleware/auth");

const openai = new OpenAI({
    apiKey: process.env.GROQ_API_KEY,
    baseURL: "https://api.groq.com/openai/v1",
    timeout: 15000,
});

router.use(verifyToken); // ── har request ab shop-scoped hai ──

// GET all products (sirf apni shop ke)
router.get("/", async (req, res) => {
    try {
        const products = await Product.find({ shopId: req.user.shopId }).sort({ stock: 1 }).lean();
        res.json(products);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET low stock / out of stock / slow moving alerts (sirf apni shop ke)
router.get("/alerts", async (req, res) => {
    try {
        const { shopId } = req.user;
        const [lowStock, outOfStock, allProducts, orders] = await Promise.all([
            Product.find({ shopId, stock: { $gt: 0, $lt: 50 } }).sort({ stock: 1 }).lean(),
            Product.find({ shopId, stock: 0 }).lean(),
            Product.find({ shopId }).lean(),
            Order.find({ shopId }).lean(),
        ]);

        const ordersByProduct = {};
        for (const o of orders) {
            if (o.status !== "Cancelled") {
                ordersByProduct[o.product] = (ordersByProduct[o.product] || 0) + 1;
            }
        }

        const slowMoving = allProducts.filter(
            (p) => p.stock > 0 && (ordersByProduct[p.name] || 0) < 2
        );

        res.json({ lowStock, outOfStock, slowMoving });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/products/:id/suggestion
router.post("/:id/suggestion", async (req, res) => {
    try {
        const product = await Product.findOne({ _id: req.params.id, shopId: req.user.shopId }).lean();
        if (!product) return res.status(404).json({ error: "Product not found" });

        const completion = await openai.chat.completions.create({
            model: "llama-3.3-70b-versatile",
            max_tokens: 200,
            temperature: 0.6,
            messages: [
                {
                    role: "system",
                    content: `You are a practical retail business advisor built into a shop's inventory app.
Given one product's details, give ONE short, specific, actionable suggestion (2-3 sentences max) to either move slow-moving stock or handle a restock smartly.
Reply in clear, professional English — no fluff, no generic advice, mention the actual numbers given.`,
                },
                {
                    role: "user",
                    content: `Product: ${product.name}
Category: ${product.category}
Price: ₹${product.price}
Current Stock: ${product.stock}
Growth: ${product.growthPercent}%

Give a suggestion.`,
                },
            ],
        });

        const suggestion = completion.choices[0].message.content;
        res.json({ suggestion });
    } catch (err) {
        console.error("Suggestion error:", err.message);
        res.json({
            suggestion:
                "Try a small discount or bundle offer on this product — it should help move the stock.",
        });
    }
});

// POST create product — blocks duplicates by name WITHIN SAME SHOP ONLY
router.post("/", async (req, res) => {
    try {
        const { shopId } = req.user;

        if (req.body.name) {
            const escaped = req.body.name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const existing = await Product.findOne({
                shopId,
                name: { $regex: `^${escaped}$`, $options: "i" },
            }).lean();
            if (existing) {
                return res.status(400).json({
                    error: `"${req.body.name}" already exists (SKU: ${existing.productId}). Edit it instead of adding a duplicate.`,
                });
            }
        }

        const product = new Product({ ...req.body, shopId });
        await product.save();
        res.status(201).json(product);
    } catch (err) {
        if (err.code === 11000) {
            return res.status(400).json({ error: "A product with this SKU already exists in your shop." });
        }
        res.status(400).json({ error: err.message });
    }
});

// PATCH update stock only (sirf apni shop ke product ka)
router.patch("/:id/stock", async (req, res) => {
    try {
        const product = await Product.findOneAndUpdate(
            { _id: req.params.id, shopId: req.user.shopId },
            { stock: req.body.stock },
            { new: true }
        );
        if (!product) return res.status(404).json({ error: "Product not found" });
        res.json(product);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// PUT update any product fields (sirf apni shop ke product ka)
router.put("/:id", async (req, res) => {
    try {
        const { shopId } = req.user;

        if (req.body.name) {
            const escaped = req.body.name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const existing = await Product.findOne({
                shopId,
                name: { $regex: `^${escaped}$`, $options: "i" },
                _id: { $ne: req.params.id },
            }).lean();
            if (existing) {
                return res.status(400).json({
                    error: `"${req.body.name}" already exists (SKU: ${existing.productId}).`,
                });
            }
        }

        const product = await Product.findOneAndUpdate(
            { _id: req.params.id, shopId },
            req.body,
            { new: true, runValidators: true }
        );
        if (!product) return res.status(404).json({ error: "Product not found" });
        res.json(product);
    } catch (err) {
        if (err.code === 11000) {
            return res.status(400).json({ error: "A product with this SKU already exists in your shop." });
        }
        res.status(400).json({ error: err.message });
    }
});

module.exports = router;