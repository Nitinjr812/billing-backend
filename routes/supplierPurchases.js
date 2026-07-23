const express = require("express");
const router = express.Router();
const SupplierPurchase = require("../models/SupplierPurchase");
const Supplier = require("../models/Supplier");

// GET /api/supplier-purchases — all purchases (optionally filter by supplier)
// Query param: ?supplier=<supplierObjectId>
router.get("/", async (req, res) => {
  try {
    const filter = {};
    if (req.query.supplier) filter.supplier = req.query.supplier;

    const purchases = await SupplierPurchase.find(filter).sort({ date: -1 });
    res.json(purchases);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/supplier-purchases/summary
// Aggregate totals — per supplier AND overall (for Dashboard net position)
router.get("/summary", async (req, res) => {
  try {
    const perSupplier = await SupplierPurchase.aggregate([
      {
        $group: {
          _id: "$supplier",
          supplierName: { $first: "$supplierName" },
          totalPurchased: { $sum: "$amount" },
          totalPaid: { $sum: "$paidAmount" },
          totalPending: { $sum: "$pendingAmount" },
          purchaseCount: { $sum: 1 },
        },
      },
      { $sort: { totalPending: -1 } },
    ]);

    const overall = perSupplier.reduce(
      (acc, s) => {
        acc.totalPurchased += s.totalPurchased;
        acc.totalPaid += s.totalPaid;
        acc.totalPending += s.totalPending;
        return acc;
      },
      { totalPurchased: 0, totalPaid: 0, totalPending: 0 }
    );

    res.json({ perSupplier, overall });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/supplier-purchases/:id
router.get("/:id", async (req, res) => {
  try {
    const purchase = await SupplierPurchase.findById(req.params.id);
    if (!purchase) return res.status(404).json({ error: "Purchase not found" });
    res.json(purchase);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/supplier-purchases — create a new purchase entry
router.post("/", async (req, res) => {
  try {
    const { supplier, description, amount, paidAmount, date, dueDate } = req.body;

    if (!supplier || amount == null) {
      return res.status(400).json({ error: "Supplier and amount are required" });
    }

    const supplierDoc = await Supplier.findById(supplier);
    if (!supplierDoc) return res.status(404).json({ error: "Supplier not found" });

    const purchaseId = `PUR-${Date.now().toString().slice(-6)}`;

    const purchase = new SupplierPurchase({
      purchaseId,
      supplier,
      supplierName: supplierDoc.name,
      description: description || "",
      amount: Number(amount),
      paidAmount: paidAmount != null ? Number(paidAmount) : 0,
      date: date || Date.now(),
      dueDate: dueDate || null,
    });

    await purchase.save();
    res.status(201).json(purchase);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /api/supplier-purchases/:id — edit a purchase entry
router.put("/:id", async (req, res) => {
  try {
    const purchase = await SupplierPurchase.findById(req.params.id);
    if (!purchase) return res.status(404).json({ error: "Purchase not found" });

    const { description, amount, paidAmount, date, dueDate } = req.body;
    if (description !== undefined) purchase.description = description;
    if (amount !== undefined) purchase.amount = Number(amount);
    if (paidAmount !== undefined) purchase.paidAmount = Number(paidAmount);
    if (date !== undefined) purchase.date = date;
    if (dueDate !== undefined) purchase.dueDate = dueDate;

    await purchase.save(); // pre-save hook recalculates pending/status
    res.json(purchase);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /api/supplier-purchases/:id/pay — record a payment against pending amount
// Body: { amount: 5000 }
router.put("/:id/pay", async (req, res) => {
  try {
    const { amount } = req.body;
    if (amount == null || Number(amount) <= 0) {
      return res.status(400).json({ error: "Valid payment amount required" });
    }

    const purchase = await SupplierPurchase.findById(req.params.id);
    if (!purchase) return res.status(404).json({ error: "Purchase not found" });

    purchase.paidAmount += Number(amount);
    if (purchase.paidAmount > purchase.amount) purchase.paidAmount = purchase.amount;

    // Fully paid off — clear the due date, nothing left to chase
    if (purchase.paidAmount >= purchase.amount) {
      purchase.dueDate = null;
    }

    await purchase.save(); // pending/status auto-recalculated
    res.json(purchase);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/supplier-purchases/:id
router.delete("/:id", async (req, res) => {
  try {
    const purchase = await SupplierPurchase.findByIdAndDelete(req.params.id);
    if (!purchase) return res.status(404).json({ error: "Purchase not found" });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;