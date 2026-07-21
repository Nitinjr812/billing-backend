const express = require("express");
const router = express.Router();
const OpenAI = require("openai");
const Product = require("../models/Product");
const Order = require("../models/Order");

// Same Groq setup pattern as chat.js
const openai = new OpenAI({
    apiKey: process.env.GROQ_API_KEY,
    baseURL: "https://api.groq.com/openai/v1",
    timeout: 15000,
});

// GET all products
// .lean() skips mongoose document hydration → faster JSON responses
router.get("/", async (req, res) => {
    try {
        const products = await Product.find().sort({ stock: 1 }).lean();
        res.json(products);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET low stock / out of stock / slow moving alerts
// "Slow moving" reuses the exact same definition chat.js uses
// (< 2 non-cancelled orders) so both features agree with each other.
router.get("/alerts", async (req, res) => {
    try {
        const [lowStock, outOfStock, allProducts, orders] = await Promise.all([
            Product.find({ stock: { $gt: 0, $lt: 50 } }).sort({ stock: 1 }).lean(),
            Product.find({ stock: 0 }).lean(),
            Product.find().lean(),
            Order.find().lean(),
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
// Given a single product (slow-moving / low-stock / out-of-stock), asks
// Groq for one short, practical suggestion. Used by the Stock Alert popup
// when the user clicks "OK" on a product card.
router.post("/:id/suggestion", async (req, res) => {
    try {
        const product = await Product.findById(req.params.id).lean();
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
Reply naturally in Hinglish (Hindi+English mix), like a helpful local business advisor would speak — no fluff, no generic advice, mention the actual numbers given.`,
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
                "Is product ke liye ek chhota discount ya bundle offer try karo — stock move karne mein madad milegi.",
        });
    }
});

// POST create product — blocks duplicates by name (case-insensitive)
router.post("/", async (req, res) => {
    try {
        if (req.body.name) {
            const escaped = req.body.name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const existing = await Product.findOne({ name: { $regex: `^${escaped}$`, $options: "i" } }).lean();
            if (existing) {
                return res.status(400).json({
                    error: `"${req.body.name}" already exists (SKU: ${existing.productId}). Edit it instead of adding a duplicate.`,
                });
            }
        }

        const product = new Product(req.body);
        await product.save();
        res.status(201).json(product);
    } catch (err) {
        if (err.code === 11000) {
            return res.status(400).json({ error: "A product with this SKU already exists." });
        }
        res.status(400).json({ error: err.message });
    }
});

// PATCH update stock only
router.patch("/:id/stock", async (req, res) => {
    try {
        const product = await Product.findByIdAndUpdate(
            req.params.id,
            { stock: req.body.stock },
            { new: true }
        );
        res.json(product);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// PUT update any product fields (name, price, category, supplier, growthPercent, stock)
// Also blocks renaming a product into a duplicate of another existing product.
router.put("/:id", async (req, res) => {
    try {
        if (req.body.name) {
            const escaped = req.body.name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const existing = await Product.findOne({
                name: { $regex: `^${escaped}$`, $options: "i" },
                _id: { $ne: req.params.id },
            }).lean();
            if (existing) {
                return res.status(400).json({
                    error: `"${req.body.name}" already exists (SKU: ${existing.productId}).`,
                });
            }
        }

        const product = await Product.findByIdAndUpdate(req.params.id, req.body, {
            new: true,
            runValidators: true,
        });
        if (!product) return res.status(404).json({ error: "Product not found" });
        res.json(product);
    } catch (err) {
        if (err.code === 11000) {
            return res.status(400).json({ error: "A product with this SKU already exists." });
        }
        res.status(400).json({ error: err.message });
    }
});

module.exports = router;