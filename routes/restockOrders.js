// routes/restockOrder.js
//
// Mount in server.js:
//   const restockOrdersRouter = require("./routes/restockOrder");
//   app.use("/api/restock-orders", restockOrdersRouter);

const express = require("express");
const router = express.Router();
const RestockOrder = require("../models/RestockOrder"); // must match actual filename case exactly
const Product = require("../models/Product");
const { verifyToken } = require("../middleware/auth");

router.use(verifyToken); // ── har request ab shop-scoped hai ──

// Escapes regex special chars so item/product names like "Item (5kg)" don't crash the query
function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// GET /api/restock-orders — list all for THIS shop (newest first)
// Optional query params: ?status=Pending&supplier=<supplierObjectId>
router.get("/", async (req, res) => {
  try {
    const filter = { shopId: req.user.shopId };
    if (req.query.status) filter.status = req.query.status;
    if (req.query.supplier) filter.supplier = req.query.supplier;

    const orders = await RestockOrder.find(filter).sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) {
    console.error("RESTOCK LIST ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/restock-orders/:id — single order (scoped to this shop)
router.get("/:id", async (req, res) => {
  try {
    const order = await RestockOrder.findOne({ _id: req.params.id, shopId: req.user.shopId });
    if (!order) return res.status(404).json({ error: "Restock order not found" });
    res.json(order);
  } catch (err) {
    console.error("RESTOCK GET ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/restock-orders — create a new pending restock order (tagged to this shop)
router.post("/", async (req, res) => {
  try {
    const { supplier, supplierName, phone, items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "At least one item is required" });
    }

    const cleanItems = items
      .filter((it) => it && it.name && it.name.trim())
      .map((it) => ({ name: it.name.trim(), qty: it.qty || "", unit: it.unit || "" }));

    if (cleanItems.length === 0) {
      return res.status(400).json({ error: "At least one item with a name is required" });
    }

    const order = await RestockOrder.create({
      shopId: req.user.shopId,
      supplier: supplier || null,
      supplierName: supplierName || "",
      phone: phone || "",
      items: cleanItems,
      status: "Pending",
    });

    res.status(201).json(order);
  } catch (err) {
    console.error("RESTOCK CREATE ERROR:", err);
    res.status(400).json({ error: err.message });
  }
});

// PUT /api/restock-orders/:id — update expectedDate / status / items (scoped to this shop)
// Used by the "Restock Check-in" popup when the shopkeeper says "not yet, ask me on X date"
router.put("/:id", async (req, res) => {
  try {
    const order = await RestockOrder.findOne({ _id: req.params.id, shopId: req.user.shopId });
    if (!order) return res.status(404).json({ error: "Restock order not found" });

    const { expectedDate, status, items, supplierName, phone } = req.body;
    if (expectedDate !== undefined) order.expectedDate = expectedDate;
    if (status !== undefined) order.status = status;
    if (items !== undefined) order.items = items;
    if (supplierName !== undefined) order.supplierName = supplierName;
    if (phone !== undefined) order.phone = phone;

    await order.save();
    res.json(order);
  } catch (err) {
    console.error("RESTOCK UPDATE ERROR:", err);
    res.status(400).json({ error: err.message });
  }
});

// PUT /api/restock-orders/:id/complete — pushes ordered items into Inventory.
// For every item: find a Product (same shop) with a case-insensitive exact name
// match and bump its stock; if no match, create a new Product. Then mark Completed.
router.put("/:id/complete", async (req, res) => {
  try {
    const { shopId } = req.user;

    const order = await RestockOrder.findOne({ _id: req.params.id, shopId });
    if (!order) return res.status(404).json({ error: "Restock order not found" });
    if (order.status === "Completed") {
      return res.status(400).json({ error: "This order is already marked complete" });
    }

    for (const item of order.items) {
      const cleanName = String(item.name || "").trim();
      if (!cleanName) continue;

      const qtyNum = parseInt(String(item.qty || "").replace(/[^0-9]/g, ""), 10) || 0;

      const existing = await Product.findOne({
        shopId,
        name: { $regex: `^${escapeRegex(cleanName)}$`, $options: "i" },
      });

      if (existing) {
        existing.stock = (Number(existing.stock) || 0) + qtyNum;
        await existing.save();
      } else {
        const productId = `SKU-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 1000)}`;
        await Product.create({
          shopId,
          productId,
          name: cleanName,
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
    console.error("RESTOCK COMPLETE ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/restock-orders/:id (scoped to this shop)
router.delete("/:id", async (req, res) => {
  try {
    const order = await RestockOrder.findOneAndDelete({ _id: req.params.id, shopId: req.user.shopId });
    if (!order) return res.status(404).json({ error: "Restock order not found" });
    res.json({ success: true });
  } catch (err) {
    console.error("RESTOCK DELETE ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;