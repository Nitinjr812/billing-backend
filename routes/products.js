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

// POST create product
router.post("/", async (req, res) => {
    try {
        const product = new Product(req.body);
        await product.save();
        res.status(201).json(product);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// PATCH update stock

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

module.exports = router;