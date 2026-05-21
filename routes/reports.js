const express = require("express");
const router = express.Router();
const Order = require("../models/Order");
const Product = require("../models/Product");

// ── GET /api/reports — full report data ───────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const [orders, products] = await Promise.all([
      Order.find().sort({ date: -1 }),
      Product.find(),
    ]);

    // ── Order stats ──
    const total      = orders.length;
    const delivered  = orders.filter((o) => o.status === "Delivered").length;
    const pending    = orders.filter((o) => o.status === "Pending").length;
    const processing = orders.filter((o) => o.status === "Processing").length;
    const cancelled  = orders.filter((o) => o.status === "Cancelled").length;
    const cancellationRate = total ? +((cancelled / total) * 100).toFixed(1) : 0;

    const totalRevenue = orders
      .filter((o) => o.status !== "Cancelled")
      .reduce((sum, o) => sum + o.amount, 0);

    const avgOrderValue = total ? Math.round(totalRevenue / (total - cancelled)) : 0;

    // ── Revenue & orders by month ──
    const revenueByMonth = {};
    const ordersByMonth  = {};
    for (const o of orders) {
      const month = new Date(o.date).toLocaleString("en-IN", { month: "short" });
      if (o.status !== "Cancelled") {
        revenueByMonth[month] = (revenueByMonth[month] || 0) + o.amount;
      }
      ordersByMonth[month] = (ordersByMonth[month] || 0) + 1;
    }

    // ── Revenue by product & category ──
    const revenueByProduct  = {};
    const ordersByProduct   = {};
    const revenueByCategory = {};
    for (const o of orders) {
      if (o.status !== "Cancelled") {
        revenueByProduct[o.product]  = (revenueByProduct[o.product]  || 0) + o.amount;
        ordersByProduct[o.product]   = (ordersByProduct[o.product]   || 0) + 1;
      }
    }

    // Map product → category
    const productMap = {};
    for (const p of products) productMap[p.name] = p.category;
    for (const [name, rev] of Object.entries(revenueByProduct)) {
      const cat = productMap[name] || "Other";
      revenueByCategory[cat] = (revenueByCategory[cat] || 0) + rev;
    }

    // ── Top products ──
    const topProducts = Object.entries(revenueByProduct)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, revenue]) => {
        const product = products.find((p) => p.name === name);
        return {
          name,
          revenue,
          orders: ordersByProduct[name] || 0,
          growthPercent: product?.growthPercent || 0,
          category: product?.category || "—",
        };
      });

    // ── Stock alerts ──
    const lowStock   = products.filter((p) => p.stock > 0 && p.stock < 50);
    const outOfStock = products.filter((p) => p.stock === 0);
    const healthyStock = [...products].sort((a, b) => b.stock - a.stock).slice(0, 3);

    res.json({
      summary: { total, delivered, pending, processing, cancelled, cancellationRate, totalRevenue, avgOrderValue },
      revenueByMonth,
      ordersByMonth,
      revenueByCategory,
      topProducts,
      stock: { lowStock, outOfStock, healthyStock },
      products,
    });
  } catch (err) {
    console.error("Reports error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;