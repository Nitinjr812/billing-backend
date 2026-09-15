// routes/restockOrders.js
//
// Mount this in your server file:
//   const restockOrderRoutes = require("./routes/restockOrders");
//   app.use("/api/restock-orders", restockOrderRoutes);
//
// ADJUST THIS: the require path for Product below if your models folder
// is structured differently, and the productId generation inside
// /:id/complete if you already generate SKUs another way elsewhere.

const express = require("express");
const router = express.Router();
const RestockOrder = require("../models/RestockOrder");
const Product = require("../models/Product"); // ADJUST THIS path if different

// GET /api/restock-orders  — list all (newest first). Optional ?status=Pending&supplier=ID
router.get("/", async (req, res) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.supplier) filter.supplier = req.query.supplier;
    const orders = await RestockOrder.find(filter).sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: "Could not fetch restock orders" });
  }
});

// POST /api/restock-orders — create a new pending restock order
router.post("/", async (req, res) => {
  try {
    const { supplier, supplierName, phone, items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "At least one item is required" });
    }
    const order = await RestockOrder.create({
      supplier: supplier || null,
      supplierName: supplierName || "",
      phone: phone || "",
      items,
      status: "Pending",
    });
    res.status(201).json(order);
  } catch (err) {
    res.status(500).json({ error: "Could not save restock order" });
  }
});

// PUT /api/restock-orders/:id/complete — THE important one.
// For every item in the order: find a Product with a case-insensitive exact
// name match and bump its stock by the ordered qty; if no match, create a
// new Product so nothing silently gets lost. Then mark the order Completed.
router.put("/:id/complete", async (req, res) => {
  try {
    const order = await RestockOrder.findById(req.params.id);
    if (!order) return res.status(404).json({ error: "Restock order not found" });
    if (order.status === "Completed") {
      return res.status(400).json({ error: "This order is already marked complete" });
    }

    for (const item of order.items) {
      const qtyNum = parseInt(String(item.qty).replace(/[^0-9]/g, ""), 10) || 0;
      const existing = await Product.findOne({
        name: { $regex: `^${item.name.trim()}$`, $options: "i" },
      });

      if (existing) {
        existing.stock = (Number(existing.stock) || 0) + qtyNum;
        existing.updatedAt = new Date(); // keeps "Last Product Update" on the Supplier drawer accurate
        await existing.save();
      } else {
        // ADJUST THIS: productId generation — swap for however you normally
        // generate SKUs elsewhere in the app (e.g. sequence, nanoid, etc.)
        const productId = "SKU-" + Date.now().toString().slice(-6);
        await Product.create({
          productId,
          name: item.name.trim(),
          category: "Uncategorized",
          stock: qtyNum,
          price: 0,
          growthPercent: 0,
          supplier: order.supplierName || "",
        });
      }
    }

    order.status = "Completed";
    order.completedAt = new Date();
    await order.save();

    res.json(order);
  } catch (err) {
    res.status(500).json({ error: "Could not complete restock order" });
  }
});

module.exports = router;