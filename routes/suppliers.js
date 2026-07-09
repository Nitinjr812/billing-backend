const express = require("express");
const router = express.Router();
const Supplier = require("../models/Supplier");

// GET /api/suppliers — list all suppliers
router.get("/", async (req, res) => {
  try {
    const suppliers = await Supplier.find().sort({ name: 1 });
    res.json(suppliers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/suppliers — create a new supplier
router.post("/", async (req, res) => {
  try {
    const { name, category, contact, email, phone, location, status, paymentTerms, rating } = req.body;

    if (!name || !category || !contact) {
      return res.status(400).json({ error: "Name, category, and contact person are required" });
    }

    const supplierId = `SUP-${Date.now().toString().slice(-6)}`;

    const supplier = new Supplier({
      supplierId,
      name,
      category,
      contact,
      email,
      phone,
      location,
      status: status || "Active",
      paymentTerms: paymentTerms || "Net 30",
      rating: rating != null ? Number(rating) : 0,
    });

    await supplier.save();
    res.status(201).json(supplier);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /api/suppliers/:id — update a supplier
router.put("/:id", async (req, res) => {
  try {
    const supplier = await Supplier.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!supplier) return res.status(404).json({ error: "Supplier not found" });
    res.json(supplier);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/suppliers/:id — remove a supplier
router.delete("/:id", async (req, res) => {
  try {
    const supplier = await Supplier.findByIdAndDelete(req.params.id);
    if (!supplier) return res.status(404).json({ error: "Supplier not found" });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;