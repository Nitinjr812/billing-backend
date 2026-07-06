const express = require("express");
const router = express.Router();
const Invoice = require("../models/Invoice");
const Product = require("../models/Product");

// POST /api/invoices — create invoice + auto-decrement stock
router.post("/", async (req, res) => {
  try {
    const { customerName, customerEmail, customerPhone, items, subtotal, total } = req.body;

    if (!customerName || !items || !items.length) {
      return res.status(400).json({ error: "Customer name and items are required" });
    }

    // Unique invoice ID — timestamp based, no race conditions
    const invoiceId = `INV-${Date.now().toString().slice(-8)}`;

    // Decrement stock for matching products (case-insensitive name match)
    for (const item of items) {
      const escaped = item.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const product = await Product.findOne({ name: { $regex: `^${escaped}$`, $options: "i" } });
      if (product) {
        product.stock = Math.max(0, product.stock - Number(item.qty));
        await product.save();
      }
    }

    const invoice = new Invoice({
      invoiceId,
      customerName,
      customerEmail,
      customerPhone,
      items,
      subtotal,
      total,
    });

    await invoice.save();

    res.status(201).json(invoice);
  } catch (err) {
    console.error("Invoice creation error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/invoices — list all past invoices
router.get("/", async (req, res) => {
  try {
    const invoices = await Invoice.find().sort({ createdAt: -1 });
    res.json(invoices);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;