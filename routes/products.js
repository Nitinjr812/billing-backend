const express = require("express");
const router = express.Router();
const Product = require("../models/Product");

// GET all products
router.get("/", async (req, res) => {
    try {
        const products = await Product.find().sort({ stock: 1 });
        res.json(products);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET low stock alerts (stock < 50)
router.get("/alerts", async (req, res) => {
    try {
        const lowStock = await Product.find({ stock: { $gt: 0, $lt: 50 } }).sort({ stock: 1 });
        const outOfStock = await Product.find({ stock: 0 });
        res.json({ lowStock, outOfStock });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST create product — blocks duplicates by name (case-insensitive)
router.post("/", async (req, res) => {
    try {
        if (req.body.name) {
            const escaped = req.body.name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const existing = await Product.findOne({ name: { $regex: `^${escaped}$`, $options: "i" } });
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
        // Mongoose duplicate key error (e.g. duplicate productId)
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
            });
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